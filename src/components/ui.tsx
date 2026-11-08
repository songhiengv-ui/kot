'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp, type Account, type Tx } from '@/lib/app'
import { CATS, KINDS } from '@/lib/i18n'

export const Icon = ({ name, className = '', fill }: { name: string; className?: string; fill?: boolean }) =>
  <span aria-hidden className={`icon ${className}`} style={fill ? { fontVariationSettings: "'FILL' 1" } : undefined}>{name}</span>

/** Keeps sheets above the on-screen keyboard (iOS Safari doesn't resize the layout viewport). */
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const f = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', f); vv.addEventListener('scroll', f)
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f) }
  }, [])
  return inset
}

export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const kb = useKeyboardInset()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => { removeEventListener('keydown', k); prev?.focus?.() }
  }, [onClose])
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-60 bg-[rgba(25,26,23,.35)] animate-fade" />
      <div ref={ref} role="dialog" aria-modal aria-label={label} style={{ bottom: kb }}
        className="fixed inset-x-0 z-61 max-h-[92dvh] overflow-y-auto bg-bg rounded-t-[30px] px-4 pt-2.5 pb-[calc(24px+env(safe-area-inset-bottom))] animate-up flex flex-col gap-3.5
                   md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-auto! md:top-[12vh] md:w-[440px] md:rounded-[30px] md:pb-6">
        <div className="w-[38px] h-[5px] rounded-full bg-[#D6D3CA] mx-auto md:hidden" />
        {children}
      </div>
    </>
  )
}

export function Seg<K extends string>({ value, options, onChange, className = '' }: { value: K; options: [K, string][]; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="radiogroup" className={`flex p-[3px] rounded-xl bg-seg ${className}`}>
      {options.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`flex-1 min-h-10 px-2 rounded-[9px] text-[13.5px] whitespace-nowrap ${value === k ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(30,28,20,.12)]' : 'text-muted'}`}>{l}</button>
      ))}
    </div>
  )
}

export function Chip({ on, onClick, dot, children }: { on: boolean; onClick: () => void; dot?: string; children: ReactNode }) {
  return (
    <button aria-pressed={on} onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 min-h-11 pl-2 pr-3 rounded-xl text-[13.5px] ${on ? 'bg-ink text-bg ring-1 ring-ink' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>
      {dot && <span className="w-4 h-4 rounded-[5px]" style={{ background: dot }} />}{children}
    </button>
  )
}

export function AccountMark({ a, size = 28 }: { a: Pick<Account, 'kind' | 'color'>; size?: number }) {
  const k = KINDS[a.kind]
  return (
    <span className="grid place-items-center shrink-0 font-semibold text-[10.5px] tracking-[.3px] text-white" style={{ width: size, height: size, borderRadius: size / 3, background: 'rgba(255,255,255,.16)' }}>
      {k.icon ? <Icon name={k.icon} className="text-[17px]" /> : k.mark}
    </span>
  )
}

export function AccountCard({ a, onClick }: { a: Account; onClick?: () => void }) {
  const { aName, money, km, t } = useApp()
  return (
    <button onClick={onClick} className="shrink-0 w-[150px] h-[112px] rounded-[20px] text-white p-3.5 flex flex-col justify-between text-left active:scale-[.97] transition-transform" style={{ background: a.color }}>
      <span className="flex items-center gap-2 min-w-0"><AccountMark a={a} /><span className="text-[13.5px] font-medium truncate">{aName(a)}</span></span>
      <span>
        <span className="block text-[11px] opacity-75">{a.currency === 'USD' ? (km ? 'ដុល្លារ' : 'USD') : (km ? 'រៀល' : 'KHR')} · {t.manual}</span>
        <span className="block text-lg font-medium tracking-[-0.3px] num whitespace-nowrap">{money(a.balance, a.currency)}</span>
      </span>
    </button>
  )
}

export function TxRow({ x, accounts, fresh, onOpen }: { x: Tx; accounts: Account[]; fresh?: boolean; onOpen?: () => void }) {
  const { aName, money, catName, dig, t } = useApp()
  const acct = (id?: string) => accounts.find(a => a.id === id)
  const time = dig(new Date(x.occurred_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
  const bg = fresh ? 'bg-accent-bg' : ''
  const Row = onOpen ? 'button' : 'div'
  const rowProps = onOpen ? { type: 'button' as const, onClick: onOpen } : {}
  if (x.type === 'transfer') {
    const from = acct(x.postings.find(p => p.amount < 0)?.account_id), toP = x.postings.find(p => p.amount > 0), to = acct(toP?.account_id)
    const cross = toP && toP.currency !== x.currency
    return (
      <Row {...rowProps} className={`w-full text-left flex items-center gap-3 py-2 px-1.5 rounded-2xl transition-colors duration-1000 hover:bg-[#F7F6F2] ${bg}`}>
        <span className="w-10 h-10 rounded-xl bg-xfer-bg text-xfer grid place-items-center shrink-0"><Icon name="swap_horiz" className="text-[21px]" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium truncate">{aName(from)} → {aName(to)}</span>
          <span className="block text-[12.5px] text-faint truncate">{time} · {x.note || t.transfer}</span>
        </span>
        <span className="text-right">
          <span className="block text-[15px] font-medium num text-xfer whitespace-nowrap"><span className="sr-only">{t.transfer} </span>{money(x.amount, x.currency, '')}</span>
          {cross && <span className="block text-[11px] text-faint whitespace-nowrap">→ {money(toP!.amount, toP!.currency, '')}</span>}
        </span>
      </Row>
    )
  }
  const inc = x.type === 'income', a = acct(x.postings[0]?.account_id)
  return (
    <Row {...rowProps} className={`w-full text-left flex items-center gap-3 py-2 px-1.5 rounded-2xl transition-colors duration-1000 hover:bg-[#F7F6F2] ${bg}`}>
      <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${inc ? 'bg-accent-bg text-accent' : 'bg-sunken text-muted'}`}>
        <Icon name={(CATS[x.category_id ?? 'other'] ?? CATS.other).icon} className="text-[21px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium truncate">{x.note || catName(x.category_id)}</span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-faint whitespace-nowrap overflow-hidden">
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: a?.color ?? '#ccc' }} />{time} · {aName(a)} · {catName(x.category_id)}
        </span>
      </span>
      <span className={`text-[15px] font-medium num whitespace-nowrap ${inc ? 'text-accent' : 'text-ink'}`}>
        <span className="sr-only">{inc ? t.income : t.expense} </span>{money(x.amount, x.currency, inc ? '+' : '−')}
      </span>
    </Row>
  )
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2.5 px-4 pt-7 pb-5">
      <span className="w-16 h-16 rounded-full bg-accent-bg grid place-items-center"><Icon name="graphic_eq" className="text-[30px] text-accent" /></span>
      <span className="text-lg font-medium">{title}</span>
      {sub && <span className="text-sm text-muted max-w-[260px] text-pretty">{sub}</span>}
      {action}
    </div>
  )
}

/** Day buckets: Today / Yesterday / weekday date. */
export function useDayLabel() {
  const { t, date } = useApp()
  return (iso: string) => {
    const d = new Date(iso), today = new Date()
    const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
    if (diff === 0) return t.today
    if (diff === 1) return t.yesterday
    return date(d, 'short')
  }
}
