import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { extractWithAI } from '@/lib/extract'
import { needsAI, parseCapture } from '@/lib/parse'
import { limited } from '@/lib/ratelimit'

// POST {text, mode, source} → {candidates, usedAI}. Deterministic first; the model only when needsAI says so.
// Never log the body: it is the user's financial text / transcript.
const Body = z.object({
  text: z.string().trim().min(1).max(500),
  mode: z.enum(['personal', 'business']),
  source: z.enum(['text', 'voice']),
})

export async function POST(request: Request) {
  const store = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: (cs) => cs.forEach(({ name, value, options }) => store.set(name, value, options)) },
  })
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (limited(`capture:${userId}`)) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const { text, mode, source } = body.data

  const candidates = parseCapture(text, mode)
  if (!needsAI(text, candidates)) return Response.json({ candidates, usedAI: false })
  const ai = await extractWithAI(text, mode, source)
  return Response.json(ai ? { candidates: ai, usedAI: true } : { candidates, usedAI: false })
}
