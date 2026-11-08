import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { newUser, deleteUser, sql } from './users'

// One user per device project; tests in order share it (serial).
test.describe.configure({ mode: 'serial' })
let user: Awaited<ReturnType<typeof newUser>>
let page: Page

test.beforeAll(async ({ browser, baseURL }) => {
  user = await newUser(baseURL!)
  // an ABA dollar account with $100.00, through the same RPC the app uses
  await sql(`begin;
    select set_config('request.jwt.claims', '{"sub":"${user.id}","role":"authenticated"}', true); set local role authenticated;
    select public.create_account((select id from public.workspaces where owner_id = '${user.id}' and kind = 'personal'), gen_random_uuid()::text, 'aba', null, 'USD', '#33506E', 10000);
    commit;`)
  page = await (await browser.newContext({ ...test.info().project.use, storageState: user.storageState })).newPage()
})
test.afterAll(async () => { await page?.context().close(); if (user) await deleteUser(user.id) })

const balances = () => sql<{ kind: string; currency: string; balance: string }>(
  `select a.kind, a.currency, b.balance from public.account_balances b join public.accounts a on a.id = b.account_id
   join public.workspaces w on w.id = a.workspace_id where w.owner_id = $1 and w.kind = 'personal' order by a.kind`, [user.id])
const addButton = () => page.getByRole('button', { name: 'Add', exact: true }).first()

test('signed-in home loads; session survives a reload', async () => {
  await page.goto('/')
  await expect(addButton()).toBeVisible()
  await page.reload()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(addButton()).toBeVisible()
})

test('text capture: "20k lunch" saves 20,000 ៛ from cash', async () => {
  await addButton().click()
  await page.locator('#cap').fill('20k lunch')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status').filter({ hasText: '20,000' })).toBeVisible()
  await expect.poll(balances).toContainEqual({ kind: 'cash', currency: 'KHR', balance: '-20000' })
})

test('transfer $10 ABA → cash: balances move at the frozen rate, spending unchanged', async () => {
  await addButton().click()
  await page.locator('#cap').fill('Transfer $10 ABA to cash')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status').filter({ hasText: '$10' })).toBeVisible()
  await expect.poll(balances).toEqual([
    { kind: 'aba', currency: 'USD', balance: '9000' },
    { kind: 'cash', currency: 'KHR', balance: String(-20000 + 41000) },  // default profile rate 4,100 ៛ = $1
  ])
  const [{ spent }] = await sql<{ spent: string }>(`select coalesce(sum(t.amount), 0) as spent from public.transactions t
    join public.workspaces w on w.id = t.workspace_id where w.owner_id = $1 and t.type = 'expense' and t.voided_at is null`, [user.id])
  expect(spent).toBe('20000')  // the transfer is not spending
})

test('activity lists the records', async () => {
  await page.getByRole('link', { name: 'Activity' }).first().click()
  await expect(page.getByText('lunch').first()).toBeVisible()
})

test('no horizontal overflow on any screen, 320 → 1280 px', async () => {
  test.setTimeout(120_000)
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    for (const path of ['/', '/activity', '/accounts', '/insights', '/settings']) {
      await page.goto(path)
      await expect(page.getByRole('navigation').first()).toBeVisible()
      await page.waitForTimeout(300)  // let data render
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over, `${path} at ${width}px`).toBeLessThanOrEqual(0)
    }
  }
  await page.setViewportSize(test.info().project.use.viewport!)
})

test('export downloads a CSV with exact amounts', async () => {
  await page.goto('/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download my records/ }).click()])
  const csv = readFileSync(await download.path(), 'utf8')
  const rows = csv.trim().split('\r\n').map(l => l.slice(1, -1).split('","'))
  const col = (r: string[], k: string) => r[rows[0].indexOf(k)]
  const exp = rows.find(r => col(r, 'type') === 'expense')!, xfer = rows.find(r => col(r, 'type') === 'transfer')!
  expect([col(exp, 'amount'), col(exp, 'currency'), col(exp, 'account_amount')]).toEqual(['20000', 'KHR', '-20000'])
  expect([col(xfer, 'amount'), col(xfer, 'currency'), col(xfer, 'account_amount'), col(xfer, 'to_account_amount'), col(xfer, 'khr_per_usd')])
    .toEqual(['10.00', 'USD', '-10.00', '41000', '4100'])
})

// Headless browsers can't show a real permission prompt (Chromium answers NotSupportedError), so getUserMedia is
// stubbed to reject the way real browsers do. Real-device mic checks stay on the manual checklist.
for (const [error, message] of [['NotAllowedError', 'Microphone is off'], ['NotFoundError', 'No microphone found']]) {
  test(`microphone ${error} → "${message}", type-instead offered`, async ({ browser }) => {
    const ctx = await browser.newContext({ ...test.info().project.use, storageState: user.storageState })
    await ctx.addInitScript(e => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('', e)) }, error)
    const p = await ctx.newPage()
    await p.goto('/')
    await p.getByRole('button', { name: 'Speak' }).first().click()
    // Playwright's Windows WebKit build has no mediaDevices/AudioWorklet (real Safari does) → the unsupported path instead
    const canRecord = await p.evaluate(() => !!navigator.mediaDevices && typeof AudioWorkletNode !== 'undefined')
    await expect(p.getByText(canRecord ? message : 'Voice isn’t supported in this browser')).toBeVisible()
    await p.getByRole('button', { name: 'Type instead' }).click()
    await expect(p.locator('#cap')).toBeVisible()
    await ctx.close()
  })
}

test('installed shell: service worker serves the offline page without a network', async () => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.context().setOffline(true)
  await page.goto('/activity').catch(() => {})
  await expect(page.getByText('You’re offline')).toBeVisible()
  await page.context().setOffline(false)
})

test('delete account removes everything and signs out', async ({ browser, baseURL }) => {
  const doomed = await newUser(baseURL!)
  const ctx = await browser.newContext({ ...test.info().project.use, storageState: doomed.storageState })
  const p = await ctx.newPage()
  await p.goto('/settings')
  await p.getByRole('button', { name: /Delete my account/ }).click()
  const go = p.getByRole('button', { name: 'Delete everything' })
  await expect(go).toBeDisabled()
  await p.getByLabel('Type DELETE to confirm').fill('delete')
  await go.click()
  await expect(p).toHaveURL(/\/login/)
  expect(await sql(`select 1 from auth.users where id = $1`, [doomed.id])).toEqual([])
  await ctx.close()
})
