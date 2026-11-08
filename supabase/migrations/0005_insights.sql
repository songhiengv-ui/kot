-- Phase 5: one round trip for dashboards/insights. Deterministic SQL; original currencies kept (no conversion here).
-- Excludes transfers, opening balances and voided records. Buckets use the user's local date (default Cambodia).
create function public.insights(p_workspace uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz,
                                p_tz text default 'Asia/Phnom_Penh', p_account uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with t as (
    select t.id, t.type, t.currency, t.amount, t.category_id, t.occurred_at,
           (select p.account_id from public.postings p where p.transaction_id = t.id order by p.id limit 1) as account_id
    from public.transactions t
    where t.workspace_id = p_workspace and t.voided_at is null and t.type in ('expense', 'income')
      and t.occurred_at >= p_prev_from and t.occurred_at < p_to
      and (p_account is null or exists (select 1 from public.postings p where p.transaction_id = t.id and p.account_id = p_account))
  ),
  cur as (select * from t where occurred_at >= p_from),
  prev as (select * from t where occurred_at < p_from)
  select jsonb_build_object(
    'totals',      (select coalesce(jsonb_agg(x), '[]') from (select type, currency, sum(amount)::bigint as total, count(*)::int as n from cur group by 1, 2) x),
    'prev',        (select coalesce(jsonb_agg(x), '[]') from (select type, currency, sum(amount)::bigint as total from prev group by 1, 2) x),
    'by_category', (select coalesce(jsonb_agg(x), '[]') from (select type, category_id, currency, sum(amount)::bigint as total from cur group by 1, 2, 3) x),
    'prev_by_category', (select coalesce(jsonb_agg(x), '[]') from (select type, category_id, currency, sum(amount)::bigint as total from prev group by 1, 2, 3) x),
    'by_account',  (select coalesce(jsonb_agg(x), '[]') from (select type, account_id, currency, sum(amount)::bigint as total from cur group by 1, 2, 3) x),
    'series',      (select coalesce(jsonb_agg(x order by d), '[]') from (
                      select (occurred_at at time zone p_tz)::date as d, type, currency, sum(amount)::bigint as total
                      from t group by 1, 2, 3) x),
    'largest',     (select to_jsonb(x) from (select id, type, category_id, currency, amount, account_id, occurred_at from cur where type = 'expense'
                      order by case when currency = 'USD' then amount * (select khr_per_usd from public.profiles where id = (select auth.uid())) / 100 else amount end desc limit 1) x)
  );
$$;
-- 'largest' ranks across currencies with the user's own rate only to pick the row; the amount is returned unconverted.
revoke all on function public.insights(uuid, timestamptz, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.insights(uuid, timestamptz, timestamptz, timestamptz, text, uuid) to authenticated;
