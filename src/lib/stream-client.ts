'use client'
// Browser side of the Chirp 3 streaming relay (see lib/chirp-relay.ts for the protocol).
// Enabled only when NEXT_PUBLIC_STT_STREAM_URL is set: "same-origin" (Vercel route) or e.g. ws://localhost:8787 (dev relay).
// Any failure resolves to null so the caller falls back to the Gemini WAV upload — voice never depends on the stream.
import type { Candidate } from './parse'

export const STREAM_URL = process.env.NEXT_PUBLIC_STT_STREAM_URL ?? ''
export type StreamFinal = { transcript: string; candidates: Candidate[]; usedAI: boolean; stt_ms: number; model: string }

export function openSttStream(token: Promise<string | undefined>, mode: 'personal' | 'business', onPartial: (text: string) => void) {
  const url = STREAM_URL === 'same-origin' ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice/stream` : STREAM_URL
  let ready = false, done = false
  const queue: ArrayBuffer[] = []
  let settle: (f: StreamFinal | null) => void = () => {}
  const result = new Promise<StreamFinal | null>(r => { settle = f => { if (!done) { done = true; r(f) } } })
  let ws: WebSocket
  try { ws = new WebSocket(url); ws.binaryType = 'arraybuffer' } catch { settle(null); return { push() {}, end: () => result, cancel() {} } }

  ws.onopen = async () => {
    const t = await token.catch(() => undefined)
    if (!t) { settle(null); ws.close(); return }
    ws.send(JSON.stringify({ type: 'start', token: t, mode }))
  }
  ws.onmessage = e => {
    let m: { type: string; text?: string } & Partial<StreamFinal>
    try { m = JSON.parse(String(e.data)) } catch { return }
    if (m.type === 'ready') { ready = true; for (const b of queue.splice(0)) ws.send(b) }
    else if (m.type === 'partial') onPartial(m.text ?? '')
    else if (m.type === 'final') settle({ transcript: m.transcript!, candidates: m.candidates!, usedAI: !!m.usedAI, stt_ms: m.stt_ms ?? 0, model: m.model ?? 'chirp_3' })
    else if (m.type === 'error') settle(null)
  }
  ws.onerror = () => settle(null)
  ws.onclose = () => settle(null)

  return {
    push(pcm: ArrayBuffer) { if (done) return; if (ready && ws.readyState === WebSocket.OPEN) ws.send(pcm); else queue.push(pcm) },
    /** Stop sending audio and wait for Chirp's final transcript (null → use the fallback). */
    end(timeoutMs = 8000) {
      if (!done) {
        if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end' })); else settle(null)
        setTimeout(() => { settle(null); try { ws.close() } catch { /* ignore */ } }, timeoutMs)
      }
      return result
    },
    cancel() { settle(null); try { ws.close() } catch { /* ignore */ } },
  }
}
