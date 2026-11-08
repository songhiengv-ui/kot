import { describe, expect, it } from 'vitest'
import { transcribe, wavInfo } from './stt'
import { downsample, encodeWav, peak, toPcm16 } from './wav'

const cfg = { key: 'k', models: ['primary', 'fallback'] }
const reply = (status: number, text?: string) => new Response(JSON.stringify(text === undefined ? { error: {} } : { candidates: [{ content: { parts: [{ text }] } }] }), { status })
const fakeFetch = (...answers: (Response | Error)[]) => {
  const calls: string[] = []
  const f = (async (url: string) => { calls.push(String(url).split('/models/')[1].split(':')[0]); const a = answers.shift()!; if (a instanceof Error) throw a; return a }) as unknown as typeof fetch
  return { f, calls }
}
const wav = encodeWav(new Float32Array(16000))  // 1 s of silence

describe('transcribe', () => {
  it('returns the primary model transcript, trimming a trailing ។', async () => {
    const { f, calls } = fakeFetch(reply(200, 'ចាយ ៥ ដុល្លារ ទិញកាហ្វេ តាម ABA។'))
    expect(await transcribe(wav, cfg, f)).toMatchObject({ ok: true, text: 'ចាយ ៥ ដុល្លារ ទិញកាហ្វេ តាម ABA', model: 'primary' })
    expect(calls).toEqual(['primary'])
  })
  it('falls back when the primary is busy, missing or times out', async () => {
    for (const first of [reply(503), reply(429), reply(404), new Error('timeout')]) {
      const { f, calls } = fakeFetch(first, reply(200, 'ផ្ទេរ ១០០ ដុល្លារ'))
      expect(await transcribe(wav, cfg, f)).toMatchObject({ ok: true, model: 'fallback' })
      expect(calls).toEqual(['primary', 'fallback'])
    }
  })
  it('reports busy when every model is busy, error on a bad request', async () => {
    expect(await transcribe(wav, cfg, fakeFetch(reply(503), reply(503)).f)).toMatchObject({ ok: false, reason: 'busy' })
    expect(await transcribe(wav, cfg, fakeFetch(reply(400)).f)).toMatchObject({ ok: false, reason: 'error' })
  })
  it('no speech → empty, never a made-up transcript', async () => {
    expect(await transcribe(wav, cfg, fakeFetch(reply(200, '<none>')).f)).toMatchObject({ ok: false, reason: 'empty' })
    expect(await transcribe(wav, cfg, fakeFetch(reply(200, '  ')).f)).toMatchObject({ ok: false, reason: 'empty' })
  })
  it('hedges: a slow primary is overtaken by the fallback, and the loser is aborted', async () => {
    let primaryAborted = false
    const f = (async (url: string, init: RequestInit) => {
      if (String(url).includes('/primary:')) return new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => { primaryAborted = true; rej(new Error('aborted')) }))
      return reply(200, 'ផ្ទេរ ១០០ ដុល្លារ')
    }) as unknown as typeof fetch
    const r = await transcribe(wav, cfg, f, 1000, 20)
    expect(r).toMatchObject({ ok: true, model: 'fallback' })
    expect(r.ms).toBeLessThan(500)
    expect(primaryAborted).toBe(true)
  })
  it('a fast primary answer does not start the fallback', async () => {
    const { f, calls } = fakeFetch(reply(200, 'ok'))
    await transcribe(wav, cfg, f, 1000, 50)
    await new Promise(r => setTimeout(r, 80))
    expect(calls).toEqual(['primary'])
  })

  it('sends the per-model thinking level and reports the bare model name', async () => {
    const bodies: string[] = []
    const f = (async (_u: string, init: RequestInit) => { bodies.push(String(init.body)); return reply(200, 'ok') }) as unknown as typeof fetch
    const r = await transcribe(wav, { key: 'k', models: ['gemini-3-flash-preview:minimal', 'fallback'] }, f)
    expect(r).toMatchObject({ ok: true, model: 'gemini-3-flash-preview' })
    expect(JSON.parse(bodies[0]).generationConfig).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } })
  })

  it('no key → unconfigured without a network call', async () => {
    const { f, calls } = fakeFetch()
    expect(await transcribe(wav, { key: '', models: ['x'] }, f)).toMatchObject({ ok: false, reason: 'unconfigured' })
    expect(calls).toEqual([])
  })
})

describe('wav', () => {
  it('encodes a valid 16 kHz mono PCM file that wavInfo accepts', () => {
    expect(wavInfo(encodeWav(new Float32Array(16000 * 3)))).toEqual({ ms: 3000 })
  })
  it('rejects non-WAV, too long and stereo/odd formats', () => {
    expect(wavInfo(new TextEncoder().encode('not a wav file at all, definitely not a riff header..').buffer)).toBeNull()
    expect(wavInfo(encodeWav(new Float32Array(16000 * 61)))).toBeNull()
    const stereo = encodeWav(new Float32Array(1600)); new DataView(stereo).setUint16(22, 2, true)
    expect(wavInfo(stereo)).toBeNull()
  })
  it('downsamples 48 kHz → 16 kHz by length and keeps level', () => {
    const s = new Float32Array(48000).fill(0.5)
    const d = downsample(s, 48000)
    expect(d.length).toBe(16000)
    expect(peak(d)).toBeCloseTo(0.5)
  })
  it('raw PCM16 for streaming matches the WAV payload', () => {
    const s = new Float32Array([0, 0.5, -0.5, 1])
    expect(new Uint8Array(toPcm16(s))).toEqual(new Uint8Array(encodeWav(s)).slice(44))
  })
  it('clips out-of-range samples instead of wrapping', () => {
    const v = new DataView(encodeWav(new Float32Array([2, -2])))
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32767, -32768])
  })
})
