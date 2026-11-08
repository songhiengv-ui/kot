# Testing

| Layer | Tool | Covers (prompt §24 case #) |
|---|---|---|
| `lib/money`, `lib/parse` | Vitest | integer KHR/USD precision (5,6), Khmer numerals & ម៉ឺន/សែន/លាន, currency flags (8), multi-item split (9) |
| Ledger RPC + RLS | Vitest against local Supabase (`supabase start`) | expense/income/transfer balances (1–4), explicit-rate conversions (7), idempotent retry (10), void/undo (11), workspace separation (12), cross-user denial (13), AI failure writes nothing (18) |
| Capture API | Vitest with fake providers | invalid LLM output, provider timeout, amount disagreement → flag |
| Browser | Playwright: 320/360/390/430/768/1280 + WebKit | no horizontal overflow (16), mic denied / unsupported format (14,15), session persists (17), M1 flow end-to-end |
| Real devices | Manual checklist each voice release | Android Chrome, iPhone Safari (installed PWA + tab) |

Run: `npm test` (unit + DB, 91 tests) · `npm run e2e` (Playwright, 28 tests: 14 × Pixel 7 Chromium + iPhone 14 WebKit).
E2E covers: signed-out redirect + static/PWA assets 200, security headers, API 401s, session survives reload, text capture save, transfer at frozen rate not counted as spending (checked in the DB), Activity, no horizontal overflow 320–1280 px on all 5 screens, CSV export exact amounts, mic denied/no-mic messages, offline page from the service worker, delete account.

Rule: report actual command output; a skipped test is reported as skipped.
