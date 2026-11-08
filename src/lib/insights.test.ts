import { describe, expect, it } from 'vitest'
import { bars, dayTotal, lastDays, pctChange, ranked, risingCategory, sumOf, val, type InsightsRaw } from './insights'

const now = new Date(2026, 10, 8, 10, 0)  // local Nov 8
const raw: InsightsRaw = {
  totals: [{ type: 'expense', currency: 'USD', total: 500, n: 1 }, { type: 'expense', currency: 'KHR', total: 41000, n: 2 }],
  prev: [{ type: 'expense', currency: 'KHR', total: 20500 }],
  by_category: [{ type: 'expense', category_id: 'food', currency: 'KHR', total: 41000 }, { type: 'expense', category_id: 'coffee', currency: 'USD', total: 500 }],
  prev_by_category: [{ type: 'expense', category_id: 'food', currency: 'KHR', total: 20500 }, { type: 'expense', category_id: 'coffee', currency: 'USD', total: 1000 }],
  by_account: [],
  series: [
    { d: '2026-11-08', type: 'expense', currency: 'USD', total: 500 },
    { d: '2026-11-07', type: 'expense', currency: 'KHR', total: 20500 },
    { d: '2026-11-02', type: 'expense', currency: 'KHR', total: 20500 },
  ],
  largest: null,
}

describe('insights derivations', () => {
  it('≈ mode converts at the shown rate; single-currency modes are exact and exclusive', () => {
    expect(val({ currency: 'KHR', total: 41000 }, 'ALL', 4100)).toBe(1000)
    expect(val({ currency: 'KHR', total: 41000 }, 'USD', 4100)).toBe(0)
    expect(sumOf(raw.totals, 'expense', 'ALL', 4100)).toBe(1500)
    expect(sumOf(raw.totals, 'expense', 'KHR', 4100)).toBe(41000)
  })
  it('percent change, and null when nothing to compare', () => {
    expect(pctChange(1500, 500)).toBe(200)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(100, 0)).toBeNull()
  })
  it('today / yesterday / last 7 days from local-date series', () => {
    expect(dayTotal(raw.series, 'expense', now, 0, 'ALL', 4100)).toBe(500)
    expect(dayTotal(raw.series, 'expense', now, 1, 'ALL', 4100)).toBe(500)
    expect(lastDays(raw.series, 'expense', now, 7, 'ALL', 4100)).toBe(1500)
    expect(lastDays(raw.series, 'expense', now, 2, 'KHR', 4100)).toBe(20500)
  })
  it('bars: 7 daily bars ending today; 30 days → five 6-day bars that add up', () => {
    const b7 = bars(raw.series, 'expense', now, 7, 'ALL', 4100)
    expect(b7.map(b => b.v)).toEqual([500, 0, 0, 0, 0, 500, 500])
    expect(b7.at(-1)!.last).toBe(true)
    const b30 = bars(raw.series, 'expense', now, 30, 'ALL', 4100)
    expect(b30).toHaveLength(5)
    expect(b30.reduce((s, b) => s + b.v, 0)).toBe(1500)
  })
  it('ranks by converted value and finds the category that grew > 15 %', () => {
    expect(ranked(raw.by_category, r => r.category_id, 'expense', 'ALL', 4100)).toEqual([{ id: 'food', v: 1000 }, { id: 'coffee', v: 500 }])
    expect(risingCategory(raw, 'ALL', 4100)).toEqual({ id: 'food', pct: 100 })  // coffee fell, food doubled
  })
})
