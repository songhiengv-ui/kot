import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { extractWithAI } from '@/lib/extract'
import { needsAI, parseCapture } from '@/lib/parse'
import { limited } from '@/lib/ratelimit'
import { transcribe, wavInfo } from '@/lib/stt'

// POST audio/wav body (?mode=personal|business) → { transcript, candidates, usedAI, model, timings }.
// Audio is processed in memory and dropped; nothing (audio, transcript, amounts) is stored or logged here.
const MAX_BYTES = 2_500_000  // ~78 s of 16 kHz mono PCM; the client caps recordings at 30 s

export async function POST(request: Request) {
  const t0 = performance.now()
  const store = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: (cs) => cs.forEach(({ name, value, options }) => store.set(name, value, options)) },
  })
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (limited(`voice:${userId}`, 12)) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const mode = new URL(request.url).searchParams.get('mode')
  if (mode !== 'personal' && mode !== 'business') return Response.json({ error: 'invalid_mode' }, { status: 400 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 })
  const audio = await request.arrayBuffer()
  if (audio.byteLength > MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 })
  const info = wavInfo(audio)
  if (!info) return Response.json({ error: 'invalid_audio' }, { status: 400 })

  const stt = await transcribe(audio)
  const timings = { audio_ms: info.ms, stt_ms: stt.ms, extract_ms: 0, server_ms: 0 }
  if (!stt.ok) {
    timings.server_ms = Math.round(performance.now() - t0)
    const status = stt.reason === 'empty' ? 422 : stt.reason === 'error' ? 502 : 503
    return Response.json({ error: stt.reason, model: stt.model, timings }, { status })
  }

  // Same pipeline as typed text: deterministic first, AI only when the local parse can't place the amounts.
  const t1 = performance.now()
  const local = parseCapture(stt.text, mode)
  const ai = needsAI(stt.text, local) ? await extractWithAI(stt.text, mode, 'voice') : null
  timings.extract_ms = Math.round(performance.now() - t1)
  timings.server_ms = Math.round(performance.now() - t0)
  return Response.json({ transcript: stt.text, candidates: ai ?? local, usedAI: !!ai, model: stt.model, timings })
}
