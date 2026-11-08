import { describe, expect, it } from 'vitest'
import { extractConfig, extractWithAI, reconcile } from './extract'
import { parseCapture } from './parse'

// Mocked model output only — no network.
type Item = { type?: string; amount: string | null; currency: 'USD' | 'KHR' | null; category?: string; note?: string; account?: string | null; toAccount?: string | null }
const item = (i: Item) => ({ type: 'expense', category: 'other', note: '', account: null, toAccount: null, ...i })
const model = (...items: Item[]) => ({ items: items.map(item) })

describe('reconcile', () => {
  it('splits an unseparated Khmer sentence when amounts match the text', () => {
    const text = 'ទិញបាយ ៥ពាន់ ទិញកាហ្វេ ២ដុល្លារ តាម ABA'
    const r = reconcile(text, 'personal', model(
      { amount: '5000', currency: 'KHR', category: 'food', note: 'បាយ', account: 'aba' },
      { amount: '2', currency: 'USD', category: 'coffee', note: 'កាហ្វេ', account: 'aba' },
    ))
    expect(r).toEqual([
      expect.objectContaining({ type: 'expense', amount: 5000, currency: 'KHR', category: 'food', accountHint: 'aba', flags: [] }),
      expect.objectContaining({ type: 'expense', amount: 200, currency: 'USD', category: 'coffee', accountHint: 'aba', flags: [] }),
    ])
  })

  it('transcript with number words', () => {
    const text = 'ទិញបាយប្រាំម៉ឺនរៀលទិញកាហ្វេពីរដុល្លារ'
    const r = reconcile(text, 'personal', model(
      { amount: '50000', currency: 'KHR', category: 'food' },
      { amount: '2', currency: 'USD', category: 'coffee' },
    ))
    expect(r?.map(c => [c.amount, c.currency, c.flags])).toEqual([[50000, 'KHR', []], [200, 'USD', []]])
  })

  it('a priced reading wins over a bare quantity', () => {
    const r = reconcile('ទិញទឹក ៣ ដប ៣ពាន់', 'personal', model({ amount: '3000', currency: 'KHR', category: 'food' }))
    expect(r?.map(c => [c.amount, c.currency, c.flags])).toEqual([[3000, 'KHR', []]])
  })

  it('invented amount not in the text → amount null + flagged', () => {
    const r = reconcile('ទិញបាយ ៥ពាន់ ទិញកាហ្វេ ២ដុល្លារ', 'personal', model(
      { amount: '5000', currency: 'KHR', category: 'food' },
      { amount: '3', currency: 'USD', category: 'coffee' },
    ))!
    expect(r[1]).toMatchObject({ amount: null, currency: null, flags: ['amount'] })
    expect(r[0].flags).toEqual([])
  })

  it('the same reading cannot be used twice', () => {
    const r = reconcile('coffee 2$ tea 5000', 'personal', model(
      { amount: '2', currency: 'USD' }, { amount: '2', currency: 'USD' }, { amount: '5000', currency: 'KHR' },
    ))!
    expect(r.map(c => c.flags.includes('amount'))).toEqual([false, true, false])
  })

  it('model says USD with no currency cue → currency flagged with both readings', () => {
    const r = reconcile('coffee 2 cups 5 lunch 15000', 'personal', model(
      { amount: '5', currency: 'USD', category: 'coffee' },
      { amount: '15000', currency: 'USD', category: 'food' },
    ))!
    expect(r[0]).toMatchObject({ amount: null, currency: null, flags: ['currency'], options: [{ amount: 5000, currency: 'KHR' }, { amount: 500, currency: 'USD' }] })
    expect(r[1]).toMatchObject({ amount: null, currency: null, flags: ['currency'], options: [{ amount: 15000, currency: 'KHR' }, { amount: 1500000, currency: 'USD' }] })
  })

  it("text's explicit currency wins over the model's", () => {
    const r = reconcile('lunch 20000 រៀល tea 1$', 'personal', model({ amount: '20000', currency: 'USD' }, { amount: '1', currency: null }))!
    expect(r.map(c => [c.amount, c.currency])).toEqual([[20000, 'KHR'], [100, 'USD']])
  })

  it('account hints only when named in the text; transfer to same account flagged', () => {
    const r = reconcile('ផ្ទេរ ១០០ ដុល្លារ ពី ABA ទៅ ABA ហើយ coffee 2$', 'personal', model(
      { type: 'transfer', amount: '100', currency: 'USD', account: 'aba', toAccount: 'aba' },
      { amount: '2', currency: 'USD', account: 'wing' },
    ))!
    expect(r[0]).toMatchObject({ type: 'transfer', category: 'transfer', accountHint: 'aba', toAccountHint: 'aba', flags: ['same'] })
    expect(r[1].accountHint).toBeNull()
  })

  it('garbage / off-schema output → null (deterministic fallback)', () => {
    const text = 'coffee 5 2$'
    for (const raw of [null, 'lol', { items: [] }, { items: [{ amount: 5 }] }, { items: [item({ amount: 2 as never, currency: 'USD' })] }, { items: [item({ type: 'refund', amount: '2', currency: 'USD' })] }]) {
      expect(reconcile(text, 'personal', raw)).toBeNull()
    }
  })

  it('off-list category / currency / account are coerced, not trusted', () => {
    const r = reconcile('coffee 5 2$', 'personal', model({ amount: '2', currency: 'EUR' as never, category: 'casino', account: 'paypal' }))!
    expect(r[0]).toMatchObject({ amount: 200, currency: 'USD', category: 'other', accountHint: null, flags: [] })
  })

  it('model drops an explicit amount → fallback', () => {
    expect(reconcile('ទិញបាយ ៥ពាន់ ទិញកាហ្វេ ២ដុល្លារ', 'personal', model({ amount: '5000', currency: 'KHR' }))).toBeNull()
  })

  it('model matches nothing → fallback', () => {
    expect(reconcile('coffee 5 2$', 'personal', model({ amount: '7', currency: 'USD' }))).toBeNull()
  })
})

describe('extractWithAI', () => {
  it('no key / model error / bad JSON → null, caller keeps the local parse', async () => {
    expect(await extractWithAI('coffee 5 2$', 'personal', 'text', async () => null)).toBeNull()
    expect(await extractWithAI('coffee 5 2$', 'personal', 'text', async () => { throw new Error('timeout') })).toBeNull()
    expect(await extractWithAI('coffee 5 2$', 'personal', 'text', async () => JSON.parse('{'))).toBeNull()
  })
  it('valid mocked response is reconciled', async () => {
    const text = 'ទិញបាយប្រាំពាន់រៀលទិញកាហ្វេពីរដុល្លារ'
    expect(parseCapture(text)[0].flags).toContain('amount')
    const r = await extractWithAI(text, 'personal', 'voice', async () => model({ amount: '5000', currency: 'KHR', category: 'food' }, { amount: '2', currency: 'USD', category: 'coffee' }))
    expect(r?.map(c => [c.amount, c.currency, c.category])).toEqual([[5000, 'KHR', 'food'], [200, 'USD', 'coffee']])
  })
})

describe('extractConfig', () => {
  it('gemini on the STT key unless an Anthropic key or provider is set', () => {
    expect(extractConfig({ STT_API_KEY: 'g' })).toEqual({ provider: 'gemini', key: 'g', model: 'gemini-3-flash-preview:minimal' })
    expect(extractConfig({ STT_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })).toMatchObject({ provider: 'anthropic', key: 'a' })
    expect(extractConfig({ EXTRACT_PROVIDER: 'gemini', EXTRACT_API_KEY: 'e', STT_API_KEY: 'g' })).toMatchObject({ provider: 'gemini', key: 'e' })
    expect(extractConfig({}).key).toBe('')
  })
})
