import { test, expect } from '@playwright/test'

test('signed-out: app redirects to login; static files and PWA assets still load', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  for (const path of ['/fonts/material-symbols.woff2', '/pcm-worklet.js', '/sw.js', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']) {
    const r = await request.get(path, { maxRedirects: 0 })
    expect(r.status(), path).toBe(200)
  }
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m).toMatchObject({ short_name: 'កត់', display: 'standalone', start_url: '/' })
})

test('security headers are set', async ({ request }) => {
  const h = (await request.get('/login')).headers()
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['permissions-policy']).toContain('microphone=(self)')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
})

test('API routes answer 401 signed-out (no redirect)', async ({ request }) => {
  expect((await request.post('/api/capture', { data: { text: '5$ coffee', mode: 'personal' }, maxRedirects: 0 })).status()).toBe(401)
  expect((await request.post('/api/voice?mode=personal', { data: 'x', maxRedirects: 0 })).status()).toBe(401)
})

test('login page fits 320 px with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/login')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
