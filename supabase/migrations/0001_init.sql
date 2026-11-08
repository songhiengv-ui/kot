-- Kat — initial schema. Money = bigint minor units (USD cents, KHR riel).
-- Reads: RLS on membership. Writes to ledger tables: only via the RPCs below.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ── tables ──────────────────────────────────────────────────────────────

create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text check (char_length(display_name) <= 80),
  locale        text not null default 'km' check (locale in ('km','en')),
  khmer_digits  boolean not null default true,
  khr_per_usd   integer not null default 4100 check (khr_per_usd between 1000 and 10000),
  created_at    timestamptz not null default now()
);

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles on delete cascade,
  kind        text not null check (kind in ('personal','business')),
  name        text not null check (char_length(name) <= 60),
  created_at  timestamptz not null default now(),
  unique (owner_id, kind)  -- ponytail: one of each per user; drop when multiple businesses are needed
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces on delete cascade,
  user_id       uuid not null references public.profiles on delete cascade,
  role          text not null default 'owner' check (role in ('owner','member')),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.categories (
  id       text primary key,
  icon     text not null,
  name_km  text not null,
  name_en  text not null
);

create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces on delete cascade,
  kind          text not null check (kind in ('aba','acleda','wing','cash','other','custom')),
  name          text check (char_length(name) <= 40),   -- null = localized default for kind
  currency      text not null check (currency in ('USD','KHR')),
  color         text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default    boolean not null default false,
  archived_at   timestamptz,
  idempotency_key text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index on public.accounts (workspace_id);
create unique index accounts_one_default on public.accounts (workspace_id) where is_default and archived_at is null;

create table public.transactions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces on delete cascade,
  type             text not null check (type in ('expense','income','transfer','opening')),
  category_id      text references public.categories,
  note             text check (char_length(note) <= 200),
  occurred_at      timestamptz not null default now(),
  amount           bigint not null check (amount > 0),        -- as entered, in `currency`
  currency         text not null check (currency in ('USD','KHR')),
  fx_khr_per_usd   integer check (fx_khr_per_usd between 1000 and 10000),  -- frozen when a conversion happened
  source           text not null default 'manual' check (source in ('manual','text','voice')),
  idempotency_key  text not null,
  voided_at        timestamptz,
  created_by       uuid not null default auth.uid() references public.profiles,
  created_at       timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index on public.transactions (workspace_id, occurred_at desc);

create table public.postings (
  id              bigint generated always as identity primary key,
  transaction_id  uuid not null references public.transactions on delete cascade,
  account_id      uuid not null references public.accounts,
  amount          bigint not null check (amount <> 0),        -- signed, in account currency
  currency        text not null check (currency in ('USD','KHR'))
);
create index on public.postings (transaction_id);
create index on public.postings (account_id);

-- Balance per account (voided transactions excluded). security_invoker → RLS of caller applies.
create view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.workspace_id, a.currency,
       coalesce(sum(p.amount) filter (where t.voided_at is null), 0)::bigint as balance
from public.accounts a
left join public.postings p on p.account_id = a.id
left join public.transactions t on t.id = p.transaction_id
group by a.id;

-- ── helpers ─────────────────────────────────────────────────────────────

create function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = ws and user_id = (select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;

-- Convert minor units with a frozen rate. Rounds half away from zero.
create function private.convert(amount bigint, from_cur text, to_cur text, khr_per_usd integer) returns bigint
language sql immutable set search_path = '' as $$
  select case
    when from_cur = to_cur then amount
    when from_cur = 'USD' then round(amount::numeric * khr_per_usd / 100)::bigint   -- cents → riel
    else round(amount::numeric * 100 / khr_per_usd)::bigint                          -- riel → cents
  end;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.categories        enable row level security;
alter table public.accounts          enable row level security;
alter table public.transactions      enable row level security;
alter table public.postings          enable row level security;

create policy "own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "member workspaces" on public.workspaces for select to authenticated using (private.is_member(id));
create policy "own memberships" on public.workspace_members for select to authenticated using (user_id = (select auth.uid()));
create policy "categories readable" on public.categories for select to authenticated using (true);
create policy "member accounts" on public.accounts for select to authenticated using (private.is_member(workspace_id));
create policy "member accounts update" on public.accounts for update to authenticated
  using (private.is_member(workspace_id)) with check (private.is_member(workspace_id));
create policy "member transactions" on public.transactions for select to authenticated using (private.is_member(workspace_id));
create policy "member postings" on public.postings for select to authenticated using (
  exists (select 1 from public.transactions t where t.id = transaction_id and private.is_member(t.workspace_id)));

-- Table privileges: read-only except safe columns. No direct inserts anywhere.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.workspaces, public.workspace_members, public.categories,
               public.accounts, public.transactions, public.postings, public.account_balances to authenticated;
grant update (display_name, locale, khmer_digits, khr_per_usd) on public.profiles to authenticated;
grant update (name, color, kind) on public.accounts to authenticated;  -- currency/default/archive via RPC

-- ── RPCs (security definer: each checks membership itself) ──────────────

-- items: [{type, amount, currency, account_id, category_id?, note?, occurred_at?, to_account_id?, to_amount?}]
-- Returns transaction ids in item order. Same key again → same ids, nothing new written.
create function public.record_transactions(p_workspace uuid, p_key text, p_items jsonb, p_source text default 'manual')
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; i int := 0; ids uuid[] := '{}'; tx_id uuid;
  v_type text; v_amt bigint; v_cur text; acc record; to_acc record; v_to_amt bigint;
  v_rate integer; v_used_rate integer; v_cat text;
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
      v_type := it->>'type';
      v_amt  := (it->>'amount')::bigint;      -- integer only; '2.5' fails the cast
      v_cur  := it->>'currency';
      v_used_rate := null;
      if v_type not in ('expense','income','transfer') then raise exception 'bad type'; end if;
      if v_amt is null or v_amt <= 0 then raise exception 'amount must be a positive integer'; end if;
      if v_cur not in ('USD','KHR') then raise exception 'bad currency'; end if;

      select * into acc from public.accounts
       where id = (it->>'account_id')::uuid and workspace_id = p_workspace and archived_at is null;
      if not found then raise exception 'account not in workspace'; end if;

      v_cat := case when v_type = 'transfer' then null else coalesce(it->>'category_id', 'other') end;

      insert into public.transactions (workspace_id, type, category_id, note, occurred_at, amount, currency, source, idempotency_key)
      values (p_workspace, v_type, v_cat, nullif(trim(it->>'note'), ''),
              coalesce((it->>'occurred_at')::timestamptz, now()), v_amt, v_cur, p_source, p_key || ':' || lpad(i::text, 2, '0'))
      returning id into tx_id;

      if v_type = 'transfer' then
        select * into to_acc from public.accounts
         where id = (it->>'to_account_id')::uuid and workspace_id = p_workspace and archived_at is null;
        if not found then raise exception 'destination account not in workspace'; end if;
        if to_acc.id = acc.id then raise exception 'transfer needs two different accounts'; end if;
        if v_cur <> acc.currency then raise exception 'transfer amount must be in source account currency'; end if;
        if to_acc.currency = acc.currency then
          v_to_amt := v_amt;
        else
          v_to_amt := coalesce((it->>'to_amount')::bigint, private.convert(v_amt, acc.currency, to_acc.currency, v_rate));
          v_used_rate := v_rate;
        end if;
        if v_to_amt <= 0 then raise exception 'bad destination amount'; end if;
        insert into public.postings (transaction_id, account_id, amount, currency) values
          (tx_id, acc.id, -v_amt, acc.currency), (tx_id, to_acc.id, v_to_amt, to_acc.currency);
      else
        if v_cur <> acc.currency then v_used_rate := v_rate; end if;
        insert into public.postings (transaction_id, account_id, amount, currency) values
          (tx_id, acc.id,
           (case when v_type = 'expense' then -1 else 1 end) * private.convert(v_amt, v_cur, acc.currency, v_rate),
           acc.currency);
      end if;

      if v_used_rate is not null then update public.transactions set fx_khr_per_usd = v_used_rate where id = tx_id; end if;
      ids := ids || tx_id;
    end loop;
  exception when unique_violation then
    -- concurrent retry with the same key won the race: return its rows
    select array_agg(id order by idempotency_key) into ids from public.transactions
     where workspace_id = p_workspace and idempotency_key like p_key || ':%';
  end;
  return ids;
end $$;

-- Undo a save (voided = true) or undo a delete (voided = false).
create function public.set_transaction_voided(p_id uuid, p_voided boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.transactions where id = p_id and type <> 'opening';
  if ws is null or not private.is_member(ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.transactions set voided_at = case when p_voided then coalesce(voided_at, now()) end where id = p_id;
end $$;

create function public.create_account(p_workspace uuid, p_key text, p_kind text, p_name text, p_currency text,
                                      p_color text, p_opening bigint default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a_id uuid; tx_id uuid;
begin
  if auth.uid() is null or not private.is_member(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad idempotency key'; end if;
  select id into a_id from public.accounts where workspace_id = p_workspace and idempotency_key = p_key;
  if a_id is not null then return a_id; end if;

  insert into public.accounts (workspace_id, kind, name, currency, color, idempotency_key)
  values (p_workspace, p_kind, nullif(trim(p_name), ''), p_currency, p_color, p_key) returning id into a_id;
  if coalesce(p_opening, 0) <> 0 then
    insert into public.transactions (workspace_id, type, amount, currency, idempotency_key)
    values (p_workspace, 'opening', abs(p_opening), p_currency, p_key) returning id into tx_id;
    insert into public.postings (transaction_id, account_id, amount, currency) values (tx_id, a_id, p_opening, p_currency);
  end if;
  return a_id;
end $$;

-- Per-currency totals for a period (original currencies, never converted here). Transfers/openings excluded.
create function public.period_totals(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (type text, currency text, total bigint) language sql stable security invoker set search_path = '' as $$
  select t.type, t.currency, sum(t.amount)::bigint
  from public.transactions t
  where t.workspace_id = p_workspace and t.voided_at is null and t.type in ('expense','income')
    and t.occurred_at >= p_from and t.occurred_at < p_to
  group by t.type, t.currency;
$$;

revoke all on function public.record_transactions(uuid, text, jsonb, text) from public, anon;
revoke all on function public.set_transaction_voided(uuid, boolean) from public, anon;
revoke all on function public.create_account(uuid, text, text, text, text, text, bigint) from public, anon;
revoke all on function public.period_totals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.record_transactions(uuid, text, jsonb, text) to authenticated;
grant execute on function public.set_transaction_voided(uuid, boolean) to authenticated;
grant execute on function public.create_account(uuid, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.period_totals(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function private.convert(bigint, text, text, integer) from public;

-- ── new-user bootstrap ──────────────────────────────────────────────────

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p uuid; b uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  insert into public.workspaces (owner_id, kind, name) values (new.id, 'personal', 'Personal') returning id into p;
  insert into public.workspaces (owner_id, kind, name) values (new.id, 'business', 'Business') returning id into b;
  insert into public.workspace_members (workspace_id, user_id) values (p, new.id), (b, new.id);
  insert into public.accounts (workspace_id, kind, currency, color, is_default)
  values (p, 'cash', 'KHR', '#4A4B45', true), (b, 'cash', 'KHR', '#4A4B45', true);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- ── seed ────────────────────────────────────────────────────────────────

insert into public.categories (id, icon, name_km, name_en) values
  ('food','restaurant','អាហារ','Food'), ('coffee','local_cafe','កាហ្វេ និងភេសជ្ជៈ','Coffee & drinks'),
  ('transport','two_wheeler','ធ្វើដំណើរ','Transport'), ('fuel','local_gas_station','សាំង','Fuel'),
  ('groceries','shopping_basket','ផ្សារ','Groceries'), ('shopping','shopping_bag','ទិញឥវ៉ាន់','Shopping'),
  ('bills','bolt','វិក្កយបត្រ','Bills'), ('phone','smartphone','ទូរស័ព្ទ','Phone'),
  ('rent','home','ថ្លៃជួល','Rent'), ('stock','inventory_2','ស្តុកទំនិញ','Stock'),
  ('delivery','local_shipping','ដឹកជញ្ជូន','Delivery'), ('wages','badge','ប្រាក់ឈ្នួល','Wages'),
  ('salary','payments','ប្រាក់ខែ','Salary'), ('sales','storefront','លក់','Sales'),
  ('other','more_horiz','ផ្សេងៗ','Other');
