# Database

Source of truth: `supabase/migrations/`. This page is the overview. Differences from the first draft: settings live on `profiles`; `accounts.idempotency_key`; `account_balances` view (security_invoker); `period_totals()` RPC; `transactions.created_by` is `on delete set null` (0002).

Money is `bigint` minor units: USD = cents, KHR = riel. `currency` is `'USD' | 'KHR'` (check constraint). No floats anywhere.

## Tables

```sql
profiles            (id uuid pk = auth.users.id, display_name, locale 'km'|'en', khmer_digits bool, created_at)

workspaces          (id uuid pk, owner_id → profiles, kind 'personal'|'business', name, created_at)
workspace_members   (workspace_id, user_id, role 'owner'|'member', pk(workspace_id,user_id))
                    -- MVP: only owner rows; table exists so RLS doesn't need rewriting for shared wallets.

accounts            (id uuid pk, workspace_id, kind 'aba'|'acleda'|'wing'|'cash'|'other'|'custom',
                     name, currency, color, is_default bool, archived_at, created_at)
                    -- partial unique index: one is_default per workspace where archived_at is null

categories          (id text pk e.g. 'food', workspace_kind, icon, name_km, name_en, sort)   -- seeded, global

transactions        (id uuid pk, workspace_id, type 'expense'|'income'|'transfer'|'opening',
                     category_id, note, occurred_at timestamptz,
                     amount bigint > 0, currency,                 -- as entered/spoken
                     fx_rate_khr_per_usd int null,                -- frozen at entry when currencies differ
                     source 'manual'|'text'|'voice', capture_id null,
                     voided_at null, created_by, created_at,
                     idempotency_key text, unique(workspace_id, idempotency_key))

postings            (id bigserial pk, transaction_id, account_id, amount bigint,  -- signed, in ACCOUNT currency
                     currency)                                       -- must equal account.currency
                    -- expense: 1 posting (−)   income: 1 posting (+)
                    -- transfer: 2 postings (−from, +to); cross-currency stores both sides explicitly
                    -- opening: 1 posting (+/−)

user_settings       (user_id pk, khr_per_usd int default 4100, report_currency, mic_consent_at)

capture_jobs        (id uuid pk, user_id, workspace_id, kind 'voice'|'text', status,
                     stt_provider, extract_provider, ms_upload, ms_stt, ms_extract,
                     transcript text null,  -- retained only if user opted in
                     error_code, created_at)
```

## Invariants (enforced in SQL, tested)

- Every posting's `currency = accounts.currency` (trigger).
- Posting accounts belong to the transaction's workspace (trigger) — prevents cross-workspace leaks.
- Transfer: exactly 2 postings, different accounts; same-currency transfer sums to 0.
- Balance = `sum(postings.amount)` for non-voided transactions. Opening balance is just an `opening` transaction.
- Expense/income totals exclude `transfer` and `opening` types.
- Writes only via RPC (`record_transactions`, `update_transaction`, `void_transaction`, `create_account`), each one DB transaction. Direct insert on `transactions`/`postings` denied by RLS.

## Privacy (migration 0006)

- `export_transactions(p_tz)` — security **invoker**: RLS decides what the caller sees. One row per transaction; amounts as exact decimal text (numeric, never float); both transfer legs in their account currency; frozen rate; voided flag.
- `delete_my_account()` — security definer, deletes `auth.users where id = auth.uid()`; everything cascades (profile → workspaces → accounts/transactions/postings, metrics). The client then drops its local session (the access token stays valid until expiry).
- Migration 0007 revokes the default EXECUTE-to-PUBLIC on two private helpers (defense in depth; they were not reachable).

## Mixed-currency totals

Converted totals ("≈ $X") are computed at read time with the user's current `khr_per_usd`, always labelled ≈ and showing the rate. Stored postings never change when the rate changes. Per-currency totals are always available unconverted.

## RLS

`is_member(workspace_id)` helper; every table policy uses it. Tests: user B cannot select/insert/update/void anything in user A's workspaces; personal and business workspaces of the same user never mix in any RPC result.
