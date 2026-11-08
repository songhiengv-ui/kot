// Pure derivations over the insights() SQL result. No AI, no invented numbers:
// every figure is a sum of DB rows, either in its own currency or ≈-converted at the user's shown rate.
import { convertApprox, type Cur } from './money'

type Row = { type: 'expense' | 'income'; currency: Cur; total: number }
export type InsightsRaw = {
  totals: (Row & { n: number })[]
  prev: Row[]
  by_category: (Row & { category_id: string | null })[]
  prev_by_category: (Row & { category_id: string | null })[]
  by_account: (Row & { account_id: string })[]
  series: (Row & { d: string })[]
  largest: { id: string; category_id: string | null; currency: Cur; amount: number; account_id: string; occurred_at: string } | null
}
/** ALL = everything ≈ in USD cents at the shown rate; USD / KHR = only records in that currency, exact. */
export type CurMode = 'ALL' | 'USD' | 'KHR'
export const modeCur = (m: CurMode): Cur => (m === 'KHR' ? 'KHR' : 'USD')

export const val = (r: { currency: Cur; total: number }, mode: CurMode, rate: number) =>
  mode === 'ALL' ? convertApprox(Number(r.total), r.currency, 'USD', rate) : r.currency === mode ? Number(r.total) : 0

export const sumOf = <R extends Row>(rows: R[], type: Row['type'], mode: CurMode, rate: number, pred: (r: R) => boolean = () => true) =>
  rows.filter(r => r.type === type && pred(r)).reduce((s, r) => s + val(r, mode, rate), 0)

/** Whole-percent change vs the previous period; null when there's nothing to compare with. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const dayStart = (now: Date, daysAgo: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d }

/** Bars: 7 days → one bar per day; 30 days → five 6-day bars. Oldest first; last bar ends today. */
export function bars(series: InsightsRaw['series'], type: Row['type'], now: Date, days: 7 | 30, mode: CurMode, rate: number) {
  const size = days === 7 ? 1 : 6, n = days / size
  return Array.from({ length: n }, (_, i) => {
    const keys = new Set(Array.from({ length: size }, (_, j) => ymd(dayStart(now, (n - 1 - i) * size + j))))
    const start = dayStart(now, (n - 1 - i) * size + size - 1)
    return { start, v: sumOf(series, type, mode, rate, r => keys.has(r.d)), last: i === n - 1 }
  })
}

/** One local day's total (0 = today, 1 = yesterday). */
export const dayTotal = (series: InsightsRaw['series'], type: Row['type'], now: Date, daysAgo: number, mode: CurMode, rate: number) =>
  sumOf(series, type, mode, rate, r => r.d === ymd(dayStart(now, daysAgo)))

/** Sum over the last `days` local days (inclusive of today) from the series. */
export const lastDays = (series: InsightsRaw['series'], type: Row['type'], now: Date, days: number, mode: CurMode, rate: number) => {
  const from = ymd(dayStart(now, days - 1))
  return sumOf(series, type, mode, rate, r => r.d >= from)
}

/** Group rows by a key, sum in the chosen mode, drop zeros, biggest first. */
export function ranked<R extends Row>(rows: R[], key: (r: R) => string | null, type: Row['type'], mode: CurMode, rate: number) {
  const m = new Map<string, number>()
  for (const r of rows) if (r.type === type) { const k = key(r) ?? 'other'; m.set(k, (m.get(k) ?? 0) + val(r, mode, rate)) }
  return [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, v }))
}

/** The category that grew most vs the previous period (> 15 % and both periods non-zero). */
export function risingCategory(raw: InsightsRaw, mode: CurMode, rate: number) {
  const now = ranked(raw.by_category, r => r.category_id, 'expense', mode, rate)
  const before = new Map(ranked(raw.prev_by_category, r => r.category_id, 'expense', mode, rate).map(x => [x.id, x.v]))
  let best: { id: string; pct: number } | null = null
  for (const { id, v } of now) {
    const p = before.get(id) ?? 0, pct = pctChange(v, p)
    if (pct !== null && pct > 15 && (!best || pct > best.pct)) best = { id, pct }
  }
  return best
}
