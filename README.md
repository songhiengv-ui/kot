# Kat (កត់)

Khmer-first voice & text money tracker for Cambodia — mobile web first.

**Status:** Phase 2 done — sign-in, accounts (add/edit/archive/default), expenses/income/transfers with edit, delete and Undo, quick text capture (Khmer + English) with an optional AI fallback, ledger in Postgres with RLS. Voice capture works via Gemini speech-to-text (~2–3 s per note) — needs `STT_API_KEY`. See `docs/ROADMAP.md`.

AI fallback for long/complex sentences uses Gemini on `STT_API_KEY` (or Anthropic if `ANTHROPIC_API_KEY` is set); with no key everything works on the deterministic parser. See `docs/AI_PIPELINE.md`.

## Run

```bash
npm install
cp .env.example .env.local        # fill in Supabase URL, publishable key, DATABASE_URL (session pooler)
npm run db:migrate                # applies supabase/migrations/*.sql once each
npm run dev                       # http://localhost:3000
npm test                          # unit + ledger/RLS tests (DB tests roll back; they need DATABASE_URL)
npm run stt-relay                 # optional: local Chirp 3 streaming relay (port from STT_RELAY_PORT, default 8787)
npm run e2e                       # Playwright: production build on :3200, Pixel 7 + iPhone 14 (WebKit); throwaway users, deleted after
npm run build && npm run lint && npm run typecheck
```

## Layout

- `design/` — imported Claude Design prototype (read-only reference)
- `docs/` — audit, architecture, database, AI pipeline, roadmap, decisions, testing
- `supabase/migrations/` — schema, RLS, RPCs (source of truth for the DB)
- `src/lib/money.ts`, `src/lib/parse.ts` — pure money + capture parser (unit tested)
- `src/lib/app.tsx` — session/workspace context, queries, toast/undo
- `src/app/(app)/` — Home, Activity, Accounts, Insights, Settings · `src/app/login` · `src/proxy.ts`
