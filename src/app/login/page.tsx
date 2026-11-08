'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dict, KINDS, type Lang } from '@/lib/i18n'

export default function Login() {
  const [lang, setLang] = useState<Lang>('km')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const t = dict[lang]

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore preference after SSR
    try { const l = localStorage.getItem('kat.lang'); if (l === 'en' || l === 'km') setLang(l) } catch {}
    if (new URLSearchParams(location.search).has('error')) setErr(dict.en.authErr)
  }, [])
  const pickLang = (l: Lang) => { setLang(l); try { localStorage.setItem('kat.lang', l) } catch {} }

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}/auth/callback`, data: { locale: lang } } })
    setBusy(false)
    if (error) setErr(error.status === 429 ? error.message : t.authErr); else setSent(true)
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    if (error || !data.user) { setBusy(false); setErr(t.codeErr); return }
    await supabase.from('profiles').update({ locale: lang }).eq('id', data.user.id)
    location.href = '/'  // eslint-disable-line @next/next/no-location-assign-relative-destination -- full load picks up the new session cookie
  }
  const google = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } })

  return (
    <main className="min-h-dvh flex flex-col px-7 pt-[max(56px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))] max-w-md mx-auto">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-accent text-bg grid place-items-center"><span className="icon text-xl" aria-hidden>mic</span></span>
        <span className="text-lg font-semibold">កត់</span>
        <div className="ml-auto flex p-[3px] rounded-xl bg-seg" role="radiogroup" aria-label="Language">
          {(['km', 'en'] as const).map(l => <button key={l} role="radio" aria-checked={lang === l} onClick={() => pickLang(l)}
            className={`min-h-9 px-3 rounded-[9px] text-[13px] ${lang === l ? 'bg-surface shadow-[0_1px_3px_rgba(30,28,20,.12)]' : 'text-muted'}`}>{l === 'km' ? 'ខ្មែរ' : 'English'}</button>)}
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-[18px] py-10">
        <h1 className="text-[44px] leading-[1.22] font-medium tracking-[-1px] whitespace-pre-line">{t.tagline}</h1>
        <p className="text-base text-muted max-w-[300px] text-pretty">{t.obSub}</p>
        <div className="flex gap-1.5 flex-wrap">
          {(['aba', 'acleda', 'wing', 'cash'] as const).map(k => (
            <span key={k} className="flex items-center gap-1.5 py-[5px] pl-[5px] pr-2.5 rounded-full bg-surface text-[13px]">
              <span className="w-5 h-5 rounded-full" style={{ background: KINDS[k].color }} />{k === 'cash' ? KINDS.cash[lang] : KINDS[k].name}
            </span>
          ))}
        </div>
      </div>

      {!sent ? (
        <form onSubmit={send} className="flex flex-col gap-2.5">
          <label htmlFor="email" className="text-[13px] text-faint">{t.email}</label>
          <input id="email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t.emailPh}
            className="h-14 px-4 rounded-[18px] bg-surface ring-1 ring-line outline-none focus:ring-2 focus:ring-accent text-base" />
          <button disabled={busy} className="h-14 rounded-[18px] bg-ink text-bg text-base font-medium">{busy ? '…' : t.sendCode}</button>
          <div className="flex items-center gap-3 text-[13px] text-faint my-1"><span className="flex-1 h-px bg-line" />{t.or}<span className="flex-1 h-px bg-line" /></div>
          <button type="button" onClick={google} className="h-14 rounded-[18px] bg-surface ring-1 ring-line text-base font-medium">{t.google}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-2.5">
          <p className="text-sm text-muted">{t.codeSent} <b className="text-ink">{email}</b></p>
          <label htmlFor="code" className="sr-only">{t.code}</label>
          <input id="code" autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" maxLength={8} value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••"
            className="h-14 px-4 rounded-[18px] bg-surface ring-1 ring-line outline-none focus:ring-2 focus:ring-accent text-2xl tracking-[.4em] text-center num" />
          <button disabled={busy} className="h-14 rounded-[18px] bg-ink text-bg text-base font-medium">{busy ? '…' : t.verify}</button>
          <button type="button" onClick={() => { setSent(false); setCode('') }} className="min-h-11 text-sm text-muted">{t.changeEmail}</button>
        </form>
      )}
      {err && <p role="alert" className="text-[13px] text-danger mt-3 text-center">{err}</p>}
    </main>
  )
}
