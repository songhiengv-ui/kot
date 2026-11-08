// Server only. Khmer speech → transcript via Gemini (REST, no SDK).
// Tries STT_MODEL then STT_FALLBACK_MODELS; busy/unavailable models (429/5xx/404) fall through to the next.
// Never logs audio or transcripts.

export type SttResult =
  | { ok: true; text: string; model: string; ms: number }
  | { ok: false; reason: 'empty' | 'busy' | 'error' | 'unconfigured'; model?: string; ms: number }

const API = 'https://generativelanguage.googleapis.com/v1beta/models'
const NONE = '<none>'
const PROMPT = `Transcribe this short Khmer voice note about money exactly as spoken, in Khmer script.
Write spoken numbers as Khmer digits only if they were spoken as digits; keep number words (ប្រាំ, ម៉ឺន, ពាន់, សែន, លាន, កន្លះ) as words.
Keep bank and wallet names (ABA, ACLEDA, Wing) and English words in Latin letters.
Do not translate, correct, summarize or add anything. If there is no intelligible speech, output exactly ${NONE}.
Output only the transcript.`

/** Models come as "name" or "name:thinkingLevel" — e.g. gemini-3-flash-preview:minimal (≈2 s vs 6–10 s with default thinking).
 *  Per model, because not every model accepts every level (gemini-flash-latest rejects "minimal" with 400). */
export function sttConfig(env = process.env) {
  const models = [env.STT_MODEL, ...(env.STT_FALLBACK_MODELS ?? '').split(',')].map(s => s?.trim()).filter((s): s is string => !!s)
  return { key: env.STT_API_KEY ?? '', models: [...new Set(models)] }
}
const splitModel = (m: string) => { const [name, thinking] = m.split(':'); return { name, thinking } }

export async function transcribe(wav: ArrayBuffer, cfg = sttConfig(), fetchImpl: typeof fetch = fetch, timeoutMs = 12_000, hedgeMs = 4_000): Promise<SttResult> {
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0)
  if (!cfg.key || !cfg.models.length) return { ok: false, reason: 'unconfigured', ms: 0 }
  const data = Buffer.from(wav).toString('base64')

  // One model call. 'next' = this model is busy/unavailable, let the following one try.
  type One = SttResult | { next: 'busy' | 'missing' }
  async function one(spec: string, signal: AbortSignal): Promise<One> {
    const { name: model, thinking } = splitModel(spec)
    try {
      const r = await fetchImpl(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: PROMPT }] }],
          generationConfig: { temperature: 0, ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
      if (r.status === 404) return { next: 'missing' }
      if (r.status === 429 || r.status >= 500) return { next: 'busy' }
      if (!r.ok) return { ok: false, reason: 'error', model, ms: ms() }
      const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').replace(/[។\s]+$/u, '').trim()
      if (!text || text.includes(NONE)) return { ok: false, reason: 'empty', model, ms: ms() }
      return { ok: true, text, model, ms: ms() }
    } catch {
      return { next: 'busy' }  // timeout / network / aborted
    }
  }

  // Hedged: start the next model when the current one fails OR hasn't answered within hedgeMs.
  // First definitive answer wins; the rest are aborted.
  return new Promise<SttResult>(resolve => {
    const stop = new AbortController()
    let started = 0, pending = 0, done = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: SttResult) => { if (done) return; done = true; clearTimeout(timer); stop.abort(); resolve(r) }
    const launch = () => {
      if (done || started >= cfg.models.length) return
      const model = cfg.models[started++]
      pending++
      clearTimeout(timer)
      if (started < cfg.models.length) timer = setTimeout(launch, hedgeMs)
      one(model, stop.signal).then(r => {
        pending--
        if ('next' in r) {
          if (r.next === 'busy') busy = true
          if (started < cfg.models.length) launch()
          else if (!pending) finish({ ok: false, reason: busy ? 'busy' : 'error', model: splitModel(model).name, ms: ms() })
        } else finish(r)
      })
    }
    launch()
  })
}

/** Minimal WAV sanity check: RIFF/WAVE header, PCM, mono, ≤ 60 s at the declared rate. Returns duration in ms. */
export function wavInfo(buf: ArrayBuffer): { ms: number } | null {
  if (buf.byteLength < 44) return null
  const v = new DataView(buf), tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1) return null
  const rate = v.getUint32(24, true), bits = v.getUint16(34, true)
  if (rate < 8000 || rate > 48000 || bits !== 16) return null
  const ms = Math.round(((buf.byteLength - 44) / (rate * 2)) * 1000)
  return ms > 0 && ms <= 60_000 ? { ms } : null
}
