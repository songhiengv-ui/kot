-- Phase 2: edit transactions, archive accounts, change default account.
-- One posting writer shared by record + update so the money rules live in one place.

create function private.write_postings(p_tx uuid, p_ws uuid, p_type text, p_amt bigint, p_cur text,
                                       p_account uuid, p_to uuid, p_to_amt bigint, p_rate integer, p_allow_archived boolean)
returns integer  -- the rate used for a conversion, else null
language plpgsql security definer set search_path = '' as $$
declare acc record; to_acc record; v_to bigint; used integer;
begin
  select * into acc from public.accounts
   where id = p_account and workspace_id = p_ws and (p_allow_archived or archived_at is null);
  if not found then raise exception 'account not in workspace'; end if;

  if p_type = 'transfer' then
    select * into to_acc from public.accounts
     where id = p_to and workspace_id = p_ws and (p_allow_archived or archived_at is null);
    if not found then raise exception 'destination account not in workspace'; end if;
    if to_acc.id = acc.id then raise exception 'transfer needs two different accounts'; end if;
    if p_cur <> acc.currency then raise exception 'transfer amount must be in source account currency'; end if;
    if to_acc.currency = acc.currency then v_to := p_amt;
    else v_to := coalesce(p_to_amt, private.convert(p_amt, acc.currency, to_acc.currency, p_rate)); used := p_rate;
    end if;
    if v_to <= 0 then raise exception 'bad destination amount'; end if;
    insert into public.postings (transaction_id, account_id, amount, currency) values
      (p_tx, acc.id, -p_amt, acc.currency), (p_tx, to_acc.id, v_to, to_acc.currency);
  else
    if p_cur <> acc.currency then used := p_rate; end if;
    insert into public.postings (transaction_id, account_id, amount, currency) values
      (p_tx, acc.id, (case when p_type = 'expense' then -1 else 1 end) * private.convert(p_amt, p_cur, acc.currency, p_rate), acc.currency);
  end if;
  return used;
end $$;
revoke all on function private.write_postings(uuid, uuid, text, bigint, text, uuid, uuid, bigint, integer, boolean) from public;

-- Validates one item; raises on anything invalid. Amount must be a JSON integer string/number.
create function private.check_item(it jsonb) returns void language plpgsql immutable set search_path = '' as $$
begin
  if it->>'type' not in ('expense','income','transfer') then raise exception 'bad type'; end if;
  if (it->>'amount')::bigint is null or (it->>'amount')::bigint <= 0 then raise exception 'amount must be a positive integer'; end if;
  if it->>'currency' not in ('USD','KHR') then raise exception 'bad currency'; end if;
  if char_length(coalesce(it->>'note', '')) > 200 then raise exception 'note too long'; end if;
end $$;

create or replace function public.record_transactions(p_workspace uuid, p_key text, p_items jsonb, p_source text default 'manual')
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare it jsonb; i int := 0; ids uuid[]; tx_id uuid; v_rate integer; v_used integer;
begin
  if auth.uid() is null or not private.is_member(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad idempotency key'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'items must be 1..10'; end if;
  if p_source not in ('manual','text','voice') then raise exception 'bad source'; end if;

  select array_agg(id order by idempotency_key) into ids from public.transactions
   where workspace_id = p_workspace and idempotency_key like p_key || ':%';
  if ids is not null then return ids; end if;
  ids := '{}';
  select khr_per_usd into v_rate from public.profiles where id = auth.uid();

  begin
    for it in select * from jsonb_array_elements(p_items) loop
      i := i + 1;
      perform private.check_item(it);
      insert into public.transactions (workspace_id, type, category_id, note, occurred_at, amount, currency, source, idempotency_key)
      values (p_workspace, it->>'type',
              case when it->>'type' = 'transfer' then null else coalesce(it->>'category_id', 'other') end,
              nullif(trim(it->>'note'), ''), coalesce((it->>'occurred_at')::timestamptz, now()),
              (it->>'amount')::bigint, it->>'currency', p_source, p_key || ':' || lpad(i::text, 2, '0'))
      returning id into tx_id;
      v_used := private.write_postings(tx_id, p_workspace, it->>'type', (it->>'amount')::bigint, it->>'currency',
                  (it->>'account_id')::uuid, (it->>'to_account_id')::uuid, (it->>'to_amount')::bigint, v_rate, false);
      if v_used is not null then update public.transactions set fx_khr_per_usd = v_used where id = tx_id; end if;
      ids := ids || tx_id;
    end loop;
  exception when unique_violation then
    select array_agg(id order by idempotency_key) into ids from public.transactions
     where workspace_id = p_workspace and idempotency_key like p_key || ':%';
  end;
  return ids;
end $$;

-- Replace a transaction's fields and postings atomically. Keeps the originally frozen rate when there is one.
create function public.update_transaction(p_id uuid, p_item jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare tx record; v_rate integer; v_used integer;
begin
  select * into tx from public.transactions where id = p_id for update;
  if not found or not private.is_member(tx.workspace_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if tx.type = 'opening' or tx.voided_at is not null then raise exception 'not editable'; end if;
  perform private.check_item(p_item);
  select coalesce(tx.fx_khr_per_usd, p.khr_per_usd) into v_rate from public.profiles p where p.id = auth.uid();

  delete from public.postings where transaction_id = p_id;
  update public.transactions set
    type = p_item->>'type',
    category_id = case when p_item->>'type' = 'transfer' then null else coalesce(p_item->>'category_id', 'other') end,
    note = nullif(trim(p_item->>'note'), ''),
    occurred_at = coalesce((p_item->>'occurred_at')::timestamptz, tx.occurred_at),
    amount = (p_item->>'amount')::bigint, currency = p_item->>'currency', fx_khr_per_usd = null
  where id = p_id;
  -- archived accounts allowed here so old records stay editable
  v_used := private.write_postings(p_id, tx.workspace_id, p_item->>'type', (p_item->>'amount')::bigint, p_item->>'currency',
              (p_item->>'account_id')::uuid, (p_item->>'to_account_id')::uuid, (p_item->>'to_amount')::bigint, v_rate, true);
  if v_used is not null then update public.transactions set fx_khr_per_usd = v_used where id = p_id; end if;
end $$;

create function public.set_account_archived(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.accounts where id = p_id;
  if ws is null or not private.is_member(ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.accounts set archived_at = case when p_archived then coalesce(archived_at, now()) end,
                             is_default = case when p_archived then false else is_default end
  where id = p_id;
end $$;

create function public.set_default_account(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.accounts where id = p_id and archived_at is null;
  if ws is null or not private.is_member(ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.accounts set is_default = false where workspace_id = ws and is_default;
  update public.accounts set is_default = true where id = p_id;
end $$;

revoke all on function public.update_transaction(uuid, jsonb) from public, anon;
revoke all on function public.set_account_archived(uuid, boolean) from public, anon;
revoke all on function public.set_default_account(uuid) from public, anon;
grant execute on function public.update_transaction(uuid, jsonb) to authenticated;
grant execute on function public.set_account_archived(uuid, boolean) to authenticated;
grant execute on function public.set_default_account(uuid) to authenticated;
