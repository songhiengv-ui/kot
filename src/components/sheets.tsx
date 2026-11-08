'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { saveError, useApp, useWorkspaceData, type Account, type NewItem } from '@/lib/app'
import { needsAI, parseCapture, resolveAccounts, type AccountKind, type Candidate, type Resolved } from '@/lib/parse'
import { parseHybrid } from '@/lib/capture'
import { parseAmount, type Cur } from '@/lib/money'
import { CATS, COLORS, KINDS } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { Chip, Icon, Seg, Sheet } from './ui'
import { AccountView, TxSheet } from './tx-sheets'
import { clearDraft, getDraft, setDraft } from './draft'
import { VoiceSheet } from './voice'

const newKey = () => crypto.randomUUID()

export function Sheets() {
  const { sheet, openSheet } = useApp()
  const close = () => openSheet(null)
  if (!sheet) return null
  if (sheet.kind === 'text') return <TextCapture prefill={sheet.prefill} notice={sheet.notice} onClose={close} />
  if (sheet.kind === 'account') return <AccountForm edit={sheet.edit} onClose={close} />
  if (sheet.kind === 'tx') return <TxSheet tx={sheet.tx} fromId={sheet.fromId} draft={sheet.draft} onClose={close} />
  if (sheet.kind === 'acct') return <AccountView id={sheet.id} onClose={close} />
  if (sheet.kind === 'voice') return <VoiceSheet onClose={close} />
  return <ModeSheet onClose={close} />
}

export type Fix = Partial<Pick<Resolved, 'amount' | 'currency' | 'accountId' | 'toAccountId'>>

/** Apply the user's answers to a resolved candidate and clear the flags they answered. Shared by text and voice. */
export function applyFix(r: Resolved, f: Fix = {}): Resolved {
  const y: Resolved = { ...r, ...f, flags: [...r.flags] }
  const drop = (fl: string) => { y.flags = y.flags.filter(x => x !== fl) }
  if (f.currency) drop('currency')
  if (f.accountId) drop('account')
  if (f.toAccountId) drop('to')
  if (y.type === 'transfer' && y.accountId && y.accountId === y.toAccountId) y.flags.push('same')
  else drop('same')
  return y
}

function TextCapture({ prefill = '', notice, onClose }: { prefill?: string; notice?: string; onClose: () => void }) {
  const app = useApp()
  const { t, mode, wsId, money, aName, catName, online } = app
  const { live: accounts } = useWorkspaceData(wsId)
  const [text, setText] = useState(prefill || getDraft())
  const [fixes, setFixes] = useState<Record<number, Fix>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const key = useRef(newKey())

  // Local parse is instant; the AI pass runs only when needsAI() says the local one can't place the amounts.
  const local = useMemo(() => (text.trim() ? parseCapture(text, mode) : []), [text, mode])
  const wantAI = local.length > 0 && needsAI(text, local)
  const [ai, setAi] = useState<{ text: string; candidates: Candidate[]; usedAI: boolean } | null>(null)
  useEffect(() => {
    if (!wantAI) return
    let live = true
    const id = setTimeout(() => parseHybrid(text, mode, 'text').then(r => { if (live) setAi({ text, ...r }) }), 700)
    return () => { live = false; clearTimeout(id) }
  }, [text, mode, wantAI])
  const aiPending = wantAI && ai?.text !== text
  const usedAI = !aiPending && wantAI && !!ai?.usedAI
  const parsed = usedAI ? ai!.candidates : local

  const items = useMemo(() => parsed.map((c, i) => applyFix(resolveAccounts(c, accounts, true), fixes[i])), [parsed, accounts, fixes])
  const canSave = items.length > 0 && items.every(x => x.flags.length === 0 && x.amount && x.currency && x.accountId) && online && !busy && !aiPending
  const fix = (i: number, f: Fix) => setFixes(s => ({ ...s, [i]: { ...s[i], ...f } }))
  const acct = (id: string | null) => accounts.find(a => a.id === id)

  async function save() {
    if (!canSave) return
    setBusy(true); setErr(null)
    const payload: NewItem[] = items.map(x => ({
      type: x.type, amount: x.amount!, currency: x.currency!, account_id: x.accountId!,
      ...(x.type === 'transfer' ? { to_account_id: x.toAccountId! } : { category_id: x.category }),
      note: x.note || undefined,
    }))
    try {
      const ids = await app.record(payload, key.current, 'text')
      clearDraft()
      const first = items[0]
      const msg = items.length > 1 ? `${app.dig(items.length)} · ${t.saved}`
        : first.type === 'transfer' ? `${aName(acct(first.accountId))} → ${aName(acct(first.toAccountId))} · ${money(first.amount!, first.currency!)}`
        : `${first.note || catName(first.category)} · ${money(first.amount!, first.currency!)}`
      onClose()
      app.toast({ msg, icon: 'check_circle', undo: async () => { await app.voidTxs(ids, true); app.toast({ msg: t.undone, icon: 'undo' }) } })
    } catch (e) {
      setErr(saveError(e, t))  // keep the draft and the same idempotency key → retry can't duplicate
    } finally { setBusy(false) }
  }

  const sugg = mode === 'business' ? ['Sold 300k today', '15$ delivery ABA', 'Stock 450k cash', 'Transfer 400k cash to ABA']
    : ['5$ coffee ABA', '20k lunch', '15k gas cash', 'Received $200 salary ABA', 'Transfer $100 ABA to ACLEDA']

  return (
    <Sheet onClose={onClose} label={t.qAdd}>
      {notice && <p className="flex gap-2 items-start text-[13px] text-warn bg-warn-bg rounded-2xl px-3.5 py-2.5"><Icon name="mic" className="text-[17px] mt-px" />{notice}</p>}
      <form onSubmit={e => { e.preventDefault(); save() }} className="flex items-center gap-2.5 h-[60px] pl-[18px] pr-2 rounded-[20px] bg-surface ring-[1.5px] ring-accent">
        <label htmlFor="cap" className="sr-only">{t.qAdd}</label>
        <input id="cap" autoFocus value={text} placeholder={t.textPh} enterKeyHint="send" autoComplete="off"
          onChange={e => { setText(e.target.value); setDraft(e.target.value); setFixes({}); setErr(null); key.current = newKey() }}
          className="flex-1 min-w-0 bg-transparent outline-none text-lg" />
        <button type="submit" disabled={!canSave} aria-label={t.save}
          className={`w-11 h-11 rounded-[14px] grid place-items-center text-white transition-colors ${canSave ? 'bg-accent' : 'bg-[#C9C6BC]'}`}>
          <Icon name={busy ? 'more_horiz' : 'arrow_upward'} className="text-[22px]" />
        </button>
      </form>

      {items.length > 0 && <div className="flex flex-col gap-2">
        {items.map((x, i) => {
          const isX = x.type === 'transfer', a = acct(x.accountId), to = acct(x.toAccountId)
          const flagged = x.flags.length > 0
          return (
            <div key={i} className="bg-surface rounded-[18px] px-3.5 py-3 animate-fade">
              <Card single={items.length === 1} onOpen={() => app.openSheet({ kind: 'tx', draft: {
                type: x.type, amount: x.amount ?? undefined, currency: x.currency ?? undefined, account_id: x.accountId ?? undefined,
                to_account_id: x.toAccountId ?? undefined, category_id: x.category === 'transfer' ? undefined : x.category, note: x.note || undefined } })}>
                <span className={`w-[38px] h-[38px] rounded-xl grid place-items-center shrink-0 ${isX ? 'bg-xfer-bg text-xfer' : x.type === 'income' ? 'bg-accent-bg text-accent' : 'bg-sunken text-muted'}`}>
                  <Icon name={CATS[x.category]?.icon ?? 'more_horiz'} className="text-xl" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium truncate">{isX ? `${aName(a)} → ${to ? aName(to) : '?'}` : x.note || catName(x.category)}</span>
                  <span className="flex items-center gap-1.5 text-[12.5px] text-faint truncate">
                    {!isX && <span className="w-[7px] h-[7px] rounded-full" style={{ background: a?.color ?? '#ccc' }} />}
                    {isX ? t.xferNote : `${a ? aName(a) : '—'}${x.usedDefault ? ` (${t.preferred})` : ''} · ${catName(x.category)} · ${x.type === 'income' ? t.income : t.expense}`}
                  </span>
                </span>
                <span className={`text-[17px] font-medium num whitespace-nowrap ${flagged ? 'text-warn' : isX ? 'text-xfer' : x.type === 'income' ? 'text-accent' : ''}`}>
                  {x.amount && x.currency ? money(x.amount, x.currency, x.type === 'income' ? '+' : '') : '?'}
                </span>
                {items.length === 1 && <Icon name="edit" className="text-base text-faint" />}
              </Card>
              {x.currencyAssumed && !fixes[i]?.currency && <p className="text-[12px] text-faint mt-1.5 flex items-center gap-1"><Icon name="info" className="text-[14px]" />{t.assumedRiel}</p>}
              {flagged && <Resolve x={x} accounts={accounts} onFix={f => fix(i, f)} />}
            </div>
          )
        })}
        {items.length === 1 && items[0].type !== 'transfer' && !items[0].flags.includes('account') && accounts.length > 1 &&
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 no-scrollbar">
            {accounts.map(a => <Chip key={a.id} on={items[0].accountId === a.id} dot={a.color} onClick={() => fix(0, { accountId: a.id })}>{aName(a)}</Chip>)}
          </div>}
      </div>}
      {aiPending && <p role="status" className="text-[12.5px] text-faint px-1 flex items-center gap-1.5"><Icon name="more_horiz" className="text-base" />{t.aiChecking}</p>}
      {usedAI && <p className="text-[12.5px] text-warn px-1 flex items-center gap-1.5"><Icon name="info" className="text-base" />{t.aiUsed}</p>}
      {err && <p role="alert" className="text-[13px] text-danger px-1">{err}</p>}
      {!online && <p className="text-[13px] text-warn px-1 flex items-center gap-1.5"><Icon name="cloud_off" className="text-base" />{t.offline}</p>}
      {items.some(x => x.flags.includes('amount') && !x.options) && <p className="text-[13px] text-faint px-1.5">{t.needAmt}</p>}

      {!text && <div>
        <p className="text-[12.5px] text-faint px-1 pb-2">{t.tryThese}</p>
        <div className="flex gap-2 flex-wrap">
          {sugg.map(s => <button key={s} onClick={() => setText(s)} className="min-h-11 px-3.5 rounded-xl bg-surface ring-1 ring-line text-sm">{s}</button>)}
        </div>
      </div>}
    </Sheet>
  )
}

/** The previewed item's summary row; with one item it opens the full editor ("tap any value to fix it"). */
function Card({ single, onOpen, children }: { single: boolean; onOpen: () => void; children: React.ReactNode }) {
  const { t } = useApp()
  return single
    ? <button type="button" onClick={onOpen} className="w-full text-left flex items-center gap-3">{children}<span className="sr-only"> · {t.checkTitle}</span></button>
    : <div className="flex items-center gap-3">{children}</div>
}

export function Resolve({ x, accounts, onFix, dark }: { x: Resolved; accounts: Account[]; onFix: (f: Fix) => void; dark?: boolean }) {
  const { t, money, aName } = useApp()
  const f = x.flags
  const msg = f.includes('same') ? t.sameAcct : f.includes('currency') && x.options ? t.whichCur : f.includes('account') ? t.whichAcct
    : f.includes('to') ? t.whichTo : f.includes('amount') ? t.amountUnclear : f.includes('currency') ? t.whichCur : ''
  const opts: { label: string; go: () => void }[] =
    f.includes('currency') && x.options ? x.options.map(o => ({ label: money(o.amount, o.currency), go: () => onFix({ amount: o.amount, currency: o.currency }) }))
    : f.includes('account') ? accounts.map(a => ({ label: aName(a), go: () => onFix({ accountId: a.id }) }))
    : f.includes('to') || f.includes('same') ? accounts.filter(a => a.id !== x.accountId).map(a => ({ label: aName(a), go: () => onFix({ toAccountId: a.id }) }))
    : []
  return (
    <div className={`flex items-center gap-2 mt-2.5 pt-2.5 border-t flex-wrap ${dark ? 'border-[#2C3029]' : 'border-sunken'}`}>
      <span className={`text-[13px] ${dark ? 'text-[#E2BE7A]' : 'text-warn'}`}>{msg}</span>
      {opts.map(o => <button key={o.label} onClick={o.go} className={`min-h-11 px-3 rounded-xl text-[13.5px] font-medium num ${dark ? 'bg-[#2B2F27] text-[#EDEBE5]' : 'bg-warn-bg text-[#6B450C]'}`}>{o.label}</button>)}
    </div>
  )
}

function AccountForm({ edit, onClose }: { edit?: Account; onClose: () => void }) {
  const { t, lang, wsId, toast, money } = useApp()
  const qc = useQueryClient()
  const [kind, setKind] = useState<AccountKind>(edit?.kind ?? 'aba')
  const [name, setName] = useState(edit?.name ?? '')
  const [cur, setCur] = useState<Cur>(edit?.currency ?? 'USD')
  const [opening, setOpening] = useState('')
  const [color, setColor] = useState<string>(edit?.color ?? KINDS.aba.color)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const key = useRef(newKey())
  const openMinor = opening.trim() ? parseAmount(opening, cur) : 0

  async function save() {
    if (openMinor === null) { setErr(t.needAmt); return }
    setBusy(true); setErr(null)
    if (edit) {
      const { error } = await supabase.from('accounts').update({ kind, name: name.trim() || null, color }).eq('id', edit.id)
      setBusy(false)
      if (error) { setErr(saveError(error, t)); return }
      await qc.invalidateQueries({ queryKey: ['ws', wsId] })
      onClose(); toast({ msg: t.updated, icon: 'check_circle' }); return
    }
    const { error } = await supabase.rpc('create_account', { p_workspace: wsId, p_key: key.current, p_kind: kind, p_name: name, p_currency: cur, p_color: color, p_opening: openMinor })
    setBusy(false)
    if (error) { setErr(saveError(error, t)); return }
    await qc.invalidateQueries({ queryKey: ['ws', wsId] })
    onClose()
    toast({ msg: `${name.trim() || KINDS[kind].name} · ${money(openMinor, cur)}`, icon: 'account_balance_wallet' })
  }

  return (
    <Sheet onClose={onClose} label={edit ? t.editAcct : t.newAcct}>
      <h2 className="text-lg font-semibold">{edit ? t.editAcct : t.newAcct}</h2>
      <div className="grid grid-cols-3 gap-2" role="radiogroup">
        {(Object.keys(KINDS) as AccountKind[]).map(k => (
          <button key={k} role="radio" aria-checked={kind === k}
            onClick={() => { setKind(k); setColor(KINDS[k].color); if (!edit && (k === 'cash' || k === 'wing')) setCur('KHR') }}
            className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center ${kind === k ? 'bg-ink text-bg' : 'bg-surface text-ink-2'}`}>
            <Icon name={KINDS[k].icon || 'account_balance'} className="text-[22px]" /><span className="text-xs leading-tight">{KINDS[k][lang]}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2.5 h-[52px] px-3.5 rounded-[14px] bg-surface">
        <span className="text-[13px] text-faint w-[70px]">{t.name}</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t.namePh} maxLength={40} className="flex-1 min-w-0 bg-transparent outline-none text-[15px]" />
      </label>
      {edit ? <p className="text-[12.5px] text-faint px-1">{edit.currency} · {t.curLocked}</p> : <div className="flex items-center gap-2.5">
        <Seg value={cur} onChange={setCur} options={[['USD', '$ USD'], ['KHR', '៛ KHR']]} className="w-[170px] shrink-0" />
        <label className="flex-1 flex items-center gap-1.5 h-[46px] px-3 rounded-[14px] bg-surface min-w-0">
          <span className="text-xs text-faint whitespace-nowrap">{t.startBal}</span>
          <input value={opening} onChange={e => setOpening(e.target.value.replace(/[^0-9០-៩.,]/g, ''))} inputMode="decimal" placeholder="0"
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-right num" />
        </label>
      </div>}
      <div className="flex gap-2.5 items-center">
        <span className="text-[13px] text-faint w-[70px]">{t.color}</span>
        {COLORS.map(c => <button key={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
          className="w-[30px] h-[30px] rounded-[10px]" style={{ background: c, boxShadow: color === c ? '0 0 0 2px #F4F2EC, 0 0 0 4px #191A17' : 'none' }} />)}
      </div>
      {!edit && <p className="text-[12.5px] text-faint flex gap-1.5 leading-normal"><Icon name="info" className="text-base" /><span className="text-pretty">{t.afNote}</span></p>}
      {err && <p role="alert" className="text-[13px] text-danger">{err}</p>}
      <button onClick={save} disabled={busy} className="h-14 rounded-[18px] bg-ink text-bg text-base font-medium">{busy ? t.saving : t.save}</button>
    </Sheet>
  )
}

function ModeSheet({ onClose }: { onClose: () => void }) {
  const { t, mode, setMode } = useApp()
  return (
    <Sheet onClose={onClose} label={t.modeT}>
      <div className="px-1"><h2 className="text-xl font-semibold">{t.modeT}</h2><p className="text-[13px] text-faint">{t.modeSep}</p></div>
      {(['personal', 'business'] as const).map(m => (
        <button key={m} onClick={() => { setMode(m); onClose() }} aria-pressed={mode === m}
          className={`flex items-center gap-3.5 p-4 rounded-[22px] bg-surface text-left ${mode === m ? 'ring-2 ring-accent' : ''}`}>
          <span className={`w-[46px] h-[46px] rounded-[15px] grid place-items-center text-white ${m === 'business' ? 'bg-[#8A6A3A]' : 'bg-accent'}`}>
            <Icon name={m === 'business' ? 'storefront' : 'person'} className="text-2xl" />
          </span>
          <span className="flex-1"><span className="block text-base font-medium">{t[m]}</span><span className="block text-[12.5px] text-faint">{m === 'business' ? t.bizSub : t.personalSub}</span></span>
          {mode === m && <Icon name="check_circle" fill className="text-2xl text-accent" />}
        </button>
      ))}
    </Sheet>
  )
}
