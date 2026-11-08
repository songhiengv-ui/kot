# Decisions

| # | Date | Decision | Status |
|---|---|---|---|
| 1 | 2026-11-07 | Design is a reference, not code to keep: port `design/Kat Finance v2.dc.html` to React/TSX, preserving visuals. | Approved |
| 2 | 2026-11-07 | Next.js (16, App Router) + TS + Tailwind 4 + Supabase + Vercel. | Approved |
| 3 | 2026-11-07 | Ledger: `transactions` + signed `postings` in account currency, bigint minor units, writes only via RPC. | Approved |
| 4 | 2026-11-07 | Cross-currency postings frozen at entry rate (`fx_khr_per_usd` stored); ≈ totals converted at read time with the shown rate. | Approved |
| 5 | 2026-11-07 | Undo = void (soft), restore = un-void. | Approved |
| 6 | 2026-11-07 | Voice never auto-saves and never silently uses the default account. Text entry may fall back to the default account, labelled "(Default)" in the preview the user saves from. | Approved |
| 7 | 2026-11-07 | No chart library; CSS bars as in design. | Approved |
| 8 | 2026-11-07 | STT/LLM provider chosen by Khmer benchmark in Phase 4; model IDs in env. | Approved |
| 9 | 2026-11-07 | Keep Kantumruy Pro (design's choice) for Khmer. | Approved |
| 10 | 2026-11-07 | Auth: email OTP (6-digit code; link also works via `/auth/callback`) + Google OAuth. | Approved |
| 11 | 2026-11-07 | Ledger RPCs are `security definer` in `public`, each checks `private.is_member()` first; `anon` has no execute. Reason: RLS alone can't stop a client inserting unbalanced postings. Direct table writes are revoked. | Done |
| 12 | 2026-11-07 | App shell renders on the client with the cookie-based Supabase browser client; RLS is the authorization layer; `src/proxy.ts` only refreshes the session and redirects signed-out users. Pages wrap with `withApp()` so segments always render (Next 16 instant-navigation validation). | Done |
| 13 | 2026-11-07 | Settings (`locale`, `khmer_digits`, `khr_per_usd`) live on `profiles`, not a separate `user_settings` table. | Done |
| 14 | 2026-11-07 | Dev DB access via the IPv4 session pooler (direct host is IPv6-only) with TLS verified against the pinned Supabase root CA (`supabase/prod-ca-2021.crt`). | Done |
| 15 | 2026-11-07 | Material Symbols loaded as an `icon_names=` subset; add new icons to the list in `src/app/layout.tsx`. | Done |
| 16 | 2026-11-07 | Mic button opens text entry with an honest "voice is coming" note until Phase 4. | Done (temporary) |
| 17 | 2026-11-07 | Edits keep the transaction's frozen `fx_khr_per_usd`; a newly cross-currency edit freezes the current rate. Archived accounts stay usable in edits of their old records, not in new records. | Done |
| 18 | 2026-11-07 | Archived accounts are excluded from the "total tracked" (as in the design). Archiving a non-zero balance is allowed (closed accounts often have a drifted manual balance; it's one tap to undo or restore), and the toast says the amount is no longer counted in the total. | Done |
| 19 | 2026-11-07 | Save errors: Postgres-rejected values → "check the amount and accounts"; no response → "check your connection". Draft and idempotency key kept for retry. | Done |
| 20 | 2026-11-07 | Repeat chips save in one tap without a preview: they are exact copies of the user's own recent records (no parsing), shown with Undo. | Done |
| 21 | 2026-11-07 | Unsaved quick-entry text is kept in a module variable (memory) only; never localStorage/sessionStorage. | Done |
| 22 | 2026-11-07 | Every save path runs `ItemsSchema` (Zod) before the RPC; the DB validates again. | Done |
| 23 | 2026-11-07 | STT candidate #1: Gemini — superseded by #24. | Superseded |
| 24 | 2026-11-08 | STT: Chirp 3 streaming first (user's choice), Gemini `gemini-3-flash-preview:minimal` + hedged fallback as the automatic backup. Chirp needs a service account; until set, voice runs on Gemini. Pick the default by the real-clip benchmark. | Chirp built, needs credentials |
| 25 | 2026-11-07 | Never use flash-lite models for STT (heard ៣០០ for ១០០ in testing). | Done |
| 26 | 2026-11-07 | Voice consent stored as `profiles.voice_consent_at`; latency in `capture_metrics` (no audio/transcript/amounts). | Done |
| 27 | 2026-11-08 | Streaming relay is host-agnostic: Vercel `upgradeWebSocket` route (prod) + `npm run stt-relay` (dev). Cloud Run is an alternative host if Vercel WebSockets don't fit. | Done |
| 28 | 2026-11-08 | Insights computed in SQL per original currency; ≈ conversion only at display with the shown rate; quick answers are templates over those sums (no LLM). | Done |
| 29 | 2026-11-08 | Chirp 3 live test (synthetic clips): 2/2 exact, final ~0.86 s after end of audio; **no progressive interim results** observed (single partial at the end). Chirp is the faster/more accurate path so far; Gemini stays the automatic fallback. | Measured |
| 30 | 2026-11-08 | Export is a security-invoker SQL function (RLS-scoped) → CSV in the browser with a UTF-8 BOM (Excel + Khmer) and formula-injection guard; no server copy of the file. | Done |
| 31 | 2026-11-08 | Account deletion is self-service and immediate (`delete_my_account`, cascades), behind a typed confirmation. No soft-delete grace period yet. | Done |
| 32 | 2026-11-08 | Service worker caches only the app shell (hashed `/_next/static`, fonts, offline page). Never API/Supabase responses or pages — financial data stays network-only. Offline save-and-sync remains cut. | Done |
| 33 | 2026-11-08 | Security headers: frame-ancestors/X-Frame-Options DENY, nosniff, strict referrer, Permissions-Policy (mic self only), HSTS. No script-src CSP: Next inline scripts would need per-request nonces (forces dynamic rendering). | Done |
| 34 | 2026-11-08 | Error monitoring v1 = `onRequestError` → one JSON log line (`kat_error`, route pattern + digest, no query/headers/bodies) in host logs. Client errors only shown via boundaries. A hosted tracker (e.g. Sentry) needs approval (new dependency + data processor). | Done |
| 36 | 2026-11-08 | Voice always runs the AI extraction (typed text stays local-first via `needsAI`). First real-device test: Chirp worked, but 2 voice clips never reached the model and saved notes like "អឺ ពេញ កាហ្វេ អស់ ដល់ ណា?" and one implausible 500,000 ៛ water. Cost ≈ $0.10/user/month at 5 voice entries/day. Model off/failing → local parse. | Done |
| 35 | 2026-11-08 | E2E stubs `getUserMedia` rejections (headless browsers can't show real prompts); Playwright's Windows WebKit lacks mediaDevices/AudioWorklet, so the iPhone project asserts the "unsupported" path. Real mic stays on the device checklist. | Done |
