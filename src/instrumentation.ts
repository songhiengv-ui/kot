import type { Instrumentation } from 'next'

// Server error monitoring: one structured line per error into the host's logs (Vercel → Logs; filter "kat_error").
// Route pattern and digest only — never the URL query, headers, cookies or bodies (they can carry financial text).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({
    kat_error: true, route: context.routePath, type: context.routeType, method: request.method,
    name: e.name, message: e.message.slice(0, 200), digest: (err as { digest?: string })?.digest,
  }))
}
