'use client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { supabase } from './supabase'
import { dict, KINDS, CATS, formatDate, type Lang, type T } from './i18n'
import { formatMoney, toKhmerDigits, type Cur } from './money'
import type { AccountKind } from './parse'
import { ItemsSchema } from './items'
import { dayStart, type InsightsRaw } from './insights'

// ── types (mirror supabase/migrations/0001_init.sql) ──────────────────
export type Mode = 'personal' | 'business'
export type Profile = { id: string; display_name: string | null; locale: Lang; khmer_digits: boolean; khr_per_usd: number; voice_consent_at: string | null }
export type Account = { id: string; kind: AccountKind; name: string | null; currency: Cur; color: string; is_default: boolean; archived_at: string | null; balance: number }
export type Tx = { id: string; type: 'expense' | 'income' | 'transfer'; category_id: string | null; note: string | null; occurred_at: string
  amount: number; currency: Cur; postings: { account_id: string; amount: number; currency: Cur }[] }
export type NewItem = { type: Tx['type']; amount: number; currency: Cur; account_id: string; to_account_id?: string; category_id?: string; note?: string; occurred_at?: string }

// ── queries ───────────────────────────────────────────────────────────
const must = <D,>(r: { data: D | null; error: unknown }) => { if (r.error) throw r.error; return r.data as D }

export function useWorkspaceData(wsId: string | undefined) {
  const accounts = useQuery({
    queryKey: ['ws', wsId, 'accounts'], enabled: !!wsId,
    queryFn: async (): Promise<Account[]> => {
      const [a, b] = await Promise.all([
        supabase.from('accounts').select('id,kind,name,currency,color,is_default,archived_at').eq('workspace_id', wsId!).order('created_at'),
        supabase.from('account_balances').select('account_id,balance').eq('workspace_id', wsId!),
      ])
      const bal = new Map(must(b).map((x: { account_id: string; balance: number }) => [x.account_id, Number(x.balance)]))
      return must(a).map((x: Omit<Account, 'balance'>) => ({ ...x, balance: bal.get(x.id) ?? 0 }))
    },
  })
  const txs = useQuery({
    queryKey: ['ws', wsId, 'txs'], enabled: !!wsId,
    queryFn: async (): Promise<Tx[]> => must(await supabase.from('transactions')
      .select('id,type,category_id,note,occurred_at,amount,currency,postings(account_id,amount,currency)')
      .eq('workspace_id', wsId!).is('voided_at', null).neq('type', 'opening')
      .order('occurred_at', { ascending: false }).limit(200)),  // ponytail: first 200; paginate in Activity when needed
  })
  // all = incl. archived (names in history); live = what can be used for new records
  const all = accounts.data
  const live = useMemo(() => (all ?? []).filter(a => !a.archived_at), [all])
  return { accounts, live, all: all ?? EMPTY, txs }
}
const EMPTY: Account[] = []

/** Server rejected the values (PostgREST/Postgres error code) vs. couldn't reach it (no code). */
export const saveError = (e: unknown, t: T) => {
  const x = e as { code?: string; issues?: unknown } | null  // Postgres code or Zod issues → the values were refused
  return x?.code || x?.issues ? t.rejected : t.saveFailed
}

/** Current period (last `days` local days incl. today) + the period before, in one RPC. Invalidated with the workspace. */
export function useInsights(wsId: string, days: 7 | 30, account: string | null = null) {
  return useQuery({
    queryKey: ['ws', wsId, 'insights', days, account],
    queryFn: async (): Promise<InsightsRaw> => {
      const now = new Date()
      return must(await supabase.rpc('insights', {
        p_workspace: wsId, p_from: dayStart(now, days - 1).toISOString(), p_to: new Date(now.getTime() + 60_000).toISOString(),
        p_prev_from: dayStart(now, 2 * days - 1).toISOString(), p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone, p_account: account,
      })) as InsightsRaw
    },
  })
}

// ── app context ───────────────────────────────────────────────────────
type Toast = { msg: string; icon: string; undo?: () => Promise<void> | void; retry?: () => void }
type Ctx = {
  t: T; lang: Lang; km: boolean; profile: Profile; mode: Mode; wsId: string; online: boolean
  setMode: (m: Mode) => void; updateProfile: (p: Partial<Profile>) => void
  dig: (s: string | number) => string
  date: (d: Date, style: 'long' | 'short') => string
  money: (minor: number, cur: Cur, sign?: '+' | '−' | '') => string
  approx: (minorUsd: number) => string
  aName: (a: Pick<Account, 'kind' | 'name'> | undefined) => string
  catName: (c: string | null) => string
  toast: (t: Toast) => void
  record: (items: NewItem[], key: string, source: 'manual' | 'text' | 'voice') => Promise<string[]>
  voidTxs: (ids: string[], voided: boolean) => Promise<void>
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>
  sheet: Sheet; openSheet: (s: Sheet) => void
}
export type Sheet = null | { kind: 'text'; prefill?: string; notice?: string } | { kind: 'account'; edit?: Account } | { kind: 'mode' }
  | { kind: 'tx'; tx?: Tx; fromId?: string; draft?: Partial<NewItem> } | { kind: 'acct'; id: string } | { kind: 'voice' }
const AppCtx = createContext<Ctx | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
const subscribeOnline = (cb: () => void) => { addEventListener('online', cb); addEventListener('offline', cb); return () => { removeEventListener('online', cb); removeEventListener('offline', cb) } }
export const useApp = () => { const c = use(AppCtx); if (!c) throw new Error('useApp outside provider'); return c }
export const useAppReady = () => use(AppCtx) !== null

/** Pages render a loading state until the session is known, so the segment always renders (Next instant-navigation). */
export function withApp<P extends object>(Page: ComponentType<P>) {
  return function Ready(props: P) { return use(AppCtx) ? <Page {...props} /> : <Center><span className="text-faint" aria-label="Loading">…</span></Center> }
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 2 } } }))
  return <QueryClientProvider client={qc}><Session>{children}</Session></QueryClientProvider>
}

function Session({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const profile = useQuery({ queryKey: ['profile'], queryFn: async (): Promise<Profile> => must(await supabase.from('profiles').select('id,display_name,locale,khmer_digits,khr_per_usd,voice_consent_at').single()) })
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: async (): Promise<{ id: string; kind: Mode }[]> => must(await supabase.from('workspaces').select('id,kind')) })
  const [mode, setModeState] = useState<Mode>('personal')
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const [toastState, setToast] = useState<Toast | null>(null)
  const [sheet, openSheet] = useState<Sheet>(null)

  // A still-valid token for a deleted user has no profile row (PostgREST PGRST116) → sign out instead of erroring.
  useEffect(() => {
    if ((profile.error as { code?: string } | null)?.code === 'PGRST116')
      supabase.auth.signOut().then(() => { location.href = '/login' })  // eslint-disable-line @next/next/no-location-assign-relative-destination
  }, [profile.error])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore preference after SSR
    try { if (localStorage.getItem('kat.mode') === 'business') setModeState('business') } catch {}
  }, [])

  const updateProfile = useMutation({
    mutationFn: async (p: Partial<Profile>) => { must(await supabase.from('profiles').update(p).eq('id', profile.data!.id)) },
    onMutate: (p) => { qc.setQueryData(['profile'], (old: Profile) => ({ ...old, ...p })); if (p.locale) try { localStorage.setItem('kat.lang', p.locale) } catch {} },
    onSettled: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  }).mutate

  const toast = useCallback((x: Toast) => {
    clearTimeout(toastTimer); setToast(x)
    toastTimer = setTimeout(() => setToast(null), x.retry ? 10_000 : 8000)
  }, [])

  const value = useMemo<Ctx | null>(() => {
    const p = profile.data, ws = workspaces.data?.find(w => w.kind === mode)
    if (!p || !ws) return null
    const lang = p.locale, t = dict[lang], km = lang === 'km'
    const dig = (s: string | number) => (km && p.khmer_digits ? toKhmerDigits(String(s)) : String(s))
    const money = (minor: number, cur: Cur, sign?: '+' | '−' | '') => formatMoney(minor, cur, { sign, khmerDigits: km && p.khmer_digits })
    const invalidate = () => qc.invalidateQueries({ queryKey: ['ws', ws.id] })
    return {
      t, lang, km, profile: p, mode, wsId: ws.id, online, sheet, openSheet,
      setMode: (m) => { setModeState(m); try { localStorage.setItem('kat.mode', m) } catch {} },
      updateProfile, dig, money, date: (d, style) => formatDate(d, lang, style, dig),
      approx: (u) => '≈ ' + money(u, 'USD'),
      aName: (a) => !a ? '—' : a.name ?? (a.kind === 'cash' ? (mode === 'business' ? t.cashDrawer : t.cashKind) : KINDS[a.kind].name),
      catName: (c) => (CATS[c ?? 'other'] ?? CATS.other)[lang],
      toast,
      record: async (items, key, source) => {
        const valid = ItemsSchema.parse(items)  // throws → caller shows 'check the amount'
        const ids = must(await supabase.rpc('record_transactions', { p_workspace: ws.id, p_key: key, p_items: valid, p_source: source })) as string[]
        await invalidate()
        return ids
      },
      voidTxs: async (ids, voided) => {
        for (const id of ids) must(await supabase.rpc('set_transaction_voided', { p_id: id, p_voided: voided }))
        await invalidate()
      },
      rpc: async (fn, args) => { const r = must(await supabase.rpc(fn, args)); await invalidate(); return r },
    }
  }, [profile.data, workspaces.data, mode, online, sheet, qc, toast, updateProfile])

  if (profile.error || workspaces.error) return <Center>{dict.en.error} <button className="underline" onClick={() => location.reload()}>Reload</button></Center>
  return <AppCtx value={value}>{children}{value && <ToastView t={toastState} onClose={() => setToast(null)} undoLabel={value.t.undo} retryLabel={value.t.retry} />}</AppCtx>
}

const Center = ({ children }: { children: ReactNode }) => <div className="min-h-dvh grid place-items-center p-6 text-center">{children}</div>

function ToastView({ t, onClose, undoLabel, retryLabel }: { t: Toast | null; onClose: () => void; undoLabel: string; retryLabel: string }) {
  if (!t) return null
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-8 z-[85] flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 py-2 pl-4 pr-2 rounded-2xl bg-ink text-bg text-sm shadow-[0_12px_30px_-10px_rgba(0,0,0,.4)] animate-rise max-w-full">
        <span className="icon text-[19px] text-[#9CCBB8]" aria-hidden>{t.icon}</span>
        <span className="min-w-0 line-clamp-2">{t.msg}</span>
        {t.undo && <button onClick={async () => { onClose(); await t.undo!() }} className="min-h-11 px-3 rounded-xl bg-[#2C2E29] text-[#CFE3D8] font-medium shrink-0">{undoLabel}</button>}
        {t.retry && <button onClick={() => { onClose(); t.retry!() }} className="min-h-11 px-3 rounded-xl bg-[#2C2E29] text-[#CFE3D8] font-medium shrink-0">{retryLabel}</button>}
      </div>
    </div>
  )
}
