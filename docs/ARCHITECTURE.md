# Architecture (proposed — awaiting approval)

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + React + TypeScript (strict)** | Repo is empty of app code; one deployable for UI + server routes that hold AI secrets. |
| Styling | **Tailwind CSS** with the design tokens from `AUDIT.md` as theme | Inline styles in the design map 1:1 to utilities. |
| Data fetching | **TanStack Query** | Cache, retries, optimistic Undo. |
| Forms/validation | **Zod** (shared client/server). No form library until a form needs one. | |
| Backend | **Supabase**: Postgres, Auth, RLS | Ledger + RLS live in the DB, not in app code. |
| Session | `@supabase/ssr` cookie sessions | No tokens in localStorage. |
| AI | Server route `/api/capture` → STT provider → extraction provider → Zod → deterministic checks | Providers behind one small interface each; chosen by benchmark (see `AI_PIPELINE.md`). |
| Charts | CSS bars (as in design). No chart library for MVP. | Zero JS cost; design already does this. |
| Hosting | Vercel (app) + Supabase (dev + prod projects) | |
| Tests | Vitest (money, parser, ledger via local Supabase), Playwright (mobile viewports + WebKit) | |

Rejected for now: separate API service, microservices, queues, offline sync engine, native apps, Redux/Zustand (React state + Query is enough until proven otherwise).

## Module boundaries

```
src/
  app/                      routes (UI only — no money math here)
    (auth)/login
    (app)/home | activity | accounts | accounts/[id] | insights | settings
    api/capture/route.ts    audio|text → candidates (server only)
  components/               ported design components (Sheet, Chip, Segmented, TxRow, AccountCard, Toast…)
  lib/money/                integer minor units, parse/format, Khmer digits — pure, 100% unit tested
  lib/parse/                deterministic text/Khmer-number parser — pure, unit tested
  lib/ai/                   stt.ts, extract.ts provider adapters (server only)
  lib/i18n/                 km/en dictionaries (from design)
  lib/db/                   typed Supabase client + RPC wrappers
supabase/
  migrations/               schema, RLS, RPC functions
  tests/                    SQL/RLS tests
```

Rule: `lib/money` and `lib/parse` import nothing from React, Supabase or AI. AI output is *input* to the same validation the text path uses.

## Write path (all balance-affecting writes)

```
UI candidate(s) ──► Zod schema ──► RPC record_transactions(workspace, idempotency_key, items)
                                    │  one DB transaction:
                                    │  - check idempotency key (unique) → return existing on retry
                                    │  - validate accounts ∈ workspace, not archived
                                    │  - insert transaction + postings (integer minor units)
                                    └► returns ids  ──► Toast with Undo ──► RPC void_transaction(id)
```

Balances, totals and insights are SQL (views/RPCs) over postings. The frontend never sums money it then saves.

## Mobile-web strategy

- Mobile-first layout from 320 px; 4-tab bottom nav + center mic (as designed), `env(safe-area-inset-*)`, `100dvh`.
- ≥ 768 px: left sidebar nav, two-column home (overview + recent), sheets become centered dialogs/side panels.
- Text-entry sheet pinned above the keyboard via `visualViewport` resize.
- Route-level code splitting; voice screen + insights lazy-loaded. Home ships no chart lib, no recorder code.
- Fonts: `next/font` for Geist + Kantumruy Pro (subset, swap); Material Symbols subset to the ~70 icons used, or inline SVGs.
- Real `<button>`/`<input>` elements, visible focus, ≥ 44 px targets, darker muted text token, `prefers-reduced-motion`.
- PWA (manifest, icons, shell cache only — never financial data) in Phase 6.

## Security

- RLS on every table, keyed on workspace membership. Service-role key only in server env, never in client bundle.
- AI keys server-only. Rate limit `/api/capture` per user.
- Audio: not stored by default; processed in memory and discarded. Consent screen before first voice use (third-party processing).
- Never ask for bank credentials/OTPs; no account numbers stored.
- Logs: no notes, amounts or transcripts in application logs.
