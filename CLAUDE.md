# Kat (កត់) — project rules

Khmer-first money notebook, mobile web. Docs: `docs/` (start with `docs/AUDIT.md`, `docs/ARCHITECTURE.md`).

## Non-negotiables
- Money is integer minor units (USD cents, KHR riel) in `bigint`/`number` integers. Never `parseFloat` money. Never float math on money.
- Balances/totals come from Postgres postings, never from frontend sums. Writes go through RPCs only, with an idempotency key.
- Transfers between own accounts are never expense or income.
- Cross-currency amounts are frozen at entry; ≈ totals show the rate used. Never invent a rate.
- AI output is untrusted input: Zod-validate, reconcile with `lib/parse`, flag ambiguity. Never save an ambiguous amount, currency, account or transfer side without user confirmation.
- Never claim bank connection or verified balances. Never ask for bank credentials/OTPs.
- Secrets (Supabase service role, AI keys) server-only. No financial data, notes, transcripts or audio in logs or localStorage.
- `lib/money` and `lib/parse` stay pure (no React/Supabase/AI imports).

## Working rules
- `design/` is the read-only visual reference. Match it; don't redesign.
- Mobile first (320 px up), real buttons/inputs, ≥ 44 px targets, visible focus, km + en strings for every label.
- Small reviewable changes; run tests and report real output. Don't call mocked things live.
- No destructive migrations, deploys, or new heavy dependencies without approval.
