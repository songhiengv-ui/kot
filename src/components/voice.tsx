'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useWorkspaceData, saveError, type NewItem } from '@/lib/app'
import { resolveAccounts, type Candidate } from '@/lib/parse'
import { CATS } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { MAX_MS, micErrorOf, micSupport, startRecording, type MicError, type Recording } from '@/lib/recorder'
import { openSttStream, STREAM_URL } from '@/lib/stream-client'
import { applyFix, Resolve, type Fix } from './sheets'
import { Icon } from './ui'

type VErr = MicError | 'offline' | 'empty' | 'stt'
type Phase =
  | { k: 'consent' } | { k: 'asking' } | { k: 'rec' } | { k: 'processing' }
  | { k: 'review'; transcript: string; candidates: Candidate[]; usedAI: boolean }
  | { k: 'error'; e: VErr }

type Metric = { outcome: 'ok' | 'empty' | 'stt_error' | 'busy'; audio_ms?: number; upload_ms?: number; stt_ms?: number; extract_ms?: number; stt_model?: string; used_ai?: boolean; items?: number }
// Latency per capture (no audio, transcript or amounts). Best effort — never blocks the user.
const logMetric = (m: Metric) => { supabase.from('capture_metrics').insert({ source: 'voice', ...m }).then(() => {}, () => {}) }

export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const { t, mode, wsId, money, aName, catName, online, profile } = app
  const { live: accounts } = useWorkspaceData(wsId)
  const [phase, setPhase] = useState<Phase>(() => !online ? { k: 'error', e: 'offline' } : micSupport() ? { k: 'error', e: micSupport()! } : profile.voice_consent_at ? { k: 'asking' } : { k: 'consent' })
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0))
  const [elapsed, setElapsed] = useState(0)
  const [fixes, setFixes] = useState<Record<number, Fix>>({})
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rec = useRef<Recording | null>(null)
  const sttStream = useRef<ReturnType<typeof openSttStream> | null>(null)
  const [partial, setPartial] = useState('')
  const abort = useRef<AbortController | null>(null)
  const key = useRef(crypto.randomUUID())

  // start recording whenever we enter 'asking'
  useEffect(() => {
    if (phase.k !== 'asking') return
    let live = true, started = false
    // Chirp 3 streaming when enabled; the full clip is still recorded for the Gemini fallback.
    const s = STREAM_URL ? openSttStream(supabase.auth.getSession().then(x => x.data.session?.access_token), mode, setPartial) : null
    sttStream.current = s
    startRecording(
      l => setLevels(v => [...v.slice(1), l]),
      why => { if (why === 'max') finish(); else { rec.current?.cancel(); rec.current = null; sttStream.current?.cancel(); setPhase({ k: 'error', e: 'interrupted' }) } },
      sttStream.current ? pcm => sttStream.current?.push(pcm) : undefined,
    ).then(r => {
      if (!live) { r.cancel(); return }
      started = true
      rec.current = r; setPhase({ k: 'rec' })
    }, e => { if (live) { sttStream.current?.cancel(); setPhase({ k: 'error', e: micErrorOf(e) }) } })
    // an abandoned start (e.g. React dev double-run) must not leave its stream open
    return () => { live = false; if (!started) s?.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable enough; runs once per 'asking'
  }, [phase.k])

  // timer while recording; stop (and keep the clip) if the app goes to the background
  useEffect(() => {
    if (phase.k !== 'rec') return
    const t0 = performance.now(), id = setInterval(() => setElapsed(performance.now() - t0), 250)
    const hide = () => { if (document.visibilityState === 'hidden') finish() }
    document.addEventListener('visibilitychange', hide)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', hide) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.k])

  // release the mic if the sheet closes mid-recording
  useEffect(() => () => { rec.current?.cancel(); sttStream.current?.cancel(); abort.current?.abort() }, [])

  async function finish() {
    const r = rec.current
    if (!r) return
    rec.current = null
    setPhase({ k: 'processing' })
    const { wav, ms, peak } = await r.stop()
    if (ms < 600 || peak < 0.01) { sttStream.current?.cancel(); setPhase({ k: 'error', e: 'empty' }); return }  // nothing said: don't spend an API call
    if (!navigator.onLine) { sttStream.current?.cancel(); setPhase({ k: 'error', e: 'offline' }); return }
    const s = sttStream.current
    sttStream.current = null
    if (s) {
      const f = await s.end()
      if (f) {
        logMetric({ outcome: 'ok', audio_ms: ms, stt_ms: f.stt_ms, stt_model: f.model, used_ai: f.usedAI, items: f.candidates.length })
        if (f.candidates.length) { setFixes({}); key.current = crypto.randomUUID(); setPhase({ k: 'review', transcript: f.transcript, candidates: f.candidates, usedAI: f.usedAI }); return }
      }
      // stream failed / unconfigured / no result → same clip to Gemini below
    }
    abort.current = new AbortController()
    const t0 = performance.now()
    try {
      const res = await fetch(`/api/voice?mode=${mode}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav, signal: abort.current.signal })
      const body = await res.json()
      const upload_ms = Math.max(0, Math.round(performance.now() - t0) - (body.timings?.server_ms ?? 0))
      if (!res.ok) {
        const e: VErr = body.error === 'empty' ? 'empty' : 'stt'
        logMetric({ outcome: e === 'empty' ? 'empty' : body.error === 'busy' ? 'busy' : 'stt_error', audio_ms: ms, upload_ms, stt_ms: body.timings?.stt_ms, stt_model: body.model })
        setPhase({ k: 'error', e }); return
      }
      logMetric({ outcome: 'ok', audio_ms: ms, upload_ms, stt_ms: body.timings.stt_ms, extract_ms: body.timings.extract_ms, stt_model: body.model, used_ai: body.usedAI, items: body.candidates.length })
      if (!body.candidates.length) { setPhase({ k: 'error', e: 'empty' }); return }
      setFixes({}); key.current = crypto.randomUUID()
      setPhase({ k: 'review', transcript: body.transcript, candidates: body.candidates, usedAI: body.usedAI })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setPhase({ k: 'error', e: navigator.onLine ? 'stt' : 'offline' })
    }
  }

  const cancel = () => { rec.current?.cancel(); rec.current = null; sttStream.current?.cancel(); abort.current?.abort(); onClose() }
  const again = () => { setLevels(Array(32).fill(0)); setElapsed(0); setErr(null); setPartial(''); setPhase({ k: 'asking' }) }
  const typeInstead = () => { rec.current?.cancel(); app.openSheet({ kind: 'text' }) }

  // voice never falls back to the default account silently (allowDefault = false)
  const items = useMemo(() => phase.k === 'review' ? phase.candidates.map((c, i) => applyFix(resolveAccounts(c, accounts, false), fixes[i])) : [], [phase, accounts, fixes])
  const unresolved = items.some(x => x.flags.length > 0 || !x.amount || !x.currency || !x.accountId)
  const acct = (id: string | null) => accounts.find(a => a.id === id)

  async function save() {
    if (phase.k !== 'review' || unresolved || saving) return
    const payload: NewItem[] = items.map(x => ({
      type: x.type, amount: x.amount!, currency: x.currency!, account_id: x.accountId!, note: x.note || undefined,
      ...(x.type === 'transfer' ? { to_account_id: x.toAccountId! } : { category_id: x.category }),
    }))
    setSaving(true); setErr(null)
    try {
      const ids = await app.record(payload, key.current, 'voice')
      const f = items[0]
      onClose()
      app.toast({ msg: items.length > 1 ? `${app.dig(items.length)} · ${t.saved}` : `${f.note || catName(f.category)} · ${money(f.amount!, f.currency!)}`, icon: 'check_circle',
        undo: async () => { await app.voidTxs(ids, true); app.toast({ msg: t.undone, icon: 'undo' }) } })
    } catch (e) {
      setErr(saveError(e, t)); setSaving(false)  // same key → a retry can't duplicate
    }
  }

  const secs = Math.min(MAX_MS, elapsed) / 1000
  return (
    <div role="dialog" aria-modal aria-label={t.qVoice}
      className="fixed inset-0 z-[70] bg-[#131511] text-[#EDEBE5] flex flex-col px-5 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] animate-fade">
      <div className="w-full max-w-md mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <button onClick={cancel} aria-label={t.cancel} className="w-11 h-11 rounded-full bg-[#22251F] grid place-items-center"><Icon name="close" className="text-[22px]" /></button>
          <span className="text-[13px] text-[#8D9689]">{t[mode]}</span>
        </div>

        {phase.k === 'consent' && <Centered>
          <span className="w-14 h-14 rounded-2xl bg-[#22251F] grid place-items-center"><Icon name="lock" className="text-[28px] text-[#9CCBB8]" /></span>
          <h2 className="text-2xl font-medium">{t.vConsentT}</h2>
          <p className="text-[15px] text-[#9AA396] text-pretty">{t.vConsentS}</p>
          <div className="flex flex-col gap-2.5 w-full mt-4">
            <button onClick={() => { app.updateProfile({ voice_consent_at: new Date().toISOString() }); setPhase({ k: 'asking' }) }}
              className="h-14 rounded-[20px] bg-[#EDEBE5] text-[#131511] font-medium flex items-center justify-center gap-2"><Icon name="mic" className="text-xl" />{t.vConsentOk}</button>
            <TypeBtn onClick={typeInstead} label={t.typeInstead} />
          </div>
        </Centered>}

        {(phase.k === 'asking' || phase.k === 'rec' || phase.k === 'processing') && <>
          <div className="flex-1 flex flex-col justify-center gap-4 px-1">
            <p role="status" className="text-sm text-[#9CCBB8]">{phase.k === 'asking' ? t.askMic : phase.k === 'rec' ? t.listening : t.processing}</p>
            {partial  // live words from Chirp while speaking (only when streaming is on)
              ? <p aria-live="polite" className={`text-[28px] leading-snug text-pretty transition-colors ${phase.k === 'processing' ? 'text-[#6F786C]' : ''}`}>{partial}</p>
              : <><p className="text-[28px] leading-snug">{t.sayIt}</p><p className="text-[15px] text-[#6F786C]">{t.sayEx}</p></>}
          </div>
          <div aria-hidden className="flex justify-center items-center gap-1 h-20">
            {levels.map((l, i) => <span key={i} className="w-1 rounded-full bg-[#9CCBB8] transition-[height] duration-100"
              style={{ height: phase.k === 'rec' ? Math.max(4, Math.min(64, l * 160)) : 4, opacity: phase.k === 'rec' ? 1 : 0.4 }} />)}
          </div>
          <p className="text-center text-sm num text-[#8D9689]">{phase.k === 'rec' ? `${app.dig(secs.toFixed(0))} / ${app.dig(MAX_MS / 1000)}s` : ' '}</p>
          <div className="flex items-center justify-center gap-7 mt-4">
            <button onClick={typeInstead} aria-label={t.typeInstead} className="w-12 h-12 rounded-full bg-[#22251F] grid place-items-center"><Icon name="keyboard" className="text-[22px]" /></button>
            <button onClick={finish} disabled={phase.k !== 'rec'} aria-label={t.stop}
              className="relative w-[78px] h-[78px] rounded-full bg-[#EDEBE5] grid place-items-center disabled:opacity-50">
              {phase.k === 'rec' && <span className="absolute inset-0 rounded-full border-2 border-[#9CCBB8] animate-ping" />}
              {phase.k === 'processing' ? <Icon name="more_horiz" className="text-3xl text-[#131511]" /> : <span className="w-6 h-6 rounded-[7px] bg-[#C2483B]" />}
            </button>
            <button onClick={cancel} aria-label={t.cancel} className="w-12 h-12 rounded-full bg-[#22251F] grid place-items-center"><Icon name="delete" className="text-[22px]" /></button>
          </div>
          <p className="text-[13px] text-[#8D9689] text-center mt-2.5">{phase.k === 'rec' ? t.tapStop : ' '}</p>
        </>}

        {phase.k === 'review' && <>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5 pt-5 animate-rise">
            <p className="text-[15px] text-[#7F887C] leading-normal"><span className="sr-only">{t.heard}: </span>«{phase.transcript}»</p>
            <h2 className="text-2xl font-medium tracking-[-0.4px]">{t.found} {app.dig(items.length)} {t.items}</h2>
            {items.map((x, i) => {
              const isX = x.type === 'transfer', a = acct(x.accountId), to = acct(x.toAccountId)
              const open = () => app.openSheet({ kind: 'tx', draft: { type: x.type, amount: x.amount ?? undefined, currency: x.currency ?? undefined, account_id: x.accountId ?? undefined, to_account_id: x.toAccountId ?? undefined, category_id: isX ? undefined : x.category, note: x.note || undefined } })
              return (
                <div key={i} className={`bg-[#1E211C] rounded-[22px] p-3.5 ${x.flags.length ? 'ring-1 ring-[#5A4A2A]' : ''}`}>
                  <button type="button" onClick={items.length === 1 ? open : undefined} className="w-full text-left flex items-center gap-3">
                    <span className={`w-11 h-11 rounded-[14px] grid place-items-center shrink-0 ${isX ? 'bg-[#262A33] text-[#9FB0D6]' : x.type === 'income' ? 'bg-[#24362F] text-[#9CCBB8]' : 'bg-[#2A2E27] text-[#CFD6CB]'}`}>
                      <Icon name={CATS[x.category]?.icon ?? 'more_horiz'} className="text-[22px]" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-medium truncate">{isX ? `${aName(a)} → ${to ? aName(to) : '?'}` : x.note || catName(x.category)}</span>
                      <span className="block text-[12.5px] text-[#8D9689] truncate">{isX ? t.xferNote : `${a ? aName(a) : '—'} · ${catName(x.category)} · ${x.type === 'income' ? t.income : t.expense}`}</span>
                    </span>
                    {/* the amount is the field STT can get wrong — shown large so it's checked */}
                    <span className={`text-[22px] font-medium tracking-[-0.4px] num whitespace-nowrap ${x.flags.length ? 'text-[#E2BE7A]' : x.type === 'income' ? 'text-[#9CCBB8]' : ''}`}>
                      {x.amount && x.currency ? money(x.amount, x.currency, x.type === 'income' ? '+' : '') : '?'}
                    </span>
                  </button>
                  {x.flags.length > 0 && <Resolve dark x={x} accounts={accounts} onFix={f => setFixes(s => ({ ...s, [i]: { ...s[i], ...f } }))} />}
                </div>
              )
            })}
            {phase.usedAI && <p className="text-[12.5px] text-[#E2BE7A] flex items-center gap-1.5"><Icon name="info" className="text-base" />{t.aiUsed}</p>}
            {items.length === 1 && <p className="text-[12.5px] text-[#6F786C] flex items-center gap-1.5"><Icon name="edit" className="text-[15px]" />{t.tapToFix}</p>}
            {err && <p role="alert" className="text-[13px] text-[#E2A58F]">{err}</p>}
          </div>
          <div className="flex gap-2.5 pt-3">
            <button onClick={again} aria-label={t.recordAgain} className="w-[58px] h-[58px] rounded-[20px] bg-[#22251F] grid place-items-center shrink-0"><Icon name="mic" className="text-2xl" /></button>
            <button onClick={save} disabled={unresolved || saving}
              className={`flex-1 h-[58px] rounded-[20px] flex items-center justify-center gap-2 text-base font-medium ${unresolved ? 'bg-[#2B2F27] text-[#7F887C]' : 'bg-[#9CCBB8] text-[#131511]'}`}>
              <Icon name="check" className="text-xl" />{saving ? t.saving : unresolved ? t.resolveFirst : t.saveAll}
            </button>
          </div>
        </>}

        {phase.k === 'error' && <>
          <Centered>
            <span className="w-[60px] h-[60px] rounded-[20px] bg-[#2A2620] text-[#E2BE7A] grid place-items-center">
              <Icon name={phase.e === 'denied' || phase.e === 'nomic' ? 'mic_off' : phase.e === 'offline' ? 'cloud_off' : 'hearing_disabled'} className="text-3xl" />
            </span>
            <h2 className="text-[28px] font-medium tracking-[-0.4px]">{t[`vErr_${phase.e === 'stt' ? 'stt' : phase.e}` as keyof typeof t]}</h2>
            <p className="text-[15.5px] text-[#9AA396] text-pretty">{t[`vErr_${phase.e}S` as keyof typeof t]}</p>
          </Centered>
          <div className="flex flex-col gap-2.5">
            {!['unsupported', 'insecure', 'offline'].includes(phase.e) && <button onClick={again} className="h-[58px] rounded-[20px] bg-[#EDEBE5] text-[#131511] font-medium flex items-center justify-center gap-2"><Icon name="mic" className="text-xl" />{t.tryAgain}</button>}
            <TypeBtn onClick={typeInstead} label={t.typeInstead} />
          </div>
        </>}
      </div>
    </div>
  )
}

const Centered = ({ children }: { children: React.ReactNode }) => <div className="flex-1 flex flex-col justify-center items-start gap-3.5 px-1 animate-rise">{children}</div>
const TypeBtn = ({ onClick, label }: { onClick: () => void; label: string }) =>
  <button onClick={onClick} className="h-[54px] rounded-[20px] bg-[#22251F] flex items-center justify-center gap-2 text-[15px]"><Icon name="keyboard" className="text-xl" />{label}</button>
