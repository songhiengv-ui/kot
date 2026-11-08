// Last check before anything reaches the ledger RPCs — same schema for text, voice, edit and repeat.
// The database re-validates; this catches bad values early with a clear "check the amount" message.
import { z } from 'zod'
import type { Tx } from './app'

export const ItemSchema = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),  // minor units, never a float
  currency: z.enum(['USD', 'KHR']),
  account_id: z.uuid(),
  to_account_id: z.uuid().optional(),
  category_id: z.string().max(40).optional(),
  note: z.string().max(200).optional(),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
}).refine(x => x.type !== 'transfer' || (!!x.to_account_id && x.to_account_id !== x.account_id), { message: 'transfer needs two different accounts' })
export const ItemsSchema = z.array(ItemSchema).min(1).max(10)
export type Item = z.infer<typeof ItemSchema>

/** "Tap to log again": the user's most repeated recent records (exact copies — no parsing, no guessing). */
export function suggestRepeats(txs: Tx[], liveAccountIds: Set<string>, now: number, limit = 5) {
  const since = now - 10 * 864e5
  const groups = new Map<string, { x: Tx; n: number }>()
  for (const x of txs) {  // txs arrive newest first, so the first one seen is the template
    if (x.type === 'transfer' || new Date(x.occurred_at).getTime() < since) continue
    const acct = x.postings[0]?.account_id
    if (!acct || !liveAccountIds.has(acct)) continue
    const k = [x.type, x.note ?? '', x.category_id, x.amount, x.currency, acct].join('|')
    const g = groups.get(k)
    if (g) g.n++; else groups.set(k, { x, n: 1 })
  }
  return [...groups.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(({ x }) => x)
}
