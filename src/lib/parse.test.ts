import { describe, expect, it } from 'vitest'
import { formatMoney, parseAmount, convertApprox, toKhmerDigits } from './money'
import { needsAI, parseCapture, resolveAccounts, wordsToDigits, type AccountLite } from './parse'

const one = (s: string) => { const r = parseCapture(s); expect(r).toHaveLength(1); return r[0] }
const amt = (s: string) => { const c = one(s); return [c.amount, c.currency] }

describe('money', () => {
  it('parses to exact minor units, rejects floats beyond precision', () => {
    expect(parseAmount('5', 'USD')).toBe(500)
    expect(parseAmount('2.5', 'USD')).toBe(250)
    expect(parseAmount('1,200.75', 'USD')).toBe(120075)
    expect(parseAmount('0.1', 'USD')).toBe(10)
    expect(parseAmount('1.234', 'USD')).toBeNull()
    expect(parseAmount('២០០០០', 'KHR')).toBe(20000)
    expect(parseAmount('20000.5', 'KHR')).toBeNull()
    expect(parseAmount('-5', 'USD')).toBeNull()
    expect(parseAmount('0', 'KHR')).toBeNull()
  })
  it('formats', () => {
    expect(formatMoney(500, 'USD')).toBe('$5.00')
    expect(formatMoney(-123456, 'USD')).toBe('−$1,234.56')
    expect(formatMoney(20000, 'KHR', { sign: '−' })).toBe('−20,000 ៛')
    expect(formatMoney(500, 'USD', { khmerDigits: true })).toBe('$៥.០០')
    expect(toKhmerDigits('123')).toBe('១២៣')
  })
  it('approximate conversion is explicit-rate and integer', () => {
    expect(convertApprox(500, 'USD', 'KHR', 4100)).toBe(20500)
    expect(convertApprox(20500, 'KHR', 'USD', 4100)).toBe(500)
    expect(convertApprox(1000, 'KHR', 'USD', 4100)).toBe(24)
  })
})

describe('Khmer amounts', () => {
  it('magnitude words', () => {
    expect(amt('៥ ម៉ឺន')).toEqual([50000, 'KHR'])
    expect(amt('៥០ ម៉ឺន')).toEqual([500000, 'KHR'])
    expect(amt('២ម៉ឺន៥')).toEqual([25000, 'KHR'])
    expect(amt('១សែន ២ម៉ឺន')).toEqual([120000, 'KHR'])
    expect(amt('៧ពាន់៥រយ')).toEqual([7500, 'KHR'])
    expect(amt('ប្រាំពីរពាន់ប្រាំរយ')).toEqual([7500, 'KHR'])
    expect(amt('១ម៉ឺន២ពាន់៥រយ')).toEqual([12500, 'KHR'])
    expect(amt('១ សែន')).toEqual([100000, 'KHR'])
    expect(amt('1.5 លាន')).toEqual([1500000, 'KHR'])
    expect(amt('៥ ពាន់')).toEqual([5000, 'KHR'])
    expect(amt('20k lunch')).toEqual([20000, 'KHR'])
  })
  it('explicit currencies', () => {
    expect(amt('ចាយ ២០០០០ រៀល ទិញបាយ')).toEqual([20000, 'KHR'])
    expect(amt('5$ coffee')).toEqual([500, 'USD'])
    expect(amt('$12.50 shirt')).toEqual([1250, 'USD'])
    expect(amt('ចាយ ៥ ដុល្លារ ទិញកាហ្វេ')).toEqual([500, 'USD'])
    expect(one('500 riels water')).toMatchObject({ amount: 500, currency: 'KHR', flags: [] })  // < 1,000: only the cue makes it riel
    expect(one('2 rielsx').currency).toBeNull()  // word boundary after riel(s)
  })
  it('bare small number asks for currency, with both readings', () => {
    const c = one('ចាក់សាំង ២០ តាម Wing')
    expect(c.flags).toContain('currency')
    expect(c.options).toEqual([{ amount: 20000, currency: 'KHR' }, { amount: 2000, currency: 'USD' }])
  })
  it('bare large number is riel, marked assumed', () => {
    const c = one('15000 lunch')
    expect([c.amount, c.currency, c.currencyAssumed, c.flags]).toEqual([15000, 'KHR', true, []])
  })
  it('two numbers in one item is ambiguous', () => {
    expect(one('coffee 5 2$').flags).toContain('amount')
  })
  it('no number → amount flag', () => {
    expect(one('coffee ABA').flags).toContain('amount')
  })
})

describe('colloquial ប្រាំ (5) as transcribed', () => {
  it('reads បាំ / ប៉ាំ as 5 next to a currency or magnitude', () => {
    expect(amt('ចាយបាំដុល្លារ ទិញកាហ្វេតាម ABA')).toEqual([500, 'USD'])
    expect(amt('ចាយ ប៉ាំម៉ឺន ទិញបាយ')).toEqual([50000, 'KHR'])
  })
})

describe('កន្លះ (half)', () => {
  it('adds half the unit after a magnitude or a dollar', () => {
    expect(amt('២ម៉ឺនកន្លះ')).toEqual([25000, 'KHR'])
    expect(amt('ចាយ ១ សែនកន្លះ')).toEqual([150000, 'KHR'])
    expect(amt('ពីរដុល្លារកន្លះ កាហ្វេ')).toEqual([250, 'USD'])
    expect(amt('5k កន្លះ')).toEqual([5500, 'KHR'])
  })
  it('is not doubled with a tail digit and stays out of the note', () => {
    expect(amt('២ម៉ឺន៥')).toEqual([25000, 'KHR'])
    expect(one('បាយ ២ម៉ឺនកន្លះ').note).toBe('បាយ')
  })
})

describe('sentences from the brief', () => {
  it('expense via ABA', () => {
    const c = one('ចាយ ៥ ដុល្លារ ទិញកាហ្វេ តាម ABA')
    expect(c).toMatchObject({ type: 'expense', amount: 500, currency: 'USD', category: 'coffee', accountHint: 'aba', flags: [] })
  })
  it('riel food via ACLEDA', () => {
    expect(one('ចាយ ២០០០០ រៀល ទិញបាយ តាម ACLEDA')).toMatchObject({ type: 'expense', amount: 20000, currency: 'KHR', category: 'food', accountHint: 'acleda' })
  })
  it('withdrawal = transfer to cash', () => {
    expect(one('ដកលុយពី ACLEDA ១០០ដុល្លារ')).toMatchObject({ type: 'transfer', amount: 10000, currency: 'USD', accountHint: 'acleda', toAccountHint: 'cash', flags: [] })
    expect(one('withdraw $50 ABA')).toMatchObject({ type: 'transfer', accountHint: 'aba', toAccountHint: 'cash' })
  })
  it('transfer ABA → ACLEDA', () => {
    expect(one('ផ្ទេរ ១០០ ដុល្លារ ពី ABA ទៅ ACLEDA')).toMatchObject({ type: 'transfer', amount: 10000, currency: 'USD', accountHint: 'aba', toAccountHint: 'acleda' })
  })
  it('two items with ហើយ', () => {
    const r = parseCapture('ចាយ ១៥០០០ រៀល ទិញបាយ ហើយ ២ ដុល្លារ ទិញកាហ្វេ')
    expect(r.map(c => [c.amount, c.currency, c.category])).toEqual([[15000, 'KHR', 'food'], [200, 'USD', 'coffee']])
  })
  it('english shorthand', () => {
    expect(one('5$ coffee ABA')).toMatchObject({ amount: 500, currency: 'USD', accountHint: 'aba', category: 'coffee', note: 'Coffee' })
    expect(one('15k gas cash')).toMatchObject({ amount: 15000, currency: 'KHR', category: 'fuel', accountHint: 'cash' })
    expect(one('Received $200 salary')).toMatchObject({ type: 'income', amount: 20000, category: 'salary' })
    expect(one('Sold 300k today')).toMatchObject({ type: 'income', amount: 300000, category: 'sales' })
    expect(one('Transfer $100 ABA to ACLEDA')).toMatchObject({ type: 'transfer', amount: 10000 })
  })
  it('keeps 1,200 together but splits on comma between items', () => {
    expect(parseCapture('1,200 riel bread, 2$ coffee').map(c => c.amount)).toEqual([1200, 200])
  })
  it('code-switched', () => {
    const r = parseCapture('Sold 300k today ហើយ ចំណាយ delivery ៥ ពាន់')
    expect(r.map(c => [c.type, c.amount, c.category])).toEqual([['income', 300000, 'sales'], ['expense', 5000, 'delivery']])
  })
})

describe('account resolution', () => {
  const A: AccountLite[] = [
    { id: 'aba-usd', kind: 'aba', currency: 'USD', is_default: false },
    { id: 'aba-khr', kind: 'aba', currency: 'KHR', is_default: false },
    { id: 'acl', kind: 'acleda', currency: 'USD', is_default: false },
    { id: 'cash', kind: 'cash', currency: 'KHR', is_default: true },
  ]
  const res = (s: string, allowDefault = true) => resolveAccounts(parseCapture(s)[0], A, allowDefault)
  it('picks by currency when a kind has several accounts', () => {
    expect(res('5$ coffee ABA').accountId).toBe('aba-usd')
    expect(res('20k lunch ABA').accountId).toBe('aba-khr')
  })
  it('text falls back to default (and says so); voice does not', () => {
    expect(res('20k lunch')).toMatchObject({ accountId: 'cash', usedDefault: true, flags: [] })
    expect(res('20k lunch', false)).toMatchObject({ accountId: null, flags: ['account'] })
  })
  it('ambiguous kind is flagged', () => {
    const c = resolveAccounts({ ...parseCapture('coffee ABA')[0] }, A, true)
    expect(c.flags).toContain('account')
  })
  it('transfer resolves both sides and takes source currency for bare amounts', () => {
    expect(res('transfer 100 ACLEDA to cash')).toMatchObject({ accountId: 'acl', toAccountId: 'cash', amount: 10000, currency: 'USD', flags: [] })
    expect(res('transfer $100 ACLEDA to Wing').flags).toContain('to')
  })
})

describe('Khmer number words (transcripts)', () => {
  it('words with magnitude and currency', () => {
    expect(amt('ប្រាំម៉ឺន')).toEqual([50000, 'KHR'])
    expect(amt('ម្ភៃពាន់រៀល')).toEqual([20000, 'KHR'])
    expect(amt('ប្រាំដុល្លារ')).toEqual([500, 'USD'])
    expect(amt('ចាយ ប្រាំ ម៉ឺន ទិញបាយ')).toEqual([50000, 'KHR'])
    expect(amt('ម្ភៃប្រាំពាន់')).toEqual([25000, 'KHR'])
    expect(amt('ពីរម៉ឺនប្រាំ')).toEqual([25000, 'KHR'])
    expect(amt('មួយសែនប្រាំម៉ឺន')).toEqual([150000, 'KHR'])
    expect(amt('មួយលានប្រាំសែនរៀល')).toEqual([1500000, 'KHR'])
    expect(amt('ពីររយហាសិបដុល្លារ')).toEqual([25000, 'USD'])
    expect(amt('ដប់ប្រាំដុល្លារ')).toEqual([1500, 'USD'])
    expect(amt('ប្រាំបួនដុល្លារ')).toEqual([900, 'USD'])
    expect(amt('កៅសិបពាន់')).toEqual([90000, 'KHR'])
  })
  it('converts compound numbers, leaves a lone quantity word alone', () => {
    expect(wordsToDigits('សាមសិប').trim()).toBe('30')
    expect(wordsToDigits('មួយរយ').trim()).toBe('100')
    expect(wordsToDigits('កាហ្វេមួយកែវ')).toBe('កាហ្វេមួយកែវ')
    expect(wordsToDigits('ពី ABA')).toBe('ពី ABA')
    expect(wordsToDigits('រយៈពេល')).toBe('រយៈពេល')
  })
  it('transcript sentence keeps the right fields', () => {
    expect(one('ចាយប្រាំដុល្លារទិញកាហ្វេមួយកែវតាមABA')).toMatchObject({ amount: 500, currency: 'USD', category: 'coffee', flags: [] })
    const r = parseCapture('ទិញបាយម្ភៃពាន់រៀល ហើយ កាហ្វេពីរដុល្លារ')
    expect(r.map(c => [c.amount, c.currency, c.category])).toEqual([[20000, 'KHR', 'food'], [200, 'USD', 'coffee']])
  })
})

describe('needsAI', () => {
  const ai = (s: string) => needsAI(s, parseCapture(s))
  it('simple inputs stay local', () => {
    expect(ai('5$ coffee ABA')).toBe(false)
    expect(ai('20k lunch')).toBe(false)
    expect(ai('ចាយ ៥ ម៉ឺន ទិញបាយ')).toBe(false)
    expect(ai('ចាយ ប្រាំម៉ឺន ទិញបាយ')).toBe(false)
    expect(ai('ចាយ ១៥០០០ រៀល ទិញបាយ ហើយ ២ ដុល្លារ ទិញកាហ្វេ')).toBe(false)
    expect(ai('ចាក់សាំង ២០ តាម Wing')).toBe(false)      // currency question: the model can't answer it either
    expect(ai('coffee ABA')).toBe(false)                 // no number: the model may not invent one
    expect(ai('$5k')).toBe(false)
  })
  it('unsplit multi-item / ambiguous amounts go to AI', () => {
    expect(ai('ទិញបាយ ៥ពាន់ ទិញកាហ្វេ ២ដុល្លារ')).toBe(true)
    expect(ai('ទិញបាយប្រាំពាន់រៀលទិញកាហ្វេពីរដុល្លារ')).toBe(true)
    expect(ai('coffee 5 2$')).toBe(true)
  })
})
