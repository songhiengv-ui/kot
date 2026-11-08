// Integer minor units only: USD = cents, KHR = riel. No floats touch stored money.
export type Cur = 'USD' | 'KHR'

const KM_DIGITS = '០១២៣៤៥៦៧៨៩'
export const toLatinDigits = (s: string) => s.replace(/[០-៩]/g, c => String(KM_DIGITS.indexOf(c)))
export const toKhmerDigits = (s: string) => s.replace(/[0-9]/g, d => KM_DIGITS[Number(d)])

/** "1,200.5" → {n: 12005, d: 1}. value = n / 10^d. null if not a plain decimal. */
export function decimal(raw: string): { n: number; d: number } | null {
  const s = toLatinDigits(raw).replace(/,/g, '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [a, b = ''] = s.split('.')
  const n = Number(a + b)
  return Number.isSafeInteger(n) ? { n, d: b.length } : null
}

/** decimal × integer factor, exact or null (e.g. 1.5 × 1,000,000 = 1,500,000; 1.2345 × 100 = null). */
export function scale(x: { n: number; d: number }, factor: number): number | null {
  const v = x.n * factor, p = 10 ** x.d
  return Number.isSafeInteger(v) && v % p === 0 ? v / p : null
}

/** User-typed amount → minor units. USD allows ≤ 2 decimals, KHR none. */
export function parseAmount(raw: string, cur: Cur): number | null {
  const x = decimal(raw)
  if (!x) return null
  const v = scale(x, cur === 'USD' ? 100 : 1)
  return v !== null && v > 0 ? v : null
}

/** Minor units → plain editable string ("5.00" / "20000"). */
export const toInput = (minor: number, cur: Cur) =>
  cur === 'USD' ? `${Math.trunc(minor / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}` : String(minor)

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function formatMoney(minor: number, cur: Cur, opts: { sign?: '+' | '−' | ''; khmerDigits?: boolean } = {}) {
  const abs = Math.abs(minor)
  const body = cur === 'USD' ? `$${group(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, '0')}` : `${group(abs)} ៛`
  const sign = opts.sign ?? (minor < 0 ? '−' : '')
  const out = sign + body
  return opts.khmerDigits ? toKhmerDigits(out) : out
}

/** Display-only conversion for ≈ totals. Never store the result. */
export function convertApprox(minor: number, from: Cur, to: Cur, khrPerUsd: number): number {
  if (from === to) return minor
  return from === 'USD' ? Math.round((minor * khrPerUsd) / 100) : Math.round((minor * 100) / khrPerUsd)
}
