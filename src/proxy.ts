import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session cookie and sends signed-out users to /login.
// Optimistic check only — data access is authorized by RLS, not here.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { data } = await supabase.auth.getClaims()
  const path = request.nextUrl.pathname
  // /api routes answer 401 themselves (a redirect to an HTML page is useless to fetch())
  const isPublic = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/api')
  if (!data?.claims && !isPublic) return NextResponse.redirect(new URL('/login', request.url))
  if (data?.claims && path.startsWith('/login')) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  // static files (icon font, audio worklet, service worker, PWA manifest/icons, offline page) must load signed-out too
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|manifest.webmanifest|.*\\.(?:svg|png|jpg|webp|ico|woff2|js|html)$).*)'],
}
