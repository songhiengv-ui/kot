// Mic samples → 16 kHz mono 16-bit WAV. Pure; used in the browser, tested in Node.
// ponytail: uncompressed (~32 KB/s, ~1 MB per 30 s). Switch to Opus/AAC if upload time on 3G becomes the bottleneck.

/** Box-filter downsample (fine for speech at 48/44.1 kHz → 16 kHz). */
export function downsample(input: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return input
  const ratio = from / to, out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = a; j < b; j++) sum += input[j]
    out[i] = b > a ? sum / (b - a) : 0
  }
  return out
}

export function encodeWav(samples: Float32Array, rate = 16000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Float samples → raw little-endian PCM16 (what the Chirp stream receives). */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2), v = new DataView(buf)
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true) }
  return buf
}

/** Peak level 0..1 of a chunk — drives the waveform and the "did we hear anything" check. */
export const peak = (chunk: Float32Array) => { let m = 0; for (const x of chunk) { const a = Math.abs(x); if (a > m) m = a } return m }
