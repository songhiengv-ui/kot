'use client'
import { useApp, useWorkspaceData, withApp } from '@/lib/app'
import { convertApprox } from '@/lib/money'
import { KINDS } from '@/lib/i18n'
import { AccountMark, Icon } from '@/components/ui'
import { PageTitle } from '@/components/header'

export default withApp(function Accounts() {
  const { t, lang, km, wsId, money, approx, aName, profile, openSheet, dig } = useApp()
  const { live: A, all } = useWorkspaceData(wsId)
  const archived = all.filter(a => a.archived_at)
  const usd = A.filter(a => a.currency === 'USD').reduce((s, a) => s + a.balance, 0)
  const khr = A.filter(a => a.currency === 'KHR').reduce((s, a) => s + a.balance, 0)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t.accounts}</PageTitle>
      <p className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-sunken-2 text-[13px] text-muted leading-normal">
        <Icon name="shield_person" className="text-lg" /><span className="text-pretty">{t.manualNote}</span>
      </p>
      <div>
        <p className="text-[13px] text-faint">{t.tracked}</p>
        <p className="text-[32px] font-medium tracking-[-1px] num">{approx(usd + convertApprox(khr, 'KHR', 'USD', profile.khr_per_usd))}</p>
        <p className="text-[12.5px] text-faint">{money(usd, 'USD')} + {money(khr, 'KHR')} · {t.at} {dig(profile.khr_per_usd)} ៛ = $1</p>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {A.map(a => (
          <button key={a.id} onClick={() => openSheet({ kind: 'acct', id: a.id })} className="flex items-center gap-3.5 p-3.5 rounded-[22px] bg-surface text-left active:scale-[.99] transition-transform">
            <span className="w-[46px] h-[46px] rounded-[15px] grid place-items-center shrink-0" style={{ background: a.color }}><AccountMark a={a} size={34} /></span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 text-[15.5px] font-medium">{aName(a)}
                {a.is_default && <span className="text-[10.5px] font-medium text-accent bg-accent-bg px-1.5 py-px rounded-md">{t.preferred}</span>}</span>
              <span className="block text-[12.5px] text-faint">{KINDS[a.kind][lang]} · {a.currency === 'USD' ? (km ? 'ដុល្លារ' : 'USD') : (km ? 'រៀល' : 'KHR')}</span>
            </span>
            <span className="text-right">
              <span className="block text-[17px] font-medium num whitespace-nowrap">{money(a.balance, a.currency)}</span>
              <span className="block text-[11px] text-faint">{t.manual}</span>
            </span>
          </button>
        ))}
        <button onClick={() => openSheet({ kind: 'account' })} className="flex items-center justify-center gap-2 h-14 rounded-[20px] border-[1.5px] border-dashed border-dash text-ink-2 text-[15px]">
          <Icon name="add" className="text-xl" />{t.addAcct}
        </button>
      </div>
      <button onClick={() => openSheet({ kind: 'tx' })} className="flex items-center gap-3 p-3.5 rounded-[20px] bg-surface text-left">
        <span className="w-10 h-10 rounded-xl bg-xfer-bg text-xfer grid place-items-center"><Icon name="swap_horiz" className="text-[21px]" /></span>
        <span className="flex-1 text-[15px] font-medium">{t.transfer}</span>
        <Icon name="chevron_right" className="text-xl text-[#B5B6AD]" />
      </button>
      {archived.length > 0 && <details className="group">
        <summary className="min-h-11 flex items-center gap-1 px-1 text-[13.5px] text-muted cursor-pointer list-none">
          {t.archived} ({dig(archived.length)})<Icon name="expand_more" className="text-lg group-open:rotate-180 transition-transform" />
        </summary>
        <div className="flex flex-col gap-2 mt-1">
          {archived.map(a => (
            <button key={a.id} onClick={() => openSheet({ kind: 'acct', id: a.id })} className="flex items-center gap-3 px-3.5 py-3 rounded-[18px] bg-sunken-2 text-left">
              <span className="w-[34px] h-[34px] rounded-[11px] opacity-60" style={{ background: a.color }} />
              <span className="flex-1 text-[14.5px]">{aName(a)}</span>
              <span className="text-sm text-faint num">{money(a.balance, a.currency)}</span>
            </button>
          ))}
        </div>
      </details>}
    </div>
  )
})
