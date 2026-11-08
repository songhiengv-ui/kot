'use client'
import { useState } from 'react'
import { useApp, withApp } from '@/lib/app'
import { supabase } from '@/lib/supabase'
import { toCsv } from '@/lib/csv'
import { Icon, Seg } from '@/components/ui'

export default withApp(function Settings() {
  const { t, lang, profile, updateProfile, dig, mode, openSheet, toast } = useApp()
  const [confirm, setConfirm] = useState<string | null>(null)   // null = closed; else the typed word
  const [busy, setBusy] = useState(false)
  // Full reload on purpose: drops the in-memory query cache so the next user never sees this user's data.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const signOut = async () => { await supabase.auth.signOut(); location.href = '/login' }
  const exportCsv = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('export_transactions', { p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
    setBusy(false)
    if (error) return toast({ msg: t.exportFail, icon: 'cloud_off' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }))
    a.download = `kat-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }
  const deleteAccount = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('delete_my_account')
    if (error) { setBusy(false); return toast({ msg: t.deleteFail, icon: 'cloud_off' }) }
    try { localStorage.clear() } catch {}
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    await supabase.auth.signOut({ scope: 'local' }); location.href = '/login'   // the user is gone; just drop the local session
  }
  return (
    <div className="flex flex-col gap-4.5 max-w-xl">
      <h1 className="text-[28px] font-semibold tracking-[-0.6px] pt-1.5">{t.tabSettings}</h1>
      <div className="bg-surface rounded-[22px] px-4 py-1 divide-y divide-sunken">
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-[15px]">{t.language}</span>
          <Seg value={lang} onChange={l => updateProfile({ locale: l })} options={[['km', 'ខ្មែរ'], ['en', 'English']]} className="w-48" />
        </div>
        <div className="py-3">
          <p className="text-[15px]">{t.rate}</p>
          <p className="text-[12.5px] text-faint mb-2">{t.rateSub}</p>
          <div className="flex gap-1.5 flex-wrap">
            {[4000, 4050, 4100].map(r => (
              <button key={r} aria-pressed={profile.khr_per_usd === r} onClick={() => updateProfile({ khr_per_usd: r })}
                className={`min-h-11 px-3 rounded-xl text-[13px] num ${profile.khr_per_usd === r ? 'bg-ink text-bg' : 'bg-sunken text-ink-2'}`}>{dig(r.toLocaleString('en-US'))} ៛</button>
            ))}
          </div>
        </div>
        <button role="switch" aria-checked={profile.khmer_digits} onClick={() => updateProfile({ khmer_digits: !profile.khmer_digits })} className="w-full flex items-center gap-3 py-3 text-left">
          <span className="flex-1"><span className="block text-[15px]">{t.kmDigits}</span><span className="block text-[12.5px] text-faint">{t.kmDigitsSub}</span></span>
          <span className={`w-[46px] h-7 rounded-full p-[3px] transition-colors shrink-0 ${profile.khmer_digits ? 'bg-accent' : 'bg-[#D9D6CC]'}`}>
            <span className={`block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${profile.khmer_digits ? 'translate-x-[18px]' : ''}`} />
          </span>
        </button>
        <button onClick={() => openSheet({ kind: 'mode' })} className="w-full flex items-center justify-between py-3.5 min-h-11">
          <span className="text-[15px]">{t.modeT}</span><span className="flex items-center gap-1 text-sm text-faint">{t[mode]}<Icon name="chevron_right" className="text-lg" /></span>
        </button>
      </div>
      <p className="flex gap-2.5 px-4 py-3.5 rounded-[18px] bg-sunken-2 text-[13px] text-muted leading-normal"><Icon name="lock" className="text-lg" /><span className="text-pretty">{t.privacy}</span></p>
      <div className="bg-surface rounded-[22px] px-4 py-1 divide-y divide-sunken">
        <p className="pt-3 pb-1 text-[12.5px] font-medium text-faint uppercase tracking-wide">{t.yourData}</p>
        <button onClick={exportCsv} disabled={busy} className="w-full flex items-center gap-3 py-3 min-h-11 text-left disabled:opacity-50">
          <Icon name="download" className="text-xl text-muted" />
          <span className="flex-1"><span className="block text-[15px]">{t.exportCsv}</span><span className="block text-[12.5px] text-faint">{t.exportSub}</span></span>
        </button>
        {confirm === null ? (
          <button onClick={() => setConfirm('')} className="w-full flex items-center gap-3 py-3 min-h-11 text-left text-danger">
            <Icon name="delete" className="text-xl" />
            <span className="flex-1"><span className="block text-[15px]">{t.deleteAcct}</span><span className="block text-[12.5px] text-faint">{t.deleteSub}</span></span>
          </button>
        ) : (
          <div className="py-3 flex flex-col gap-2.5">
            <p className="text-[14px] text-danger font-medium">{t.deleteSub}</p>
            <label className="text-[13px] text-muted">{t.deleteType}
              <input value={confirm} onChange={e => setConfirm(e.target.value)} autoFocus autoComplete="off"
                className="mt-1.5 w-full min-h-11 px-3 rounded-xl bg-sunken text-[15px] text-ink" />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 min-h-11 rounded-xl bg-sunken text-[14px]">{t.cancel}</button>
              <button onClick={deleteAccount} disabled={busy || confirm.trim().toUpperCase() !== t.deleteWord.toUpperCase()}
                className="flex-1 min-h-11 rounded-xl bg-danger text-white text-[14px] font-medium disabled:opacity-40">{t.deleteGo}</button>
            </div>
          </div>
        )}
      </div>
      <button onClick={signOut} className="flex items-center gap-3 px-4 min-h-[52px] rounded-[22px] bg-surface text-[15px] text-danger"><Icon name="logout" className="text-xl" />{t.signOut}</button>
    </div>
  )
})
