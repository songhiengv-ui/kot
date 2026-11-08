'use client'
import { useState } from 'react'
import { useApp, useWorkspaceData, type Tx, withApp } from '@/lib/app'
import { Chip, Empty, Icon, TxRow, useDayLabel } from '@/components/ui'
import { PageTitle } from '@/components/header'
import { CATS } from '@/lib/i18n'

export default withApp(function Activity() {
  const { t, wsId, money, aName, catName, openSheet } = useApp()
  const { all: A, txs } = useWorkspaceData(wsId)
  const dayLabel = useDayLabel()
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | Tx['type']>('all')
  const [acct, setAcct] = useState('all')
  const [cat, setCat] = useState('all')
  const ql = q.trim().toLowerCase()
  const usedCats = [...new Set((txs.data ?? []).map(x => x.category_id).filter((c): c is string => !!c))]
  const rows = (txs.data ?? []).filter(x => (type === 'all' || x.type === type) &&
    (acct === 'all' || x.postings.some(p => p.account_id === acct)) && (cat === 'all' || x.category_id === cat) &&
    (!ql || [x.note, catName(x.category_id), ...x.postings.map(p => aName(A.find(a => a.id === p.account_id)))].join(' ').toLowerCase().includes(ql)))
  const groups = new Map<string, Tx[]>()
  rows.forEach(x => { const k = new Date(x.occurred_at).toDateString(); groups.set(k, [...(groups.get(k) ?? []), x]) })

  return (
    <div className="flex flex-col gap-3.5">
      <PageTitle>{t.tabTx}</PageTitle>
      <label className="flex items-center gap-2.5 h-12 px-3.5 rounded-[14px] bg-surface ring-1 ring-line">
        <Icon name="search" className="text-xl text-faint" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="flex-1 min-w-0 bg-transparent outline-none text-[15px]" />
      </label>
      <div className="flex gap-1.5 overflow-x-auto -mx-5 px-5 no-scrollbar">
        {([['all', t.all], ['expense', t.expense], ['income', t.income], ['transfer', t.transfer]] as const).map(([k, l]) =>
          <Chip key={k} on={type === k} onClick={() => setType(k)} dot={k === 'expense' ? '#191A17' : k === 'income' ? '#2E6B5B' : k === 'transfer' ? '#4A5E86' : undefined}>{l}</Chip>)}
      </div>
      <div className="flex gap-1.5 overflow-x-auto -mx-5 px-5 -mt-1.5 no-scrollbar">
        <Chip on={acct === 'all'} onClick={() => setAcct('all')}>{t.allAccts}</Chip>
        {A.map(a => <Chip key={a.id} on={acct === a.id} dot={a.color} onClick={() => setAcct(acct === a.id ? 'all' : a.id)}>{aName(a)}</Chip>)}
      </div>
      {usedCats.length > 1 && <div className="flex gap-1.5 overflow-x-auto -mx-5 px-5 -mt-1.5 no-scrollbar">
        <Chip on={cat === 'all'} onClick={() => setCat('all')}>{t.allCats}</Chip>
        {usedCats.map(c => <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? 'all' : c)}><Icon name={CATS[c]?.icon ?? 'more_horiz'} className="text-[15px]" />{catName(c)}</Chip>)}
      </div>}
      {txs.isPending ? <p className="text-faint text-sm">{t.loading}</p> : !rows.length ? <Empty title={t.noTx} /> :
        [...groups].map(([day, list]) => {
          const k = list.filter(x => x.type === 'expense' && x.currency === 'KHR').reduce((s, x) => s + x.amount, 0)
          const u = list.filter(x => x.type === 'expense' && x.currency === 'USD').reduce((s, x) => s + x.amount, 0)
          return (
            <section key={day} className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline px-1">
                <h2 className="text-[13.5px] font-semibold">{dayLabel(list[0].occurred_at)}</h2>
                <span className="text-[12.5px] text-faint num">{[k ? money(k, 'KHR', '−') : '', u ? money(u, 'USD', '−') : ''].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="bg-surface rounded-[22px] px-3 py-1.5">{list.map(x => <TxRow key={x.id} x={x} accounts={A} onOpen={() => openSheet({ kind: 'tx', tx: x })} />)}</div>
            </section>
          )
        })}
    </div>
  )
})
