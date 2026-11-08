import { upgradeWebSocket } from '@vercel/functions'
import { relay } from '@/lib/chirp-relay'
import { chirpDeps, chirpEnv } from '@/lib/chirp'

// Chirp 3 streaming over WebSocket. Only works on Vercel's runtime (upgradeWebSocket throws elsewhere, incl. `next dev`);
// for local development run `npm run stt-relay` and set NEXT_PUBLIC_STT_STREAM_URL=ws://localhost:8787.
// Auth happens inside the socket (first message carries the Supabase access token).
export async function GET() {
  if (!chirpEnv().ok) return Response.json({ error: 'unconfigured' }, { status: 503 })
  try {
    return await upgradeWebSocket(ws => relay(ws, chirpDeps()))
  } catch {
    return Response.json({ error: 'websocket_unavailable' }, { status: 501 })
  }
}
