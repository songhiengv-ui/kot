import { describe, expect, it } from 'vitest'
import { ItemSchema, ItemsSchema, suggestRepeats } from './items'
import type { Tx } from './app'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'

describe('ItemSchema', () => {
  const ok = { type: 'expense', amount: 500, currency: 'USD', account_id: A }
  it('accepts integer minor units', () => expect(ItemSchema.safeParse(ok).success).toBe(true))
  it('rejects floats, zero, negatives, unknown currency', () => {
    for (const bad of [{ amount: 2.5 }, { amount: 0 }, { amount: -1 }, { currency: 'EUR' }, { account_id: 'nope' }])
      expect(ItemSchema.safeParse({ ...ok, ...bad }).success).toBe(false)
  })
  it('transfers need two different accounts', () => {
    expect(ItemSchema.safeParse({ ...ok, type: 'transfer' }).success).toBe(false)
    expect(ItemSchema.safeParse({ ...ok, type: 'transfer', to_account_id: A }).success).toBe(false)
    expect(ItemSchema.safeParse({ ...ok, type: 'transfer', to_account_id: B }).success).toBe(true)
  })
  it('batch is 1..10', () => {
    expect(ItemsSchema.safeParse([]).success).toBe(false)
    expect(ItemsSchema.safeParse(Array(11).fill(ok)).success).toBe(false)
  })
})

describe('suggestRepeats', () => {
  const now = Date.parse('2026-11-07T12:00:00Z')
  const tx = (id: string, note: string, amount: number, daysAgo: number, acct = A, type: Tx['type'] = 'expense'): Tx => ({
    id, type, note, amount, currency: 'KHR', category_id: 'food', occurred_at: new Date(now - daysAgo * 864e5).toISOString(),
    postings: [{ account_id: acct, amount: -amount, currency: 'KHR' }],
  })
  it('ranks by frequency, keeps exact amount, skips old, archived and transfers', () => {
    const txs = [
      tx('1', 'Coffee', 4000, 0), tx('2', 'Rice', 8000, 1), tx('3', 'Coffee', 4000, 2), tx('4', 'Coffee', 4000, 3),
      tx('5', 'Rice', 8000, 4), tx('6', 'Old', 1000, 20), tx('7', 'Archived', 1000, 1, B), tx('8', 'Move', 1000, 1, A, 'transfer'),
      tx('9', 'Coffee', 4500, 1),
    ]
    const r = suggestRepeats(txs, new Set([A]), now)
    expect(r.map(x => [x.note, x.amount])).toEqual([['Coffee', 4000], ['Rice', 8000], ['Coffee', 4500]])
  })
})
