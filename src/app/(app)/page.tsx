'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useApp, useInsights, useWorkspaceData, withApp } from '@/lib/app'
import { dayTotal, pctChange, ranked, sumOf } from '@/lib/insights'
import { suggestRepeats } from '@/lib/items'
import { CATS } from '@/lib/i18n'
import { convertApprox } from '@/lib/money'
import { AccountCard, Empty, Icon, TxRow } from '@/components/ui'
import { ModePill } from '@/components/header'

export default withApp(function Home() {
  const { t, dig, date, profile, wsId, money, approx, mode, openSheet } = useApp()
  const { accounts, live: A, all, txs } = useWorkspaceData(wsId)
  const ins = useInsights(wsId, 30).data
  const rate = profile.khr_per_usd
  const usd = A.filter(a => a.currency === 'USD').reduce((s, a) => s + a.balance, 0)
  const khr = A.filter(a => a.currency === 'KHR').reduce((s, a) => s + a.balance, 0)
  const total = usd + convertApprox(khr, 'KHR', 'USD', rate)
  const T = ins  // 30 days, ≈ USD at the shown rate
  const inU = T ? sumOf(T.totals, 'income', 'ALL', rate) : 0, outU = T ? sumOf(T.totals, 'expense', 'ALL', rate) : 0, net = inU - outU
  const biz = mode === 'business'
  const app = useApp()
  const [openedAt] = useState(() => Date.now())  // fixed per visit; avoids impure Date.now() during render
  const repeats = suggestRepeats(txs.data ?? [], new Set(A.map(a => a.id)), openedAt)
  const metric = biz ? 'income' : 'expense', nowD = new Date(openedAt)
  const todayU = T ? dayTotal(T.series, metric, nowD, 0, 'ALL', rate) : 0, yU = T ? dayTotal(T.series, metric, nowD, 1, 'ALL', rate) : 0
  const dPct = todayU ? pctChange(todayU, yU) : null
  const mixAll = T ? ranked(T.by_category, c => c.category_id, 'expense', 'ALL', rate) : []
  const mix = [...mixAll.slice(0, 3), ...(mixAll.length > 3 ? [{ id: '__rest', v: mixAll.slice(3).reduce((s, x) => s + x.v, 0) }] : [])]
  const MIX = ['#2E6B5B', '#6E9C8C', '#B9CFC6', '#D9D5CA']
  async function repeat(x: (typeof repeats)[number]) {
    const item = { type: x.type, amount: x.amount, currency: x.currency, account_id: x.postings[0].account_id, category_id: x.category_id ?? 'other', note: x.note ?? undefined }
    try {
      const ids = await app.record([item], crypto.randomUUID(), 'manual')
      app.toast({ msg: `${x.note || app.catName(x.category_id)} · ${money(x.amount, x.currency)}`, icon: 'check_circle',
        undo: async () => { await app.voidTxs(ids, true); app.toast({ msg: t.undone, icon: 'undo' }) } })
    } catch { app.toast({ msg: t.saveFailed, icon: 'cloud_off' }) }
  }
  const now = new Date()
  const greet = now.getHours() < 12 ? t.greetMorning : t.greet

  const quick = [
    { icon: 'mic', label: t.qVoice, dark: true, go: () => openSheet({ kind: 'voice' }) },
    { icon: 'edit', label: t.qAdd, go: () => openSheet({ kind: 'text' }) },
    { icon: 'swap_horiz', label: t.qXfer, go: () => openSheet({ kind: 'tx' }) },
    { icon: 'add', label: t.addAcct, go: () => openSheet({ kind: 'account' }) },
  ]

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between pt-1.5">
        <div>
          <p className="text-[13px] text-faint">{date(now, 'long')}</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">{greet}{profile.display_name ? `, ${profile.display_name}` : ''}</h1>
        </div>
        <Link href="/settings" aria-label={t.tabSettings} className="w-11 h-11 rounded-full bg-accent-bg text-accent grid place-items-center md:hidden">
          <Icon name="settings" className="text-[21px]" />
        </Link>
      </header>
      <ModePill big />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-5">
          <section aria-label={t.tracked} className="bg-surface rounded-[26px] px-[18px] pt-5 pb-4 shadow-[0_1px_2px_rgba(30,28,20,.04)]">
            <p className="text-[13.5px] text-muted">{t.tracked}</p>
            <p className="text-[42px] font-medium tracking-[-1.6px] leading-tight mt-1 num">{accounts.isPending ? '…' : approx(total)}</p>
            <p className="text-[12.5px] text-faint mt-1">{money(usd, 'USD')} + {money(khr, 'KHR')} · {t.at} {dig(rate)} ៛ = $1</p>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-sunken">
              {[
                { l: `${t.inLbl} · ${t.d30}`, v: approx(inU), c: 'text-accent', dot: '#2E6B5B' },
                { l: `${t.outLbl} · ${t.d30}`, v: approx(outU), c: 'text-ink', dot: '#C9B48A' },
                { l: biz ? t.cashFlow : t.netLbl, v: '≈ ' + money(Math.abs(net), 'USD', net >= 0 ? '+' : '−'), c: net >= 0 ? 'text-accent' : 'text-[#9A5B1E]', dot: '#4A5E86' },
              ].map(f => (
                <div key={f.l} className="min-w-0">
                  <p className="text-xs text-faint flex items-center gap-1"><span className="w-[7px] h-[7px] rounded-full" style={{ background: f.dot }} />{f.l}</p>
                  <p className={`text-[15.5px] font-medium num truncate ${f.c}`}>{T ? f.v : '…'}</p>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-faint mt-3 flex items-center gap-1.5"><Icon name="edit_note" className="text-sm" />{biz ? t.overviewNoteBiz : t.overviewNote}</p>
          </section>

          <section className="flex flex-col gap-2.5">
            <div className="flex justify-between items-center">
              <h2 className="text-[15px] font-semibold">{t.accounts}</h2>
              <Link href="/accounts" className="text-[13px] text-accent min-h-11 flex items-center">{t.seeAll}</Link>
            </div>
            <div className="flex gap-2.5 overflow-x-auto -mx-5 px-5 pb-0.5 no-scrollbar">
              {A.map(a => <AccountCard key={a.id} a={a} onClick={() => openSheet({ kind: 'acct', id: a.id })} />)}
              <button onClick={() => openSheet({ kind: 'account' })} aria-label={t.addAcct} className="shrink-0 w-24 h-[112px] rounded-[20px] border-[1.5px] border-dashed border-dash text-faint flex flex-col items-center justify-center gap-1 text-[12.5px]">
                <Icon name="add" className="text-[22px]" />{t.add}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-4 gap-2">
            {quick.map(q => (
              <button key={q.label} onClick={q.go} className={`flex flex-col items-center gap-1.5 pt-3 pb-2.5 px-0.5 rounded-[18px] text-center active:scale-[.96] transition-transform ${q.dark ? 'bg-ink text-bg' : 'bg-surface text-ink'}`}>
                <Icon name={q.icon} className="text-[23px]" /><span className="text-[11.5px] leading-tight">{q.label}</span>
              </button>
            ))}
          </div>

          {repeats.length > 0 && <section className="flex flex-col gap-2.5">
            <h2 className="text-[13px] text-faint flex items-center gap-1.5"><Icon name="bolt" className="text-base" />{t.repeat}</h2>
            <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-0.5 no-scrollbar">
              {repeats.map(x => (
                <button key={x.id} onClick={() => repeat(x)} className="shrink-0 flex items-center gap-2 min-h-11 pl-2.5 pr-3.5 rounded-[14px] bg-surface ring-1 ring-line text-sm active:scale-[.96] transition-transform">
                  <Icon name={(CATS[x.category_id ?? 'other'] ?? CATS.other).icon} className="text-lg text-muted" />
                  <span>{x.note || app.catName(x.category_id)}</span>
                  <span className="text-faint num">{money(x.amount, x.currency, x.type === 'income' ? '+' : '')}</span>
                </button>
              ))}
            </div>
          </section>}
          {mix.length > 0 && outU > 0 && <Link href="/insights" className="bg-surface rounded-3xl px-[18px] py-4 block">
            <span className="flex justify-between items-baseline"><span className="text-[15px] font-semibold">{t.byCat} · {t.d30}</span><span className="text-[13px] text-muted num">{approx(outU)}</span></span>
            <span aria-hidden className="flex h-2.5 rounded overflow-hidden gap-0.5 my-3">{mix.map((m, i) => <span key={m.id} style={{ width: `${m.v / outU * 100}%`, background: MIX[i] }} />)}</span>
            <span className="grid grid-cols-2 gap-x-3 gap-y-1.5">{mix.map((m, i) => (
              <span key={m.id} className="flex items-center gap-1.5 text-[12.5px] min-w-0"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: MIX[i] }} />
                <span className="flex-1 truncate">{m.id === '__rest' ? (app.km ? 'ផ្សេងទៀត' : 'Everything else') : app.catName(m.id)}</span>
                <span className="text-faint num">{dig(Math.round(m.v / outU * 100))}%</span></span>))}</span>
          </Link>}
        </div>

        <section className="bg-surface rounded-3xl px-3 pt-3.5 pb-2">
          <div className="flex justify-between items-center px-1.5 pb-1.5">
            <div>
              <h2 className="text-[15px] font-semibold">{t.recent}</h2>
              {T && <p className="text-[12.5px] text-faint num">
                {biz ? (app.km ? 'ចូលថ្ងៃនេះ' : 'In today') : (app.km ? 'ចាយថ្ងៃនេះ' : 'Spent today')} {approx(todayU)}
                {dPct !== null && dPct !== 0 && <span className="text-accent"> · {app.km ? `${dPct < 0 ? 'តិច' : 'ច្រើន'}ជាងម្សិលមិញ ${dig(Math.abs(dPct))}%` : `${Math.abs(dPct)}% ${dPct < 0 ? 'less' : 'more'} than yesterday`}</span>}
              </p>}
            </div>
            <Link href="/activity" className="text-[13px] text-accent min-h-11 flex items-center">{t.seeAll}</Link>
          </div>
          {txs.isPending ? <p className="p-4 text-faint text-sm">{t.loading}</p>
            : txs.error ? <p className="p-4 text-danger text-sm">{t.error}</p>
            : !txs.data!.length ? <Empty title={t.emptyT} sub={t.emptyS} action={<button onClick={() => openSheet({ kind: 'text' })} className="text-sm text-accent min-h-11 px-2">{t.qAdd}</button>} />
            : txs.data!.slice(0, 8).map(x => <TxRow key={x.id} x={x} accounts={all} onOpen={() => openSheet({ kind: 'tx', tx: x })} />)}
        </section>
      </div>
    </div>
  )
})
