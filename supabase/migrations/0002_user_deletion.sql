-- Deleting an auth user must cascade cleanly (data-deletion pathway).
-- created_by: keep shared-workspace history if a member is removed later → set null.
alter table public.transactions alter column created_by drop not null;
alter table public.transactions drop constraint transactions_created_by_fkey,
  add constraint transactions_created_by_fkey foreign key (created_by) references public.profiles on delete set null;
-- Accounts are archived, never deleted, except when their workspace goes; postings go with them.
alter table public.postings drop constraint postings_account_id_fkey,
  add constraint postings_account_id_fkey foreign key (account_id) references public.accounts on delete cascade;
