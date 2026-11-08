// Server only. Browser ⇄ WebSocket ⇄ this relay ⇄ Chirp 3 StreamingRecognize (gRPC).
// Host-agnostic: Vercel (upgradeWebSocket) or a plain Node `ws` server both hand us a socket.
//
// Protocol
//   client → relay: {"type":"start","token":"<supabase access token>","mode":"personal"|"business"}
//                   then binary frames: 16 kHz mono PCM16 (≤ 25 KB each), then {"type":"end"}
//   relay → client: {"type":"ready"} · {"type":"partial","text"} ·
//                   {"type":"final","transcript","candidates","usedAI","stt_ms","model":"chirp_3"} · {"type":"error","reason"}
// Never logs audio or transcripts.
import type { Candidate } from './parse'

export type SpeechStream = {
  write(req: object): void
  end(): void
  on(ev: 'data', fn: (r: ChirpResponse) => void): void
  on(ev: 'error', fn: (e: unknown) => void): void
  on(ev: 'end', fn: () => void): void
  destroy?(): void
}
export type ChirpResponse = { results?: { alternatives?: { transcript?: string | null }[] | null; isFinal?: boolean | null }[] | null }
export type WsLike = {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(ev: 'message', fn: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): void
  on(ev: 'close', fn: () => void): void
}
export type RelayDeps = {
  verify: (token: string) => Promise<string | null>                       // → user id
  open: () => SpeechStream                                                 // a fresh Chirp stream (first write = config)
  config: object                                                           // the StreamingRecognizeRequest config message
  parse: (text: string, mode: 'personal' | 'business') => Promise<{ candidates: Candidate[]; usedAI: boolean }>
  limited?: (userId: string) => boolean
  maxAudioBytes?: number                                                   // default 30 s of 16 kHz PCM16
  finalTimeoutMs?: number                                                  // wait for Chirp after "end"
  authTimeoutMs?: number                                                   // close sockets that never send "start"
}

const toBuf = (d: Buffer | ArrayBuffer | Buffer[]) => Array.isArray(d) ? Buffer.concat(d) : Buffer.isBuffer(d) ? d : Buffer.from(d)

export function relay(ws: WsLike, deps: RelayDeps) {
  const maxBytes = deps.maxAudioBytes ?? 16000 * 2 * 30
  let stage: 'auth' | 'verifying' | 'streaming' | 'ending' | 'done' = 'auth'
  let mode: 'personal' | 'business' = 'personal'
  let stream: SpeechStream | null = null
  let bytes = 0, t0 = 0, timer: ReturnType<typeof setTimeout> | undefined
  const finals: string[] = []
  let interim = ''
  // an idle socket that never authenticates is closed
  const authTimer = setTimeout(() => { if (stage === 'auth' || stage === 'verifying') fail('unauthorized') }, deps.authTimeoutMs ?? 10_000)

  const send = (m: object) => { try { ws.send(JSON.stringify(m)) } catch { /* socket gone */ } }
  const fail = (reason: 'unauthorized' | 'rate_limited' | 'busy' | 'empty' | 'error' | 'bad_request') => {
    if (stage === 'done') return
    stage = 'done'; clearTimeout(timer); clearTimeout(authTimer)
    send({ type: 'error', reason })
    try { stream?.destroy?.() } catch { /* ignore */ }
    ws.close(1000)
  }
  const transcript = () => [...finals, interim].join(' ').replace(/\s+/g, ' ').replace(/[។\s]+$/u, '').trim()

  async function complete() {
    if (stage === 'done') return
    stage = 'done'; clearTimeout(timer)
    const text = transcript()
    if (!text) { send({ type: 'error', reason: 'empty' }); ws.close(1000); return }
    const stt_ms = Math.round(performance.now() - t0)
    try {
      const { candidates, usedAI } = await deps.parse(text, mode)
      send({ type: 'final', transcript: text, candidates, usedAI, stt_ms, model: 'chirp_3' })
    } catch { send({ type: 'error', reason: 'error' }) }
    ws.close(1000)
  }

  function endAudio() {
    if (stage !== 'streaming') return
    stage = 'ending'
    try { stream!.end() } catch { /* ignore */ }
    timer = setTimeout(() => (transcript() ? complete() : fail('busy')), deps.finalTimeoutMs ?? 10_000)
  }

  ws.on('message', async (data, isBinary) => {
    if (stage === 'done') return
    if (!isBinary) {
      let msg: { type?: string; token?: string; mode?: string }
      try { msg = JSON.parse(toBuf(data).toString('utf8')) } catch { return fail('bad_request') }
      if (msg.type === 'end') return endAudio()
      if (msg.type !== 'start' || stage !== 'auth') return fail('bad_request')
      if (msg.mode !== 'personal' && msg.mode !== 'business') return fail('bad_request')
      stage = 'verifying'  // set before the await: a second "start" now fails instead of opening a second stream
      const user = typeof msg.token === 'string' ? await deps.verify(msg.token).catch(() => null) : null
      if (stage !== 'verifying') return  // socket closed or failed while verifying
      if (!user) return fail('unauthorized')
      if (deps.limited?.(user)) return fail('rate_limited')
      mode = msg.mode
      try {
        stream = deps.open()
        stream.on('data', r => {
          for (const res of r.results ?? []) {
            const text = res.alternatives?.[0]?.transcript ?? ''
            if (res.isFinal) { if (text.trim()) finals.push(text.trim()); interim = '' } else interim = text
          }
          if (stage === 'streaming' || stage === 'ending') send({ type: 'partial', text: transcript() })
        })
        stream.on('error', () => (stage === 'ending' && transcript() ? complete() : fail('busy')))
        stream.on('end', () => { if (stage === 'ending') complete() })
        stream.write(deps.config)
      } catch { return fail('error') }
      stage = 'streaming'; t0 = performance.now(); clearTimeout(authTimer)
      return send({ type: 'ready' })
    }
    if (stage !== 'streaming') return  // audio before auth or after end is ignored
    const buf = toBuf(data)
    if (buf.length === 0 || buf.length > 25_000 || buf.length % 2) return fail('bad_request')
    bytes += buf.length
    if (bytes > maxBytes) return endAudio()  // 30 s cap: finish with what we have
    try { stream!.write({ audio: buf }) } catch { fail('busy') }
  })
  ws.on('close', () => { if (stage !== 'done') { stage = 'done'; clearTimeout(timer); clearTimeout(authTimer); try { stream?.destroy?.() } catch { /* ignore */ } } })
}
