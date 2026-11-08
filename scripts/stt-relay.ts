// Local Chirp 3 streaming relay for development (Next dev can't upgrade WebSockets).
// Usage: npm run stt-relay   → ws://localhost:8787   (set NEXT_PUBLIC_STT_STREAM_URL=ws://localhost:8787 in .env.local)
// The same relay() runs on Vercel via src/app/api/voice/stream/route.ts.
import { WebSocketServer } from 'ws'
import { relay } from '../src/lib/chirp-relay'
import { chirpDeps, chirpEnv } from '../src/lib/chirp'

const PORT = Number(process.env.STT_RELAY_PORT ?? 8787)
const env = chirpEnv()
if (!env.ok) console.warn('Chirp not configured: set GOOGLE_SERVICE_ACCOUNT_JSON (and CHIRP_PROJECT_ID if not in the key). Clients will get "unconfigured" and fall back to Gemini.')

const wss = new WebSocketServer({ port: PORT, maxPayload: 256 * 1024 })
wss.on('connection', ws => {
  if (!env.ok) { ws.send(JSON.stringify({ type: 'error', reason: 'unconfigured' })); ws.close(1000); return }
  relay(ws, chirpDeps())
})
console.log(`STT relay on ws://localhost:${PORT} · project ${env.project || '—'} · region ${env.region}`)
