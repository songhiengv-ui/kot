'use client'
import { useRef, useState } from 'react'
import { saveError, useApp, useWorkspaceData, type NewItem, type Tx } from '@/lib/app'
import { convertApprox, parseAmount, toInput, type Cur } from '@/lib/money'
import { CATS, CATS_BUSINESS, CATS_PERSONAL } from '@/lib/i18n'
import { ItemSchema } from '@/lib/items'
import { AccountMark, Chip, Icon, Seg, Sheet, TxRow } from './ui'
import { clearDraft } from './draft'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const itemOf = (x: Tx): NewItem => {
  const from = x.postings.find(p => p.amount < 0), to = x.postings.find(p => p.amount > 0)
  return x.type === 'transfer'
    ? { type: 'transfer', amount: x.amount, currency: x.currency, account_id: from!.account_id, to_account_id: to!.account_id, note: x.note ?? undefined, occurred_at: x.occurred_at }
    : { type: x.type, amount: x.amount, currency: x.currency, account_id: x.postings[0].account_id, category_id: x.category_id ?? 'other', note: x.note ?? undefined, occurred_at: x.occurred_at }
}

/** Edit / delete an existing transaction; create a transfer (no tx); or check an unsaved captured item (draft). */
export function TxSheet({ tx, fromId, draft, onClose }: { tx?: Tx; fromId?: string; draft?: Partial<NewItem>; onClose: () => void }) {
  const app = useApp()
  const { t, mode, wsId, money, aName, catName, profile, dig, online } = app
  const { live, all } = useWorkspaceData(wsId)
  const init: Partial<NewItem> | null = tx ? itemOf(tx) : draft ?? null
  const first = fromId ?? live.find(a => !a.is_default)?.id ?? live[0]?.id
  const [type, setType] = useState<Tx['type']>(init?.type ?? 'transfer')
  const [acct, setAcct] = useState(init?.account_id ?? first)
  const [to, setTo] = useState(init?.to_account_id ?? live.find(a => a.id !== (init?.account_id ?? first))?.id)
  const [cur, setCur] = useState<Cur>(init?.currency ?? all.find(a => a.id === first)?.currency ?? 'USD')
  const [amount, setAmount] = useState(init?.amount && init.currency ? toInput(init.amount, init.currency) : '')
  const [cat, setCat] = useState(init?.category_id ?? (mode === 'business' ? 'sales' : 'other'))
  const [note, setNote] = useState(init?.note ?? '')
  const [date, setDate] = useState(ymd(tx ? new Date(tx.occurred_at) : new Date()))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const key = useRef(crypto.randomUUID())

  // archived accounts already on this transaction stay selectable so old records remain editable
  const choices = all.filter(a => !a.archived_at || (tx && (a.id === init?.account_id || a.id === init?.to_account_id)))
  const A = (id?: string) => all.find(a => a.id === id)
  const isX = type === 'transfer'
  const minor = parseAmount(amount, cur)
  const problem = !minor ? t.needAmtShort : !acct ? t.whichAcct : isX && (!to || to === acct) ? t.sameAcct : null
  const pickFrom = (id: string) => { setAcct(id); if (isX) setCur(A(id)!.currency) }

  async function save() {
    setTried(true)
    if (problem || !online) return
    const when = tx ? new Date(tx.occurred_at) : new Date(), [y, m, d] = date.split('-').map(Number)
    when.setFullYear(y, m - 1, d)
    const item: NewItem = { type, amount: minor!, currency: cur, account_id: acct!, note: note.trim() || undefined, occurred_at: when.toISOString(),
      ...(isX ? { to_account_id: to } : { category_id: cat === 'transfer' ? 'other' : cat }) }
    setBusy(true); setErr(null)
    try {
      if (tx) {
        await app.rpc('update_transaction', { p_id: tx.id, p_item: ItemSchema.parse(item) })
        onClose()
        app.toast({ msg: t.updated, icon: 'check_circle', undo: async () => { await app.rpc('update_transaction', { p_id: tx.id, p_item: init }); app.toast({ msg: t.undone, icon: 'undo' }) } })
      } else {
        const ids = await app.record([item], key.current, draft ? 'text' : 'manual')
        if (draft) clearDraft()
        onClose()
        app.toast({ msg: isX ? `${aName(A(acct))} → ${aName(A(to))} · ${money(minor!, cur)}` : `${note.trim() || catName(cat)} · ${money(minor!, cur)}`, icon: 'check_circle',
          undo: async () => { await app.voidTxs(ids, true); app.toast({ msg: t.undone, icon: 'undo' }) } })
      }
    } catch (e) { setErr(saveError(e, t)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!tx) return
    setBusy(true)
    try {
      await app.voidTxs([tx.id], true)
      onClose()
      app.toast({ msg: t.deleted, icon: 'delete', undo: async () => { await app.voidTxs([tx.id], false); app.toast({ msg: t.undone, icon: 'undo' }) } })
    } catch (e) { setErr(saveError(e, t)); setBusy(false) }
  }

  const F = A(acct), T2 = A(to)
  const toMinor = minor && F && T2 ? convertApprox(minor, cur, T2.currency, profile.khr_per_usd) : 0
  const cats = mode === 'business' ? CATS_BUSINESS : CATS_PERSONAL

  return (
    <Sheet onClose={onClose} label={tx ? t.editTitle : draft ? t.checkTitle : t.newXfer}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{tx ? t.editTitle : draft ? t.checkTitle : t.newXfer}</h2>
        {tx && <span className="text-[12.5px] text-faint">{app.date(new Date(tx.occurred_at), 'short')}</span>}
      </div>
      <Seg value={type} onChange={k => { setType(k); if (k === 'transfer' && F) setCur(F.currency); if (k === 'transfer' && (!to || to === acct)) setTo(live.find(a => a.id !== acct)?.id) }}
        options={[['expense', t.expense], ['income', t.income], ['transfer', t.transfer]]} />

      <label className="flex items-baseline justify-center gap-1.5 py-1">
        <span className="sr-only">{t.amount}</span>
        {cur === 'USD' && <span className="text-[40px] text-faint">$</span>}
        <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9០-៩.,]/g, ''))} inputMode="decimal" placeholder="0" autoFocus={!tx}
          style={{ width: `${Math.max(2, amount.length + 0.5)}ch` }}
          className="max-w-[260px] bg-transparent outline-none text-5xl font-medium tracking-[-1.5px] text-center num" />
        {cur === 'KHR' && <span className="text-[34px] text-faint">៛</span>}
      </label>
      {!isX && <Seg value={cur} onChange={setCur} options={[['KHR', '៛ ' + (app.km ? 'រៀល' : 'Riel')], ['USD', '$ ' + (app.km ? 'ដុល្លារ' : 'Dollar')]]} className="self-center w-[220px]" />}

      {isX ? <>
        <Field label={t.fromAcct}>{choices.map(a => <Chip key={a.id} on={acct === a.id} dot={a.color} onClick={() => pickFrom(a.id)}>{aName(a)}</Chip>)}</Field>
        <Field label={t.toAcct}>{choices.filter(a => a.id !== acct).map(a => <Chip key={a.id} on={to === a.id} dot={a.color} onClick={() => setTo(a.id)}>{aName(a)}</Chip>)}</Field>
        {minor && F && T2 && to !== acct && (
          <div className="flex flex-col gap-1.5 px-3.5 py-3 rounded-2xl bg-xfer-bg text-[#33415F] text-[13.5px] num">
            <div className="flex justify-between"><span>{aName(F)}</span><span className="font-medium">{money(minor, cur, '−')}</span></div>
            <div className="flex justify-between"><span>{aName(T2)}</span><span className="font-medium">{F.currency !== T2.currency ? '≈ ' : ''}{money(toMinor, T2.currency, '+')}</span></div>
            {F.currency !== T2.currency && <div className="flex justify-between"><span>{t.rateLbl}</span><span>{dig(profile.khr_per_usd)} ៛ = $1</span></div>}
            <p className="text-[12.5px] text-xfer flex items-center gap-1"><Icon name="check" className="text-[15px]" />{t.xferNote}</p>
          </div>
        )}
      </> : <>
        <Field label={t.account}>{choices.map(a => <Chip key={a.id} on={acct === a.id} dot={a.color} onClick={() => setAcct(a.id)}>{aName(a)}</Chip>)}</Field>
        <div>
          <p className="text-[12.5px] text-faint px-0.5 pb-2">{t.category}</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup">
            {cats.map(c => (
              <button key={c} role="radio" aria-checked={cat === c} onClick={() => setCat(c)}
                className={`flex flex-col items-center gap-1 py-2.5 px-0.5 rounded-[14px] min-w-0 ${cat === c ? 'bg-ink text-bg' : 'bg-surface text-ink-2'}`}>
                <Icon name={CATS[c].icon} className="text-[21px]" /><span className="text-[11.5px] truncate max-w-full">{catName(c)}</span>
              </button>
            ))}
          </div>
        </div>
      </>}

      <label className="flex items-center gap-2.5 h-[50px] px-3.5 rounded-[14px] bg-surface">
        <Icon name="edit_note" className="text-[19px] text-faint" />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={t.noteOpt} aria-label={t.noteOpt} maxLength={200} className="flex-1 min-w-0 bg-transparent outline-none text-[15px]" />
      </label>
      <label className="flex items-center gap-2.5 h-[50px] px-3.5 rounded-[14px] bg-surface">
        <span className="text-[13px] text-faint">{t.date}</span>
        <input type="date" value={date} max={ymd(new Date())} onChange={e => e.target.value && setDate(e.target.value)} className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-right" />
      </label>

      {tried && problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
      {err && <p role="alert" className="text-[13px] text-danger">{err}</p>}
      {!online && <p className="text-[13px] text-warn flex items-center gap-1.5"><Icon name="cloud_off" className="text-base" />{t.offline}</p>}
      <div className="flex gap-2.5">
        {tx && <button onClick={remove} disabled={busy} aria-label={t.del} className="w-14 h-14 rounded-[18px] bg-surface text-danger grid place-items-center shrink-0"><Icon name="delete" className="text-[22px]" /></button>}
        <button onClick={save} disabled={busy} className={`flex-1 h-14 rounded-[18px] text-bg text-base font-medium ${problem ? 'bg-[#B5B2A8]' : 'bg-ink'}`}>
          {busy ? t.saving : isX && !tx && !draft ? t.saveXfer : t.save}
        </button>
      </div>
    </Sheet>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><p className="text-[12.5px] text-faint px-0.5 pb-2">{label}</p><div className="flex gap-1.5 flex-wrap">{children}</div></div>
)

/** Account detail: balance, 30-day movement, recent records, edit / transfer / archive / default. */
export function AccountView({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp()
  const { t, km, wsId, money, aName, openSheet } = app
  const { all, txs } = useWorkspaceData(wsId)
  const [since] = useState(() => Date.now() - 30 * 864e5)  // fixed when the sheet opens
  const a = all.find(x => x.id === id)
  if (!a) return null
  const mine = (txs.data ?? []).filter(x => x.postings.some(p => p.account_id === id))
  // display-only sums of this account's postings (already in account currency, integers from the DB)
  const sum = (pred: (x: Tx, amt: number) => boolean) => mine.filter(x => new Date(x.occurred_at).getTime() >= since)
    .reduce((s, x) => s + x.postings.filter(p => p.account_id === id).reduce((q, p) => q + (pred(x, p.amount) ? p.amount : 0), 0), 0)
  const inA = sum(x => x.type === 'income'), outA = -sum(x => x.type === 'expense'), xf = sum(x => x.type === 'transfer')
  const archived = !!a.archived_at
  // archiving keeps a non-zero balance (decision #18) but says it leaves the total
  const left = !archived && a.balance !== 0 ? ` · ${money(a.balance, a.currency)} ${t.notInTotal}` : ''

  async function toggleArchive() {
    await app.rpc('set_account_archived', { p_id: id, p_archived: !archived })
    onClose()
    app.toast({ msg: `${archived ? t.unarchive : t.archived} · ${aName(a)}${left}`, icon: 'inventory_2',
      undo: async () => { await app.rpc('set_account_archived', { p_id: id, p_archived: archived }) } })
  }

  return (
    <Sheet onClose={onClose} label={aName(a)}>
      <div className="rounded-3xl text-white p-[18px]" style={{ background: a.color }}>
        <div className="flex items-center gap-2.5">
          <AccountMark a={a} size={34} />
          <div className="flex-1"><p className="text-base font-medium">{aName(a)}</p><p className="text-xs opacity-75">{a.currency === 'USD' ? (km ? 'ដុល្លារ' : 'USD') : (km ? 'រៀល' : 'KHR')} · {t.manual}{a.is_default ? ` · ${t.preferred}` : ''}{archived ? ` · ${t.archived}` : ''}</p></div>
        </div>
        <p className="text-4xl font-medium tracking-[-1.2px] mt-[18px] num">{money(a.balance, a.currency)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[[`${t.inLbl} · ${t.d30}`, money(inA, a.currency), 'text-accent'], [`${t.outLbl} · ${t.d30}`, money(outA, a.currency), ''], [t.transfer, money(xf, a.currency, xf >= 0 ? '+' : '−'), 'text-xfer']].map(([l, v, c]) => (
          <div key={l} className="bg-surface rounded-2xl px-3 py-2.5 min-w-0"><p className="text-[11.5px] text-faint">{l}</p><p className={`text-sm font-medium num truncate ${c}`}>{v}</p></div>
        ))}
      </div>
      <div className="bg-surface rounded-[22px] px-3 py-2">
        {mine.length ? mine.slice(0, 6).map(x => <TxRow key={x.id} x={x} accounts={all} onOpen={() => openSheet({ kind: 'tx', tx: x })} />)
          : <p className="p-4 text-center text-sm text-faint">{t.noAcctTx}</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Action icon="edit" label={t.edit} onClick={() => openSheet({ kind: 'account', edit: a })} />
        {!archived && <Action icon="swap_horiz" label={t.transfer} onClick={() => openSheet({ kind: 'tx', fromId: a.id })} />}
        <Action icon="inventory_2" label={archived ? t.unarchive : t.archive} onClick={toggleArchive} warn />
      </div>
      {!archived && !a.is_default && <button onClick={() => app.rpc('set_default_account', { p_id: id }).then(() => app.toast({ msg: `${t.preferred} · ${aName(a)}`, icon: 'check_circle' }))}
        className="min-h-11 text-sm text-accent">{t.setDefault}</button>}
    </Sheet>
  )
}

const Action = ({ icon, label, onClick, warn }: { icon: string; label: string; onClick: () => void; warn?: boolean }) => (
  <button onClick={onClick} className={`h-[50px] rounded-2xl bg-surface flex items-center justify-center gap-1.5 text-[14.5px] ${warn ? 'text-warn' : ''}`}>
    <Icon name={icon} className="text-lg" />{label}
  </button>
)
