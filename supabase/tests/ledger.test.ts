// Ledger + RLS tests against the dev database. Every test runs in a transaction that is rolled back.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.loadEnvFile('.env.local')
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { ca: readFileSync('supabase/prod-ca-2021.crt', 'utf8') } })

beforeAll(() => db.connect())
afterAll(() => db.end())
beforeEach(() => db.query('begin'))
afterEach(() => db.query('rollback'))

type Ws = { personal: string; business: string; cash: string; cashBiz: string }

async function newUser(): Promise<{ id: string } & Ws> {
  await db.query('reset role')
  const id = randomUUID()
  await db.query(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`, [id, `${id}@test.local`])
  const ws = await db.query(`select w.kind, w.id, a.id as cash from public.workspaces w join public.accounts a on a.workspace_id = w.id where owner_id = $1`, [id])
  const p = ws.rows.find(r => r.kind === 'personal'), b = ws.rows.find(r => r.kind === 'business')
  return { id, personal: p.id, business: b.id, cash: p.cash, cashBiz: b.cash }
}
async function as(uid: string) {
  await db.query('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
  await db.query('set local role authenticated')
}
const key = () => randomUUID()
async function account(ws: string, currency: 'USD' | 'KHR', opening: number, kind = 'aba') {
  return (await db.query(`select public.create_account($1, $2, $3, null, $4, '#33506E', $5) as id`, [ws, key(), kind, currency, opening])).rows[0].id as string
}
async function record(ws: string, items: object[], k = key()) {
  return (await db.query(`select public.record_transactions($1, $2, $3::jsonb) as ids`, [ws, k, JSON.stringify(items)])).rows[0].ids as string[]
}
async function bal(id: string) {
  return Number((await db.query(`select balance from public.account_balances where account_id = $1`, [id])).rows[0].balance)
}
async function totals(ws: string) {
  const r = await db.query(`select * from public.period_totals($1, now() - interval '1 day', now() + interval '1 day')`, [ws])
  return Object.fromEntries(r.rows.map(x => [`${x.type}:${x.currency}`, Number(x.total)]))
}

describe('ledger', () => {
  it('new user gets personal + business workspaces with a default cash account', async () => {
    const u = await newUser(); await as(u.id)
    const r = await db.query(`select kind from public.workspaces order by kind`)
    expect(r.rows.map(x => x.kind)).toEqual(['business', 'personal'])
    expect(await bal(u.cash)).toBe(0)
  })

  it('expense reduces and income increases the right account (cents precision)', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 50000)          // $500.00
    await record(u.personal, [{ type: 'expense', amount: 501, currency: 'USD', account_id: aba, category_id: 'coffee' }])  // $5.01
    expect(await bal(aba)).toBe(49499)
    await record(u.personal, [{ type: 'income', amount: 20000, currency: 'USD', account_id: aba, category_id: 'salary' }])
    expect(await bal(aba)).toBe(69499)
    expect(await bal(u.cash)).toBe(0)
  })

  it('KHR keeps integer riel', async () => {
    const u = await newUser(); await as(u.id)
    await record(u.personal, [{ type: 'expense', amount: 15500, currency: 'KHR', account_id: u.cash }])
    expect(await bal(u.cash)).toBe(-15500)
  })

  it('transfer moves money, keeps total, and is not expense or income', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 50000), acl = await account(u.personal, 'USD', 30000, 'acleda')
    await record(u.personal, [{ type: 'transfer', amount: 10000, currency: 'USD', account_id: aba, to_account_id: acl }])
    expect([await bal(aba), await bal(acl)]).toEqual([40000, 40000])
    expect(await totals(u.personal)).toEqual({})
  })

  it('cross-currency postings freeze the rate at entry', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 10000)
    await record(u.personal, [{ type: 'expense', amount: 20500, currency: 'KHR', account_id: aba }])  // 20,500 ៛ at 4100 = $5.00
    expect(await bal(aba)).toBe(9500)
    await db.query(`update public.profiles set khr_per_usd = 4000 where id = $1`, [u.id])
    expect(await bal(aba)).toBe(9500)                                                                // unchanged
    await record(u.personal, [{ type: 'transfer', amount: 1000, currency: 'USD', account_id: aba, to_account_id: u.cash }])
    expect(await bal(u.cash)).toBe(40000)                                                            // $10 at new 4000
    const fx = await db.query(`select type, fx_khr_per_usd from public.transactions where type in ('expense','transfer') order by type`)
    expect(fx.rows.map(r => r.fx_khr_per_usd)).toEqual([4100, 4000])
    expect(await totals(u.personal)).toEqual({ 'expense:KHR': 20500 })                               // original currency kept
  })

  it('multiple items save atomically; one bad item saves none', async () => {
    const u = await newUser(); await as(u.id)
    const ids = await record(u.personal, [
      { type: 'expense', amount: 15000, currency: 'KHR', account_id: u.cash, category_id: 'food' },
      { type: 'expense', amount: 8000, currency: 'KHR', account_id: u.cash, category_id: 'coffee' }])
    expect(ids).toHaveLength(2)
    expect(await bal(u.cash)).toBe(-23000)
    await db.query('savepoint s')
    await expect(record(u.personal, [
      { type: 'expense', amount: 1000, currency: 'KHR', account_id: u.cash },
      { type: 'expense', amount: 1000, currency: 'EUR', account_id: u.cash }])).rejects.toThrow(/currency/)
    await db.query('rollback to savepoint s')
    expect(await bal(u.cash)).toBe(-23000)
  })

  it('rejects fractional amounts (no floats)', async () => {
    const u = await newUser(); await as(u.id)
    await expect(record(u.personal, [{ type: 'expense', amount: 2.5, currency: 'USD', account_id: u.cash }])).rejects.toThrow()
  })

  it('same idempotency key twice writes once', async () => {
    const u = await newUser(); await as(u.id)
    const k = key(), item = [{ type: 'expense', amount: 4000, currency: 'KHR', account_id: u.cash }]
    const a = await record(u.personal, item, k), b = await record(u.personal, item, k)
    expect(b).toEqual(a)
    expect(await bal(u.cash)).toBe(-4000)
  })

  it('undo voids, undo-delete restores', async () => {
    const u = await newUser(); await as(u.id)
    const [id] = await record(u.personal, [{ type: 'expense', amount: 4000, currency: 'KHR', account_id: u.cash }])
    await db.query(`select public.set_transaction_voided($1, true)`, [id])
    expect(await bal(u.cash)).toBe(0)
    expect(await totals(u.personal)).toEqual({})
    await db.query(`select public.set_transaction_voided($1, false)`, [id])
    expect(await bal(u.cash)).toBe(-4000)
  })

  it('personal and business are separated', async () => {
    const u = await newUser(); await as(u.id)
    await record(u.business, [{ type: 'income', amount: 90000, currency: 'KHR', account_id: u.cashBiz, category_id: 'sales' }])
    expect(await totals(u.personal)).toEqual({})
    await expect(record(u.personal, [{ type: 'expense', amount: 1, currency: 'KHR', account_id: u.cashBiz }])).rejects.toThrow(/not in workspace/)
  })

  it('users cannot see or write each other’s data', async () => {
    const a = await newUser(), b = await newUser()
    await as(a.id)
    await record(a.personal, [{ type: 'expense', amount: 4000, currency: 'KHR', account_id: a.cash }])
    await as(b.id)
    expect((await db.query(`select * from public.accounts where workspace_id = $1`, [a.personal])).rowCount).toBe(0)
    expect((await db.query(`select * from public.transactions where workspace_id = $1`, [a.personal])).rowCount).toBe(0)
    expect((await db.query(`select * from public.account_balances where account_id = $1`, [a.cash])).rowCount).toBe(0)
    await db.query('savepoint s')
    await expect(record(a.personal, [{ type: 'expense', amount: 1, currency: 'KHR', account_id: a.cash }])).rejects.toThrow(/forbidden/)
    await db.query('rollback to savepoint s')
    const [txId] = (await (async () => { await as(a.id); return (await db.query(`select id from public.transactions limit 1`)).rows.map(r => r.id) })())
    await as(b.id)
    await expect(db.query(`select public.set_transaction_voided($1, true)`, [txId])).rejects.toThrow(/forbidden/)
  })

  it('direct writes to ledger tables are denied', async () => {
    const u = await newUser(); await as(u.id)
    await expect(db.query(`insert into public.postings (transaction_id, account_id, amount, currency) values (gen_random_uuid(), $1, 100, 'KHR')`, [u.cash])).rejects.toThrow(/permission denied/)
  })

  it('edit rewrites postings atomically and keeps the frozen rate', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 10000)
    const [id] = await record(u.personal, [{ type: 'expense', amount: 20500, currency: 'KHR', account_id: aba }])  // $5 at 4100
    await db.query(`update public.profiles set khr_per_usd = 4000 where id = $1`, [u.id])
    await db.query(`select public.update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ type: 'expense', amount: 41000, currency: 'KHR', account_id: aba, note: 'Dinner' })])
    expect(await bal(aba)).toBe(9000)                                  // $100 − (41,000 ៛ at the original 4100 = $10)
    await db.query(`select public.update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ type: 'transfer', amount: 1000, currency: 'USD', account_id: aba, to_account_id: u.cash })])
    expect([await bal(aba), await bal(u.cash)]).toEqual([9000, 41000])  // still 4100
    expect(await totals(u.personal)).toEqual({})                       // now a transfer: not spending
    await db.query('savepoint s')
    await expect(db.query(`select public.update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ type: 'expense', amount: 1.5, currency: 'USD', account_id: aba })])).rejects.toThrow()
    await db.query('rollback to savepoint s')
    expect(await bal(aba)).toBe(9000)                                  // failed edit changed nothing
  })

  it('edits are limited to members and live transactions', async () => {
    const a = await newUser(), b = await newUser()
    await as(a.id)
    const [id] = await record(a.personal, [{ type: 'expense', amount: 4000, currency: 'KHR', account_id: a.cash }])
    await as(b.id)
    await db.query('savepoint s')
    await expect(db.query(`select public.update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ type: 'expense', amount: 1, currency: 'KHR', account_id: a.cash })])).rejects.toThrow(/forbidden/)
    await db.query('rollback to savepoint s')
    await as(a.id)
    await db.query(`select public.set_transaction_voided($1, true)`, [id])
    await expect(db.query(`select public.update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ type: 'expense', amount: 1, currency: 'KHR', account_id: a.cash })])).rejects.toThrow(/not editable/)
  })

  it('archive blocks new records, keeps history; default can move', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 5000)
    await db.query(`select public.set_default_account($1)`, [aba])
    const d = await db.query(`select id from public.accounts where workspace_id = $1 and is_default`, [u.personal])
    expect(d.rows.map(r => r.id)).toEqual([aba])
    await db.query(`select public.set_account_archived($1, true)`, [aba])
    expect((await db.query(`select is_default from public.accounts where id = $1`, [aba])).rows[0].is_default).toBe(false)
    expect(await bal(aba)).toBe(5000)
    await db.query('savepoint s')
    await expect(record(u.personal, [{ type: 'expense', amount: 100, currency: 'USD', account_id: aba }])).rejects.toThrow(/not in workspace/)
    await db.query('rollback to savepoint s')
    await db.query(`select public.set_account_archived($1, false)`, [aba])
    await record(u.personal, [{ type: 'expense', amount: 100, currency: 'USD', account_id: aba }])
    expect(await bal(aba)).toBe(4900)
  })

  it('insights: per-currency totals, categories, accounts, local-date series; transfers/voided excluded', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 50000)
    const at = (iso: string, x: object) => record(u.personal, [{ ...x, occurred_at: iso }])
    await at('2026-11-07T20:00:00Z', { type: 'expense', amount: 500, currency: 'USD', account_id: aba, category_id: 'coffee' })     // = Nov 8 03:00 Phnom Penh
    await at('2026-11-06T05:00:00Z', { type: 'expense', amount: 20000, currency: 'KHR', account_id: u.cash, category_id: 'food' })
    await at('2026-11-06T06:00:00Z', { type: 'income', amount: 65000, currency: 'USD', account_id: aba, category_id: 'salary' })
    await at('2026-11-06T07:00:00Z', { type: 'transfer', amount: 10000, currency: 'USD', account_id: aba, to_account_id: u.cash })
    const [voided] = await at('2026-11-06T08:00:00Z', { type: 'expense', amount: 99999, currency: 'KHR', account_id: u.cash })
    await db.query(`select public.set_transaction_voided($1, true)`, [voided])
    await at('2026-10-20T05:00:00Z', { type: 'expense', amount: 8000, currency: 'KHR', account_id: u.cash, category_id: 'food' })  // previous period
    const q = async (account: string | null = null) => (await db.query(
      `select public.insights($1, '2026-11-01T00:00:00+07', '2026-11-09T00:00:00+07', '2026-10-24T00:00:00+07' ::timestamptz - interval '8 days', 'Asia/Phnom_Penh', $2) as j`,
      [u.personal, account])).rows[0].j
    const j = await q()
    const tot = Object.fromEntries(j.totals.map((x: { type: string; currency: string; total: number }) => [`${x.type}:${x.currency}`, Number(x.total)]))
    expect(tot).toEqual({ 'expense:USD': 500, 'expense:KHR': 20000, 'income:USD': 65000 })  // no transfer, no voided
    expect(j.prev.map((x: { total: number }) => Number(x.total))).toEqual([8000])
    expect(j.by_category.filter((x: { type: string }) => x.type === 'expense').map((x: { category_id: string }) => x.category_id).sort()).toEqual(['coffee', 'food'])
    expect(j.series.some((x: { d: string; currency: string }) => x.d === '2026-11-08' && x.currency === 'USD')).toBe(true)  // local date, not UTC
    expect(j.largest).toMatchObject({ category_id: 'coffee', amount: 500, currency: 'USD' })  // $5.00 > 20,000 ៛ (≈ $4.88 at the user's 4100); amount unconverted
    const onlyAba = await q(aba)
    expect(onlyAba.totals.map((x: { currency: string }) => x.currency).sort()).toEqual(['USD', 'USD'])
    const other = await newUser(); await as(other.id)
    expect((await q()).totals).toEqual([])  // RLS: someone else's workspace returns nothing
  })

  it('deleting a user removes all their data', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 50000)
    await record(u.personal, [{ type: 'transfer', amount: 100, currency: 'USD', account_id: aba, to_account_id: u.cash }])
    await db.query('reset role')
    await db.query('delete from auth.users where id = $1', [u.id])
    const r = await db.query(`select (select count(*) from public.workspaces where owner_id = $1) w, (select count(*) from public.accounts where id = $2) a`, [u.id, aba])
    expect(r.rows[0]).toEqual({ w: '0', a: '0' })
  })

  it('export: exact decimals, both transfer legs, frozen rate, only own data', async () => {
    const u = await newUser(); await as(u.id)
    const aba = await account(u.personal, 'USD', 50000)
    await record(u.personal, [{ type: 'expense', amount: 50, currency: 'USD', account_id: aba, category_id: 'coffee', note: 'a, "b"' }])
    await record(u.personal, [{ type: 'transfer', amount: 1000, currency: 'USD', account_id: aba, to_account_id: u.cash }])
    const rows = (await db.query(`select * from public.export_transactions()`)).rows
    expect(rows.map(r => [r.type, r.amount, r.currency, r.account_amount, r.to_account_amount, r.khr_per_usd])).toEqual([
      ['opening', '500.00', 'USD', '500.00', null, null],
      ['expense', '0.50', 'USD', '-0.50', null, null],
      ['transfer', '10.00', 'USD', '-10.00', '41000', 4100],
    ])
    expect(rows[1].note).toBe('a, "b"')
    expect(rows[2].to_account).toBe('Cash (KHR)')
    const other = await newUser(); await as(other.id)
    expect((await db.query(`select * from public.export_transactions()`)).rows).toEqual([])
  })

  it('delete_my_account removes only the caller', async () => {
    const u = await newUser(), other = await newUser()
    await as(u.id)
    await db.query(`select public.delete_my_account()`)
    await db.query('reset role')
    const r = await db.query(`select id from auth.users where id = any($1)`, [[u.id, other.id]])
    expect(r.rows.map(x => x.id)).toEqual([other.id])
    await db.query(`select set_config('request.jwt.claims', '', true)`); await db.query('set local role anon')
    await expect(db.query(`select public.delete_my_account()`)).rejects.toThrow(/permission denied/)
  })

  it('account currency cannot be changed directly', async () => {
    const u = await newUser(); await as(u.id)
    await expect(db.query(`update public.accounts set currency = 'USD' where id = $1`, [u.cash])).rejects.toThrow(/permission denied/)
  })
})
