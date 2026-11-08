import { describe, expect, it } from 'vitest'
import { relay, type ChirpResponse, type RelayDeps, type SpeechStream, type WsLike } from './chirp-relay'

function fakeWs() {
  const handlers: Record<string, ((...a: unknown[]) => unknown)[]> = {}
  const out: Record<string, unknown>[] = []
  let closed = false
  return {
    ws: {
      send: (s: string) => out.push(JSON.parse(s)),
      close: () => { closed = true },
      on: (ev: string, fn: (...a: unknown[]) => unknown) => { (handlers[ev] ??= []).push(fn) },
    } as unknown as WsLike,
    out, closed: () => closed,
    text: async (m: object) => { for (const h of handlers.message ?? []) await h(Buffer.from(JSON.stringify(m)), false) },
    audio: async (b: Buffer) => { for (const h of handlers.message ?? []) await h(b, true) },
  }
}
function fakeStream() {
  const h: Record<string, ((x?: unknown) => void)[]> = {}
  const writes: object[] = []
  let ended = false, destroyed = false
  const s: SpeechStream = {
    write: (r: object) => { writes.push(r) },
    end: () => { ended = true },
    on: ((ev: string, fn: (x?: unknown) => void) => { (h[ev] ??= []).push(fn) }) as SpeechStream['on'],
    destroy: () => { destroyed = true },
  }
  return { s, writes, ended: () => ended, destroyed: () => destroyed,
    data: (r: ChirpResponse) => h.data?.forEach(f => f(r)), emit: (ev: string, x?: unknown) => h[ev]?.forEach(f => f(x)) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const deps = (stream: ReturnType<typeof fakeStream>, over: Partial<RelayDeps> = {}): RelayDeps => ({
  verify: async t => (t === 'good' ? 'user-1' : null),
  open: () => stream.s,
  config: { recognizer: 'r', streamingConfig: {} },
  parse: async (text, mode) => ({ candidates: [{ type: 'expense', amount: 500, currency: 'USD', category: 'coffee', note: text + mode, accountHint: 'aba', toAccountHint: null, flags: [] }], usedAI: false }),
  ...over,
})
const pcm = (n = 3200) => Buffer.alloc(n)

describe('chirp relay', () => {
  it('auths, streams audio, relays partials, then parses the final transcript', async () => {
    const st = fakeStream(), c = fakeWs()
    relay(c.ws, deps(st))
    await c.text({ type: 'start', token: 'good', mode: 'personal' })
    expect(c.out).toEqual([{ type: 'ready' }])
    expect(st.writes[0]).toEqual({ recognizer: 'r', streamingConfig: {} })  // config goes first
    await c.audio(pcm())
    expect(st.writes[1]).toEqual({ audio: pcm() })
    st.data({ results: [{ alternatives: [{ transcript: 'ចាយ ៥' }], isFinal: false }] })
    st.data({ results: [{ alternatives: [{ transcript: 'ចាយ ៥ ដុល្លារ' }], isFinal: true }] })
    st.data({ results: [{ alternatives: [{ transcript: 'តាម ABA' }], isFinal: false }] })
    expect(c.out.filter(m => m.type === 'partial').map(m => m.text)).toEqual(['ចាយ ៥', 'ចាយ ៥ ដុល្លារ', 'ចាយ ៥ ដុល្លារ តាម ABA'])
    await c.text({ type: 'end' })
    expect(st.ended()).toBe(true)
    st.data({ results: [{ alternatives: [{ transcript: 'តាម ABA។' }], isFinal: true }] })
    st.emit('end'); await tick()
    const final = c.out.at(-1)!
    expect(final).toMatchObject({ type: 'final', transcript: 'ចាយ ៥ ដុល្លារ តាម ABA', model: 'chirp_3', usedAI: false })
    expect((final.candidates as { note: string }[])[0].note).toBe('ចាយ ៥ ដុល្លារ តាម ABApersonal')
    expect(c.closed()).toBe(true)
  })

  it('rejects a bad token before opening any Chirp stream', async () => {
    let opened = false
    const st = fakeStream(), c = fakeWs()
    relay(c.ws, deps(st, { open: () => { opened = true; return st.s } }))
    await c.text({ type: 'start', token: 'bad', mode: 'personal' })
    expect(c.out).toEqual([{ type: 'error', reason: 'unauthorized' }])
    expect(opened).toBe(false)
  })

  it('ignores audio before auth; rejects odd-sized or oversized frames', async () => {
    const st = fakeStream(), c = fakeWs()
    relay(c.ws, deps(st))
    await c.audio(pcm())
    expect(st.writes).toEqual([])
    await c.text({ type: 'start', token: 'good', mode: 'business' })
    await c.audio(Buffer.alloc(3))
    expect(c.out.at(-1)).toEqual({ type: 'error', reason: 'bad_request' })
    expect(st.destroyed()).toBe(true)
  })

  it('ends the stream itself at the 30 s cap', async () => {
    const st = fakeStream(), c = fakeWs()
    relay(c.ws, deps(st, { maxAudioBytes: 6400 }))
    await c.text({ type: 'start', token: 'good', mode: 'personal' })
    await c.audio(pcm()); await c.audio(pcm()); await c.audio(pcm())
    expect(st.ended()).toBe(true)
    expect(st.writes.length).toBe(3)  // config + 2 frames; the 3rd triggered the end
  })

  it('no speech → empty; Chirp error mid-stream → busy (client falls back to Gemini)', async () => {
    const a = fakeStream(), ca = fakeWs()
    relay(ca.ws, deps(a))
    await ca.text({ type: 'start', token: 'good', mode: 'personal' })
    await ca.text({ type: 'end' }); a.emit('end'); await tick()
    expect(ca.out.at(-1)).toEqual({ type: 'error', reason: 'empty' })

    const b = fakeStream(), cb = fakeWs()
    relay(cb.ws, deps(b))
    await cb.text({ type: 'start', token: 'good', mode: 'personal' })
    b.emit('error', new Error('UNAVAILABLE'))
    expect(cb.out.at(-1)).toEqual({ type: 'error', reason: 'busy' })
  })

  it('times out waiting for Chirp after end, but keeps what it already heard', async () => {
    const st = fakeStream(), c = fakeWs()
    relay(c.ws, deps(st, { finalTimeoutMs: 10 }))
    await c.text({ type: 'start', token: 'good', mode: 'personal' })
    st.data({ results: [{ alternatives: [{ transcript: 'ផ្ទេរ ១០០ ដុល្លារ' }], isFinal: false }] })
    await c.text({ type: 'end' })
    await new Promise(r => setTimeout(r, 30))
    expect(c.out.at(-1)).toMatchObject({ type: 'final', transcript: 'ផ្ទេរ ១០០ ដុល្លារ' })
  })
})
