# Deploy checklist (beta)

Nothing here has been run. Production deploy and the prod Supabase project need owner approval first.

## 1. Rotate everything that was shared during development
- [ ] New Gemini/Google AI key(s) for prod; delete the two dev keys that were pasted in chat.
- [ ] Reset the dev database password (it was pasted in chat); update `.env.local`.
- [ ] New Google service account key for Chirp (prod project or same project, new key); delete the downloaded JSON from `Downloads`.

## 2. Supabase (prod project, separate from dev)
- [ ] Region: Singapore (`ap-southeast-1`) — closest to Cambodia.
- [ ] Apply migrations: `DATABASE_URL=<prod session pooler> node scripts/migrate.mjs` (uses the pinned CA in `supabase/prod-ca-2021.crt`).
- [ ] Auth → URL configuration: Site URL = prod domain; redirect `https://<domain>/auth/callback`.
- [ ] Auth → Email template "Magic Link": include `{{ .Token }}` (the app signs in with the 6-digit code).
- [ ] Auth → SMTP: custom SMTP (the built-in sender is rate-limited and for testing only).
- [ ] Auth → Google provider: OAuth client with the prod callback.
- [ ] Run the advisors (Dashboard → Advisors) — expect none from our schema; `rls_auto_enable` is Supabase's own event-trigger function.

## 3. Vercel
- [ ] Project from the GitHub repo; Node 24; function region `sin1` (next to the Supabase region).
- [ ] Env vars — **public**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STT_STREAM_URL=same-origin`.
      **server-only**: `STT_PROVIDER`, `STT_MODEL`, `STT_FALLBACK_MODELS`, `STT_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CHIRP_REGION`, optional `EXTRACT_PROVIDER`/`EXTRACT_API_KEY`/`EXTRACT_MODEL` (the AI text fallback runs on `STT_API_KEY` by default).
      Never set `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` on Vercel — the app doesn't use them.
- [ ] Deploy a preview first; check `/api/voice/stream` upgrades (Vercel WebSockets). If not, host `scripts/stt-relay.ts` on Cloud Run and point `NEXT_PUBLIC_STT_STREAM_URL` at it.

## 4. Smoke test on the preview URL (real phones)
- [ ] Android Chrome + iPhone Safari, in a tab and installed to the home screen.
- [ ] Email code sign-in, Google sign-in.
- [ ] Add ABA (USD) + Cash (KHR); "5$ coffee ABA"; transfer; undo; edit.
- [ ] Voice: allow mic, speak Khmer, check the amount before saving; deny mic → message.
- [ ] Settings → download CSV opens in Excel/Sheets with Khmer intact; delete a test account.
- [ ] Airplane mode → offline page; back online → app.

## 5. Monitoring
- Server errors: Vercel → Logs, search `kat_error` (route pattern + digest only).
- Voice health: `select outcome, stt_model, percentile_cont(.5) within group (order by stt_ms) from capture_metrics where created_at > now() - interval '1 day' group by 1, 2;`
- Rollback: Vercel instant rollback. Migrations are additive (no drops), so older builds keep working.
