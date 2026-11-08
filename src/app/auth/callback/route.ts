import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

// OAuth (Google) and email-link sign-in land here with ?code=… (PKCE).
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const store = await cookies()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      cookies: { getAll: () => store.getAll(), setAll: (cs) => cs.forEach(({ name, value, options }) => store.set(name, value, options)) },
    })
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL('/', request.url))
  }
  return NextResponse.redirect(new URL('/login?error=1', request.url))
}
