// Browser mic → 16 kHz mono WAV via Web Audio (AudioWorklet), not MediaRecorder:
// MediaRecorder gives WebM on Chrome and MP4 on Safari, and Gemini doesn't document WebM. WAV works everywhere.
import { downsample, encodeWav, peak, toPcm16 } from './wav'

export type MicError = 'insecure' | 'unsupported' | 'denied' | 'nomic' | 'busy' | 'interrupted'
export const MAX_MS = 30_000

/** null = can record here. Checked before asking for permission so we can explain instead of failing. */
export function micSupport(): MicError | null {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'  // mic needs HTTPS (localhost is fine)
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return 'unsupported'
  return null
}

export function micErrorOf(e: unknown): MicError {
  switch ((e as { name?: string } | null)?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'denied'
    case 'NotFoundError': case 'OverconstrainedError': return 'nomic'
    case 'NotReadableError': case 'AbortError': return 'busy'  // another app / call holds the mic
    default: return 'unsupported'
  }
}

export type Recording = { stop: () => Promise<{ wav: ArrayBuffer; ms: number; peak: number }>; cancel: () => void }

/** Starts recording. onLevel gets 0..1 levels for the waveform; onEnd fires if the mic is lost or the 30 s cap hits.
 *  onChunk (optional) gets live 16 kHz PCM16 batches (~85 ms) for streaming; the full clip is still kept for the WAV fallback. */
export async function startRecording(onLevel: (l: number) => void, onEnd: (why: 'max' | 'interrupted') => void, onChunk?: (pcm16: ArrayBuffer) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ctx = new AudioContext()
  let closed = false
  const close = () => { if (closed) return; closed = true; clearTimeout(cap); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}) }
  try {
    await ctx.audioWorklet.addModule('/pcm-worklet.js')
  } catch (e) { close(); throw e }
  const node = new AudioWorkletNode(ctx, 'pcm')
  const chunks: Float32Array[] = []
  let max = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data); const p = peak(e.data); if (p > max) max = p; onLevel(p)
    if (onChunk) onChunk(toPcm16(downsample(e.data, ctx.sampleRate)))
  }
  ctx.createMediaStreamSource(stream).connect(node)
  node.connect(ctx.destination)  // keeps the graph pulled on all browsers; the node outputs silence
  const t0 = performance.now()
  const cap = setTimeout(() => onEnd('max'), MAX_MS)
  stream.getAudioTracks()[0]?.addEventListener('ended', () => onEnd('interrupted'))

  return {
    stop: async () => {
      const rate = ctx.sampleRate, ms = Math.round(performance.now() - t0)
      close()
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of chunks) { all.set(c, o); o += c.length }
      return { wav: encodeWav(downsample(all, rate)), ms, peak: max }
    },
    cancel: close,
  }
}
