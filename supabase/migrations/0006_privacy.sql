-- Phase 6: data export + self-service account deletion.

-- Exact decimal text for a minor-unit amount (numeric, never float): 1250 USD → '12.50', -50 → '-0.50'.
create function private.fmt_minor(minor bigint, cur text) returns text
language sql immutable set search_path = '' as $$
  select case when cur = 'USD' then round(minor::numeric / 100, 2)::text else minor::text end
$$;
revoke all on function private.fmt_minor(bigint, text) from public;
grant execute on function private.fmt_minor(bigint, text) to authenticated;

-- Every transaction the caller can see (RLS applies: security invoker), one row each, oldest first.
-- account = the paying leg (or the only leg); to_account = the receiving leg of a transfer. Leg amounts are
-- signed, in the account's own currency (they differ from amount/currency when a conversion was frozen).
create function public.export_transactions(p_tz text default 'Asia/Phnom_Penh')
returns table (date text, workspace text, type text, category text, note text, amount text, currency text,
               account text, account_amount text, to_account text, to_account_amount text,
               khr_per_usd integer, source text, voided boolean)
language sql stable security invoker set search_path = '' as $$
  with leg as (
    select p.transaction_id, private.fmt_minor(p.amount, p.currency) as amt,
           coalesce(a.name, initcap(a.kind)) || ' (' || a.currency || ')' as label,
           row_number() over (partition by p.transaction_id order by p.amount) as rn   -- negative (paying) leg first
    from public.postings p join public.accounts a on a.id = p.account_id
  )
  select to_char(t.occurred_at at time zone p_tz, 'YYYY-MM-DD HH24:MI'), w.kind, t.type, t.category_id, t.note,
         private.fmt_minor(t.amount, t.currency), t.currency,
         l1.label, l1.amt, l2.label, l2.amt, t.fx_khr_per_usd, t.source, t.voided_at is not null
  from public.transactions t
  join public.workspaces w on w.id = t.workspace_id
  left join leg l1 on l1.transaction_id = t.id and l1.rn = 1
  left join leg l2 on l2.transaction_id = t.id and l2.rn = 2
  order by t.occurred_at, t.created_at
$$;
revoke all on function public.export_transactions(text) from public, anon;
grant execute on function public.export_transactions(text) to authenticated;

-- Deletes the caller's auth user; profile, workspaces, accounts, transactions, postings and metrics cascade.
-- The caller's access token stays valid until it expires, so the client signs out right after.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
