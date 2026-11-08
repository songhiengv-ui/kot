'use client'
import { useState } from 'react'
import { useApp, useInsights, useWorkspaceData, withApp } from '@/lib/app'
import { bars, dayTotal, lastDays, modeCur, pctChange, ranked, risingCategory, sumOf, type CurMode } from '@/lib/insights'
import { CATS } from '@/lib/i18n'
import { AccountMark, Chip, Icon, Seg } from '@/components/ui'
import { PageTitle } from '@/components/header'

export default withApp(function Insights() {
  const { t, km, wsId, mode, money, aName, catName, dig, date, profile } = useApp()
  const { all, live } = useWorkspaceData(wsId)
  const [days, setDays] = useState<7 | 30>(30)
  const [cm, setCm] = useState<CurMode>('ALL')
  const [acct, setAcct] = useState<string | null>(null)
  const [ask, setAsk] = useState<string | null>(null)
  const [now] = useState(() => new Date())
  const q = useInsights(wsId, days, acct), q30 = useInsights(wsId, 30, acct)
  const rate = profile.khr_per_usd, biz = mode === 'business', metric = biz ? 'income' : 'expense'
  const fmt = (v: number) => (cm === 'ALL' ? '≈ ' : '') + money(v, modeCur(cm))
  const rateTxt = `${dig(rate.toLocaleString('en-US'))} ៛ = $1`

  if (q.isPending || q30.isPending) return <><PageTitle>{t.tabInsights}</PageTitle><p className="text-faint text-sm">{t.loading}</p></>
  if (q.error || !q.data || !q30.data) return <><PageTitle>{t.tabInsights}</PageTitle><p className="text-danger text-sm">{t.error}</p></>
  const r = q.data, r30 = q30.data

  const total = sumOf(r.totals, metric, cm, rate), prev = sumOf(r.prev, metric, cm, rate), pct = pctChange(total, prev)
  const inT = sumOf(r.totals, 'income', cm, rate), outT = sumOf(r.totals, 'expense', cm, rate), net = inT - outT
  const cats = ranked(r.by_category, x => x.category_id, 'expense', cm, rate).slice(0, 6)
  const accts = ranked(r.by_account, x => x.account_id, 'expense', cm, rate)
  const B = bars(r.series, metric, now, days, cm, rate), bmax = Math.max(1, ...B.map(b => b.v))
  const rising = risingCategory(r, cm, rate)
  const A = (id: string) => all.find(a => a.id === id)
  const n = dig(days)
  const head = biz ? (km ? `${n} ថ្ងៃចុងក្រោយ លក់បាន ${fmt(total)}` : `You took in ${fmt(total)} in the last ${days} days.`)
    : (km ? `${n} ថ្ងៃចុងក្រោយ អ្នកចាយ ${fmt(total)}` : `You spent ${fmt(total)} in the last ${days} days.`)
  const down = pct !== null && pct < 0, good = biz ? !down : down
  const sub = pct === null || pct === 0 ? null : km ? `${down ? 'តិច' : 'ច្រើន'}ជាង ${n} ថ្ងៃមុន ${dig(Math.abs(pct))}%` : `${Math.abs(pct)}% ${down ? 'less' : 'more'} than the ${days} days before`
  const note = cm === 'ALL' ? (km ? `≈ បំប្លែងតាមអត្រា ${rateTxt} · ចំនួនដើមមិនផ្លាស់ប្ដូរ` : `≈ converted at ${rateTxt} · original amounts unchanged`)
    : km ? `បង្ហាញតែប្រតិបត្តិការជា${cm === 'USD' ? 'ដុល្លារ' : 'រៀល'}` : `Only records in ${cm === 'USD' ? 'dollars' : 'riel'}`

  // Deterministic "quick answers": templates over the same verified sums.
  const food = sumOf(r.by_category, 'expense', cm, rate, x => x.category_id === 'food' || x.category_id === 'coffee')
  const big = r.largest, bigA = big ? A(big.account_id) : undefined
  const answers: [string, string, string | null][] = [
    ['all', km ? 'ចាយសរុបគ្រប់គណនីប៉ុន្មាន?' : 'Total spent across all accounts?', km ? `${fmt(outT)} · ការផ្ទេរមិនរាប់បញ្ចូល` : `${fmt(outT)} — transfers between your accounts aren’t counted.`],
    ['food', km ? 'ចាយលើម្ហូបប៉ុន្មាន?' : 'How much on food & drinks?', km ? `${fmt(food)} លើម្ហូប និងភេសជ្ជៈ។` : `${fmt(food)} on food & drinks.`],
    ['acct', km ? 'ចាយពីគណនីណាច្រើនជាងគេ?' : 'Which account did I spend most from?', accts[0] ? `${aName(A(accts[0].id))} — ${fmt(accts[0].v)}` : null],
    ['big', km ? 'ចំណាយធំជាងគេ?' : 'Biggest expense?', big ? `${catName(big.category_id)} — ${money(big.amount, big.currency)} · ${aName(bigA)} · ${date(new Date(big.occurred_at), 'short')}` : null],
    ['net', biz ? (km ? 'លំហូរសាច់ប្រាក់?' : 'Cash flow?') : (km ? 'សន្សំបានប៉ុន្មាន?' : 'How much did I keep?'),
      `${km ? 'ចូល' : 'In'} ${fmt(inT)} · ${km ? 'ចេញ' : 'out'} ${fmt(outT)} → ${cm === 'ALL' ? '≈ ' : ''}${money(Math.abs(net), modeCur(cm), net >= 0 ? '+' : '−')}`],
  ]
  const answer = answers.find(a => a[0] === ask)

  const cards: { icon: string; tone: string; text: string }[] = []
  if (cats[0] && outT) cards.push({ icon: CATS[cats[0].id]?.icon ?? 'more_horiz', tone: 'bg-accent-bg text-accent',
    text: km ? `${catName(cats[0].id)} ជាប្រភេទចំណាយធំជាងគេ — ${dig(Math.round(cats[0].v / outT * 100))}% នៃចំណាយ។` : `${catName(cats[0].id)} is your biggest category — ${Math.round(cats[0].v / outT * 100)}% of spending.` })
  if (accts.length > 1) cards.push({ icon: 'account_balance_wallet', tone: 'bg-sunken text-muted',
    text: km ? `អ្នកចាយតាម ${aName(A(accts[0].id))} ច្រើនជាងគេ (${fmt(accts[0].v)})។` : `Most spending went through ${aName(A(accts[0].id))} (${fmt(accts[0].v)}).` })
  if (rising) cards.push({ icon: 'north_east', tone: 'bg-warn-bg text-warn',
    text: km ? `ចំណាយលើ${catName(rising.id)} កើនឡើង ${dig(rising.pct)}% ធៀបនឹង ${n} ថ្ងៃមុន។` : `${catName(rising.id)} is up ${rising.pct}% on the ${days} days before.` })

  const tiles: [string, number][] = [
    [t.today, dayTotal(r30.series, metric, now, 0, cm, rate)], [t.days7, lastDays(r30.series, metric, now, 7, cm, rate)], [t.days30, lastDays(r30.series, metric, now, 30, cm, rate)],
  ]
  const short = (v: number) => !v ? '' : cm === 'KHR' ? dig(Math.round(v / 1000) + 'k') : dig('$' + Math.round(v / 100))
  const curLabel = cm === 'KHR' ? '៛' : '$'

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t.tabInsights}</PageTitle>
      <div className="flex gap-2.5">
        <Seg value={String(days) as '7' | '30'} onChange={v => setDays(Number(v) as 7 | 30)} options={[['7', t.days7], ['30', t.days30]]} className="flex-1" />
        <Seg value={cm} onChange={setCm} options={[['ALL', '≈ ' + curLabel], ['KHR', '៛'], ['USD', '$']]} />
      </div>
      {live.length > 1 && <div className="flex gap-1.5 overflow-x-auto -mx-5 px-5 -mt-1 no-scrollbar">
        <Chip on={!acct} onClick={() => setAcct(null)}>{t.allAccts}</Chip>
        {live.map(a => <Chip key={a.id} on={acct === a.id} dot={a.color} onClick={() => setAcct(acct === a.id ? null : a.id)}>{aName(a)}</Chip>)}
      </div>}

      <section aria-live="polite">
        <h2 className="text-2xl font-medium tracking-[-0.5px] leading-snug text-pretty num">{head}</h2>
        {sub && <p className={`text-sm mt-1.5 flex items-center gap-1 ${good ? 'text-accent' : 'text-[#9A5B1E]'}`}><Icon name={down ? 'south_east' : 'north_east'} className="text-[17px]" />{sub}</p>}
        <p className="text-xs text-faint mt-1.5">{note}</p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([l, v]) => <div key={l} className="bg-surface rounded-2xl px-3 py-2.5 min-w-0"><p className="text-[11.5px] text-faint">{l} · {biz ? t.salesLbl : t.spendingLbl}</p><p className="text-sm font-medium num truncate">{fmt(v)}</p></div>)}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">
          <section className="bg-surface rounded-3xl px-4 pt-[18px] pb-3.5">
            <h3 className="text-[13px] text-faint mb-3.5">{biz ? t.salesLbl : t.spendingLbl} · {days === 7 ? t.days7 : t.days30}</h3>
            <div role="img" aria-label={B.map(b => `${date(b.start, 'short')}: ${fmt(b.v)}`).join('; ')} className="flex items-end gap-2 h-[140px]">
              {B.map((b, i) => (
                <div key={i} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
                  <span className="text-[10.5px] text-muted num whitespace-nowrap">{short(b.v)}</span>
                  <span className={`w-full max-w-[30px] min-h-1 rounded-lg transition-[height] duration-500 ${b.last ? 'bg-accent' : 'bg-[#D9D5CA]'}`} style={{ height: `${Math.round(b.v / bmax * 100)}%` }} />
                </div>
              ))}
            </div>
            <div aria-hidden className="flex gap-2 mt-2">
              {B.map((b, i) => <span key={i} className={`flex-1 text-center text-[11px] ${b.last ? 'text-ink' : 'text-faint'}`}>{days === 7 ? date(b.start, 'short').split(' ')[0].slice(0, 3) : dig(`${b.start.getDate()}/${b.start.getMonth() + 1}`)}</span>)}
            </div>
          </section>

          <section className="bg-surface rounded-3xl p-[18px] flex flex-col gap-3.5">
            <h3 className="text-[13px] text-faint">{biz ? t.cashFlow : t.inOut}</h3>
            {([[t.inLbl, inT, 'bg-accent'], [t.outLbl, outT, 'bg-[#C9B48A]']] as const).map(([l, v, c]) => (
              <div key={l} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm"><span>{l}</span><span className="font-medium num">{fmt(v)}</span></div>
                <div className="h-2 rounded bg-sunken overflow-hidden"><div className={`h-full rounded ${c}`} style={{ width: `${Math.round(v / Math.max(1, inT, outT) * 100)}%` }} /></div>
              </div>
            ))}
            <div className="flex justify-between text-[14.5px] pt-2.5 border-t border-sunken"><span>{biz ? t.cashFlow : t.netLbl}</span>
              <span className={`font-semibold num ${net >= 0 ? 'text-accent' : 'text-[#9A5B1E]'}`}>{cm === 'ALL' ? '≈ ' : ''}{money(Math.abs(net), modeCur(cm), net >= 0 ? '+' : '−')}</span></div>
            {biz && <p className="text-xs text-faint text-pretty">{t.notProfit}</p>}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {cards.length > 0 && <div className="flex flex-col gap-2">{cards.map(c => (
            <div key={c.text} className="flex gap-3 items-start p-3.5 rounded-[20px] bg-surface">
              <span className={`w-9 h-9 rounded-[11px] grid place-items-center shrink-0 ${c.tone}`}><Icon name={c.icon} className="text-[19px]" /></span>
              <p className="flex-1 text-[14.5px] leading-normal text-pretty pt-0.5 num">{c.text}</p>
            </div>))}</div>}

          <section className="bg-ink text-[#EDEBE5] rounded-3xl p-4">
            <h3 className="text-[13px] text-[#B5BDB0] mb-3">{t.quickT}</h3>
            <div className="flex gap-1.5 flex-wrap">
              {answers.map(([k, l]) => <button key={k} aria-pressed={ask === k} onClick={() => setAsk(ask === k ? null : k)}
                className={`min-h-11 px-3 rounded-xl text-[13px] ${ask === k ? 'bg-[#EDEBE5] text-ink' : 'bg-[#2B2E28] text-[#D6DBD2]'}`}>{l}</button>)}
            </div>
            {answer && <div aria-live="polite" className="mt-3.5 pt-3.5 border-t border-[#2C2E29] animate-rise">
              <p className="text-lg leading-normal text-pretty num">{answer[2] ?? t.noData}</p>
              <p className="text-xs text-[#8D9689] mt-1.5">{t.fromRecords} · {days === 7 ? t.days7 : t.days30}{cm === 'ALL' ? ` · ≈ ${rateTxt}` : ''}</p>
            </div>}
          </section>

          {[[t.byCat, cats, (id: string) => <span className="w-9 h-9 rounded-[11px] bg-sunken grid place-items-center shrink-0"><Icon name={CATS[id]?.icon ?? 'more_horiz'} className="text-[19px] text-muted" /></span>, catName] as const,
            [t.byAcct, accts, (id: string) => { const a = A(id); return a ? <span className="w-9 h-9 rounded-[11px] grid place-items-center shrink-0" style={{ background: a.color }}><AccountMark a={a} size={26} /></span> : null }, (id: string) => aName(A(id))] as const,
          ].map(([title, rows, mark, name]) => rows.length > 0 && (
            <section key={title} className="bg-surface rounded-3xl px-4 pt-[18px] pb-2.5">
              <h3 className="text-[13px] text-faint mb-1.5">{title}</h3>
              {rows.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 py-2">
                  {mark(c.id)}
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <div className="flex justify-between gap-2 text-sm"><span className="truncate">{name(c.id)}</span><span className="num font-medium whitespace-nowrap">{fmt(c.v)}</span></div>
                    <div className="h-[5px] rounded bg-sunken"><div className="h-full rounded bg-accent" style={{ width: `${Math.round(c.v / rows[0].v * 100)}%`, opacity: 1 - i * 0.12 }} /></div>
                  </div>
                </div>
              ))}
            </section>
          ))}
          {!total && !outT && !inT && <p className="text-center text-sm text-faint py-6">{t.noData}</p>}
        </div>
      </div>
    </div>
  )
})
