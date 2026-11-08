// Deterministic capture parser: "5$ coffee ABA", "ចាយ ៥ ម៉ឺន ទិញបាយ" → candidates.
// Pure: no React, Supabase or AI. Also the cross-check for AI extraction later.
import { decimal, scale, toLatinDigits, type Cur } from './money'

export type TxType = 'expense' | 'income' | 'transfer'
export type AccountKind = 'aba' | 'acleda' | 'wing' | 'cash' | 'other' | 'custom'
export type Flag = 'amount' | 'currency' | 'account' | 'to' | 'same'

export type Candidate = {
  type: TxType
  amount: number | null          // minor units of `currency`
  currency: Cur | null
  category: string
  note: string
  accountHint: AccountKind | null
  toAccountHint: AccountKind | null
  currencyAssumed?: boolean      // e.g. bare "15000" read as riel — shown in preview
  options?: { amount: number; currency: Cur }[]
  flags: Flag[]
}

const MAG: Record<string, number> = { 'ពាន់': 1e3, 'ម៉ឺន': 1e4, 'សែន': 1e5, 'លាន': 1e6, k: 1e3 }
const MAG_RE = '(ពាន់|ម៉ឺន|សែន|លាន|k(?![a-z]))'
const USD_RE = /^\s*(\$|usd\b|dollars?\b|ដុល្លារ)/i
const KHR_RE = /^\s*(៛|riels?\b|រៀល)/i
const HALF_RE = /^\s*កន្លះ/

const CATEGORY_WORDS: [string, RegExp][] = [
  ['salary', /salary|ប្រាក់ខែ/i], ['sales', /sold|sale|sell|order|លក់|កុម្ម៉ង់/i],
  ['coffee', /coffee|cafe|latte|tea|កាហ្វេ|តែ/i], ['fuel', /gas|fuel|petrol|សាំង/i],
  ['transport', /tuk|taxi|moto|bus|ride|grab|passapp|តុកតុក|ម៉ូតូ/i], ['groceries', /market|veg|grocer|ផ្សារ|បន្លែ/i],
  ['phone', /top.?up|phone|data|កាតទូរស័ព្ទ/i], ['bills', /electric|water|bill|internet|ភ្លើង|វិក្កយបត្រ/i],
  ['rent', /rent|ជួល/i], ['stock', /stock|ស្តុក/i], ['delivery', /deliver|ship|ដឹក/i],
  ['wages', /wage|staff|ប្រាក់ឈ្នួល/i], ['shopping', /shirt|clothes|shoe|bag|អាវ|ស្បែកជើង/i],
  ['food', /lunch|dinner|breakfast|rice|food|noodle|meal|បាយ|ម្ហូប|នំ|គុយទាវ|អាហារ/i],
]
export const ACCOUNT_WORDS: [AccountKind, RegExp][] = [
  ['aba', /\baba\b|អេប៊ីអេ/i], ['acleda', /acleda|អេស៊ីលីដា/i], ['wing', /\bwing\b|វីង/i], ['cash', /\bcash\b|សាច់ប្រាក់|លុយសុទ្ធ/i],
]
/** Cash withdrawal; Chirp transcripts put spaces between words ("ដក លុយ"). */
export const WITHDRAW_RE = /withdr[ae]w|ដក\s*(លុយ|ប្រាក់)/i
const TRANSFER_RE = /transfer|move|withdraw|ផ្ទេរ|ដក/i
const INCOME_RE = /received|receive|salary|sold|sale|income|earn|got paid|ទទួល|លក់|ប្រាក់ខែ|ចំណូល/i
const FILLER_RE = /\b(received|receive|spent|spend|paid|pay|for|on|today|i|bought|buy|got|sold|my|from|to|via|with|by|transfer|move|and)\b|ថ្ងៃនេះ|ខ្ញុំ|ចំណាយ|ចាយ|ទិញ|បាន|តាម|ពី|ទៅ|ផ្ទេរ|ដុល្លារ|រៀល/gi

// ── Khmer number words (speech transcripts, typed Khmer) ─────────────
// "ប្រាំម៉ឺន" → "5 ម៉ឺន", "ម្ភៃពាន់រៀល" → "20 ពាន់រៀល", "ពីររយហាសិប" → "250". Magnitude words are left for findAmount.
// A lone 1–9 word is only a number before/after a magnitude or currency word, so "កាហ្វេមួយកែវ" (one cup) stays text.
const NUM_WORDS: Record<string, number> = {
  'ប្រាំ': 5, 'បាំ': 5, 'ប៉ាំ': 5,  // បាំ / ប៉ាំ: how ប្រាំ is said in everyday speech (STT writes it that way)
  'មួយ': 1, 'ពីរ': 2, 'បី': 3, 'បួន': 4, 'ដប់': 10, 'ម្ភៃ': 20, 'សាមសិប': 30, 'សែសិប': 40,
  'ហាសិប': 50, 'ហុកសិប': 60, 'ចិតសិប': 70, 'ប៉ែតសិប': 80, 'កៅសិប': 90, 'រយ': 100,
}
const NUM_WORD_RE = new RegExp(Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|'), 'g')
const CUE_AFTER = /^\s*(ពាន់|ម៉ឺន|សែន|លាន|ដុល្លារ|រៀល|៛|\$|dollars?\b|usd\b|riels?\b)/i
const MAG_BEFORE = /(ពាន់|ម៉ឺន|សែន|លាន)\s*$/

/** One number phrase (< 1000) from token values starting at i: [digit រយ] [tens] [digit]. Returns [value, next index]. */
function numPhrase(t: number[], i: number): [number, number] | null {
  const digit = (j: number): [number, number] | null =>
    t[j] >= 1 && t[j] <= 5 ? (t[j] === 5 && t[j + 1] >= 1 && t[j + 1] <= 4 ? [5 + t[j + 1], j + 2] : [t[j], j + 1]) : null
  let v = 0, j = i
  const d = digit(j)
  if (d && t[d[1]] === 100) { v = d[0] * 100; j = d[1] + 1 } else if (d) return d
  if (t[j] >= 10 && t[j] <= 90) { v += t[j]; j++ }
  const o = j > i ? digit(j) : null
  if (o) { v += o[0]; j = o[1] }
  return j > i ? [v, j] : null
}

/** Replace Khmer number words with Latin digits (no word boundaries in Khmer, so tokens are matched anywhere). */
export function wordsToDigits(raw: string): string {
  const s = raw.replace(/[\u200b\u200c]/g, '')
  const toks = [...s.matchAll(NUM_WORD_RE)].map(m => ({ v: NUM_WORDS[m[0]], a: m.index!, b: m.index! + m[0].length }))
  let out = '', last = 0
  for (let k = 0; k < toks.length;) {
    let r = k + 1
    while (r < toks.length && !s.slice(toks[r - 1].b, toks[r].a).trim()) r++
    const t = toks.slice(k, r).map(x => x.v)
    for (let i = 0; i < t.length;) {
      const p = numPhrase(t, i)
      if (!p) { i++; continue }
      const a = toks[k + i].a, b = toks[k + p[1] - 1].b
      if (p[0] >= 10 || CUE_AFTER.test(s.slice(b)) || MAG_BEFORE.test(s.slice(0, a))) { out += s.slice(last, a) + ` ${p[0]} `; last = b }
      i = p[1]
    }
    k = r
  }
  return out + s.slice(last)
}

/** Khmer digits + number words → Latin digits. Everything below parses the normalized string. */
export const normalizeNumbers = (raw: string) => wordsToDigits(toLatinDigits(raw))

export type AmountHit = { start: number; end: number; amount: number | null; currency: Cur | null; khrByMagnitude: boolean; bare: { n: number; d: number } | null }

/** First amount expression in `s` (Latin digits). Handles 20k, ៥ម៉ឺន, ២ម៉ឺន៥ (=25,000), ១សែន ២ម៉ឺន, 1.5លាន, $5, 5$, 12.50 USD. */
export function findAmount(s: string, from = 0): AmountHit | null {
  const re = /\d[\d,]*(?:\.\d+)?/g
  re.lastIndex = from
  const m = re.exec(s)
  if (!m) return null
  const start = m.index
  let end = start + m[0].length
  const x = decimal(m[0])
  if (!x) return { start, end, amount: null, currency: null, khrByMagnitude: false, bare: null }
  const dollarBefore = /\$\s*$/.test(s.slice(0, start))

  const mag = new RegExp('^\\s*' + MAG_RE, 'i').exec(s.slice(end))
  if (mag) {
    const unit = MAG[mag[1].toLowerCase()]
    let total = scale(x, unit)
    end += mag[0].length
    // tails, each a smaller unit: "១សែន ២០ពាន់", "១ម៉ឺន២ពាន់៥រយ", "២ម៉ឺន៥" (one bare digit = next lower unit → 25,000),
    // "៧ពាន់ ៥០០" (spoken ប្រាំពីរពាន់ប្រាំរយ, normalized to a bare hundred)
    for (let last = unit, tail; total !== null && (tail = /^\s*(\d+)(?![\d.,])\s*(ពាន់|ម៉ឺន|សែន|រយ)?/.exec(s.slice(end))); ) {
      const after = s.slice(end + tail[0].length), bareOk = !USD_RE.test(after) && !KHR_RE.test(after)
      const [tUnit, ok] = tail[2] ? [tail[2] === 'រយ' ? 100 : MAG[tail[2]], true]
        : tail[1].length === 1 ? [last / 10, bareOk && last / 10 >= 1e3]
        : [1, bareOk && last === 1e3 && /^[1-9]00$/.test(tail[1])]
      if (!ok || tUnit >= last || Number(tail[1]) * tUnit >= last) break
      total += Number(tail[1]) * tUnit; end += tail[0].length; last = tUnit
    }
    // "២ម៉ឺនកន្លះ" = 2.5 × ម៉ឺន = 25,000 (only when no tail digit was taken)
    const half = HALF_RE.exec(s.slice(end))
    if (half && total !== null && end === start + m[0].length + mag[0].length && unit % 2 === 0) { total += unit / 2; end += half[0].length }
    const usd = dollarBefore || USD_RE.test(s.slice(end))
    const k = KHR_RE.exec(s.slice(end)); if (k) end += k[0].length
    // "$5k" is ambiguous enough to ask
    return { start, end, amount: usd ? null : total, currency: usd ? null : 'KHR', khrByMagnitude: true, bare: null }
  }
  const usd = USD_RE.exec(s.slice(end)), khr = KHR_RE.exec(s.slice(end))
  if (dollarBefore || usd) {
    if (usd) end += usd[0].length
    let cents = scale(x, 100)
    const half = HALF_RE.exec(s.slice(end))  // "២ដុល្លារកន្លះ" = $2.50
    if (half && cents !== null && x.d === 0) { cents += 50; end += half[0].length }
    return { start, end, amount: cents, currency: 'USD', khrByMagnitude: false, bare: null }
  }
  if (khr) { end += khr[0].length; return { start, end, amount: scale(x, 1), currency: 'KHR', khrByMagnitude: false, bare: null } }
  return { start, end, amount: null, currency: null, khrByMagnitude: false, bare: x }
}

/** Split a sentence into items: ",", " and ", "ហើយ", "និង", " + ". Commas inside numbers (1,200) are kept. */
export const splitItems = (raw: string) =>
  normalizeNumbers(raw).split(/,(?!\d{3}\b)|\s+and\s+|ហើយ|\s*និង\s*|\s\+\s/i).map(p => p.trim()).filter(Boolean)

/** Bare number, no currency cue: ≥ 1,000 reads as riel (marked assumed); smaller asks, offering ×1,000 ៛ and $. */
export function applyBare(c: Candidate, x: { n: number; d: number }) {
  const asKhr = scale(x, 1), asUsd = scale(x, 100), k = scale(x, 1000)
  if (asKhr !== null && asKhr >= 1000) { c.amount = asKhr; c.currency = 'KHR'; c.currencyAssumed = true; return }
  c.flags.push('currency')
  c.options = [
    ...(k !== null ? [{ amount: k, currency: 'KHR' as Cur }] : []),
    ...(asUsd !== null ? [{ amount: asUsd, currency: 'USD' as Cur }] : []),
  ]
}

export function parseOne(raw: string, mode: 'personal' | 'business' = 'personal'): Candidate {
  const s = normalizeNumbers(raw).trim()
  const hints = ACCOUNT_WORDS.map(([k, re]) => { const m = re.exec(s); return m ? { k, i: m.index } : null })
    .filter((h): h is { k: AccountKind; i: number } => !!h).sort((a, b) => a.i - b.i).map(h => h.k)
  // withdrawing from one named bank/wallet = transfer to cash. (No "deposit" twin: ដាក់លុយ is also a phone top-up.)
  if (hints.length === 1 && hints[0] !== 'cash' && WITHDRAW_RE.test(s)) hints.push('cash')
  const type: TxType = TRANSFER_RE.test(s) && hints.length >= 2 ? 'transfer' : INCOME_RE.test(s) ? 'income' : 'expense'
  const category = type === 'transfer' ? 'transfer'
    : CATEGORY_WORDS.find(([, re]) => re.test(s))?.[0] ?? (type === 'income' ? (mode === 'business' ? 'sales' : 'salary') : 'other')

  const c: Candidate = {
    type, amount: null, currency: null, category, note: '', flags: [],
    accountHint: hints[0] ?? null, toAccountHint: type === 'transfer' ? hints[1] ?? null : null,
  }
  if (type === 'transfer' && c.accountHint === c.toAccountHint) c.flags.push('same')

  const hit = findAmount(s)
  if (!hit) { c.flags.push('amount') } else {
    if (findAmount(s, hit.end)) c.flags.push('amount')          // two numbers in one item → ask, don't guess
    if (hit.currency) { c.currency = hit.currency; c.amount = hit.amount; if (hit.amount === null) c.flags.push('amount') }
    else if (hit.bare) applyBare(c, hit.bare)
    else { c.currency = hit.khrByMagnitude ? null : c.currency; c.flags.push('amount') }
  }

  let note = hit ? s.slice(0, hit.start) + ' ' + s.slice(hit.end) : s
  for (const [, re] of ACCOUNT_WORDS) note = note.replace(new RegExp(re.source, 'gi'), ' ')
  note = note.replace(/\$/g, ' ').replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim()
  c.note = note ? note.charAt(0).toUpperCase() + note.slice(1) : ''
  return c
}

export const parseCapture = (raw: string, mode: 'personal' | 'business' = 'personal') =>
  splitItems(raw).slice(0, 10).map(p => parseOne(p, mode))

/** Every usable amount reading in one item (explicit currency, or a bare number). */
export function amountHits(item: string): AmountHit[] {
  const s = normalizeNumbers(item), out: AmountHit[] = []
  for (let h = findAmount(s); h; h = findAmount(s, h.end)) if (h.amount !== null || h.bare) out.push(h)
  return out
}

/**
 * Should this input go to the AI extractor? Only when the text has amounts the deterministic split
 * couldn't place: more amount readings than priced candidates (items the splitter didn't separate),
 * or an item flagged 'amount' while numbers exist. No numbers → AI can't help (it may not invent one).
 */
export function needsAI(text: string, candidates: Candidate[]): boolean {
  const readings = splitItems(text).flatMap(amountHits).length
  if (!readings) return false
  const priced = candidates.filter(c => c.amount !== null || c.options?.length).length
  return readings > priced || candidates.some(c => c.flags.includes('amount'))
}

// ── account resolution ────────────────────────────────────────────────

export type AccountLite = { id: string; kind: AccountKind; currency: Cur; is_default: boolean }
export type Resolved = Candidate & { accountId: string | null; toAccountId: string | null; usedDefault: boolean }

/** Map hints to the user's accounts. `allowDefault` = text entry may fall back to the default account (shown in preview); voice may not. */
export function resolveAccounts(c: Candidate, accounts: AccountLite[], allowDefault: boolean): Resolved {
  const flags = [...c.flags]
  const pick = (kind: AccountKind | null, cur: Cur | null): string | null => {
    if (!kind) return null
    const same = accounts.filter(a => a.kind === kind)
    if (same.length === 1) return same[0].id
    const byCur = same.filter(a => a.currency === cur)
    return byCur.length === 1 ? byCur[0].id : null
  }
  let accountId = pick(c.accountHint, c.currency), usedDefault = false
  if (!accountId && !c.accountHint && allowDefault && c.type !== 'transfer') {
    accountId = accounts.find(a => a.is_default)?.id ?? null
    usedDefault = !!accountId
  }
  if (!accountId) flags.push('account')
  let toAccountId: string | null = null
  const out: Resolved = { ...c, accountId, toAccountId, usedDefault, flags }
  if (c.type === 'transfer') {
    const from = accounts.find(a => a.id === accountId)
    toAccountId = pick(c.toAccountHint, null)
    if (!toAccountId) flags.push('to')
    // bare "transfer 100 ABA to ACLEDA": the source account's currency decides
    const opt = from && !out.currency ? out.options?.find(o => o.currency === from.currency) : undefined
    if (opt) { out.amount = opt.amount; out.currency = opt.currency; out.options = undefined; flags.splice(flags.indexOf('currency'), 1) }
    // transfer amount must be in source-account currency
    if (from && out.currency && out.currency !== from.currency) flags.push('currency')
    out.toAccountId = toAccountId
  }
  out.flags = [...new Set(flags)]
  return out
}
