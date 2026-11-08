# Roadmap

Each phase ends with tests passing and a short report (implemented / files / tests / working / incomplete / risks / next).

## M1 — Smallest end-to-end slice ✅ done 2026-11-07

> Sign in on a phone → create ABA (USD) + Cash (KHR) with opening balances → type "5$ coffee ABA" → see preview → save → Home balance updates from Postgres → Undo restores it.

Covers: auth, workspace, accounts, ledger RPC + RLS, idempotency, text parser, Home (balance + recent), toast/undo, mobile layout. No voice, no insights.

Built beyond the slice: Activity (search, type filter, day groups), Settings (language, Khmer numerals, rate, sign-out), Personal/Business switcher, desktop sidebar layout.
Not yet (at M1): edit/delete, transfer form, account detail — delivered in Phase 2.

## Phase 1 — Foundation
Next.js + TS + Tailwind scaffold; tokens; base components ported from design (Sheet, Chip, Segmented, TxRow, AccountCard, Toast, BottomNav+Mic, Sidebar ≥768px); i18n km/en; Supabase dev project; auth; schema + RLS migrations; `.env` setup.

## Phase 2 — Financial core
Accounts CRUD/archive/default; expense, income, transfer (incl. cross-currency with frozen rate); edit; void/undo; Activity screen with filters/search; account detail. Ledger + RLS tests.

✅ Done 2026-11-07: `update_transaction` (rewrites postings atomically, keeps the frozen rate), `set_account_archived`, `set_default_account` (migration 0003, shared `private.write_postings`); edit/delete-with-undo sheet; transfer form with balance-impact preview; account detail (30-day in/out/transfer, history, edit, transfer, archive/restore, make default); account edit (name/kind/color — currency locked); archived section; Activity account + category filters. 20 ledger/RLS tests.

## Phase 3 — Fast capture (text) ✅ done 2026-11-07
Done: hybrid parser (deterministic first, AI fallback via `/api/capture`), Khmer number words, កន្លះ (half), shared Zod `ItemSchema` checked before every save, repeat chips (exact copies of recent records, one tap + Undo), tap the previewed item to open the full Check editor, unsaved draft kept in memory (never browser storage).

`lib/parse` (fixing the design's ម៉ឺន/float/currency-guess defects); shared candidate schema; text sheet with live preview + flags; repeat chips; `/api/capture` text path (deterministic only).

## Phase 4 — Voice ✅ built 2026-11-07 (real-clip benchmark + real-device testing still open)
Done: Web Audio WAV recorder with all error states, consent, `/api/voice` (Gemini, hedged, thinking minimal), same parser as text, review/confirm/save/undo, latency metrics. Chirp 3 streaming relay built (Vercel route + dev relay) with automatic Gemini fallback. Open: service-account credentials + first live Chirp run, ≥ 60 real Khmer clips benchmark (Chirp vs Gemini), Android Chrome + iPhone Safari device test.

Recorder with runtime format detection + all error states; consent; STT benchmark → pick provider; LLM extraction + reconciliation; review screen; latency metrics; test on real Android Chrome + iPhone Safari.

## Phase 5 — Dashboard & insights ✅ done 2026-11-08
Done: `insights()` SQL (one round trip: per-currency totals + previous period, by category, by account, local-date series, largest; transfers/opening/voided excluded; account filter); pure tested derivations (`lib/insights.ts`); Insights screen (7/30 days, ≈/៛/$ modes, account filter, CSS bar chart, today/7d/30d tiles, insight cards, deterministic quick answers, by category, by account, in vs out, business "cash flow, not profit"); Home today-vs-yesterday line + category mix; self-hosted 21 KB icon subset (`npm run icons`); proxy no longer redirects static files; login fade removed (−280 ms FCP).
Lighthouse mobile (login, before the font/proxy fixes): performance 87, accessibility 100, best practices 100. Re-measure pending: later runs hit Lighthouse NO_FCP on this machine (page paints fine in Chrome — environment issue, not reproduced in the app).

Home overview (30d in/out/net, category mix); Insights (7d/30d, by category, by account, in vs out, deterministic quick questions); business wording ("cash flow, not profit"); perf pass (bundle, fonts, Lighthouse mobile).

## Phase 6 — Beta (built 2026-11-08; prod deploy awaiting approval)
Done: CSV export + self-service account deletion (0006, Settings → Your data); PWA (manifest, icons, shell-only service worker, offline page, Apple meta); security review (RLS/grants audit, 0007 hardening, security headers, prod deps 0 vulns); server error logging (`instrumentation.ts`) + error boundaries; Playwright E2E 28/28 on Pixel 7 + iPhone 14 WebKit. Deploy checklist: `docs/DEPLOY.md`.
Open: production deploy + prod Supabase (needs approval), client-side error reporting service (Sentry needs approval), real-device checklist, CSP script-src (needs nonces).

Playwright E2E on mobile viewports + WebKit; security review (RLS, keys, rate limits); PWA manifest + shell cache; error monitoring; prod Supabase + Vercel (deploy only with approval); data export/delete.

## Cut from MVP (in the design, deferred)
Budget/savings goals (hardcoded in design), statement import (keep "coming soon" card), offline save-and-sync, simulated-offline toggle, voice auto-save countdown.
