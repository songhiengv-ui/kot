-- Phase 4: voice consent + capture latency metrics (no audio, no transcript, no amounts stored).

alter table public.profiles add column voice_consent_at timestamptz;
grant update (voice_consent_at) on public.profiles to authenticated;

create table public.capture_metrics (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles on delete cascade,
  source      text not null check (source in ('text', 'voice')),
  outcome     text not null check (outcome in ('ok', 'empty', 'stt_error', 'busy', 'rejected')),
  audio_ms    integer check (audio_ms between 0 and 120000),
  upload_ms   integer check (upload_ms >= 0),
  stt_ms      integer check (stt_ms >= 0),
  extract_ms  integer check (extract_ms >= 0),
  stt_model   text check (char_length(stt_model) <= 60),
  used_ai     boolean not null default false,
  items       smallint check (items between 0 and 10),
  created_at  timestamptz not null default now()
);
create index on public.capture_metrics (created_at desc);

alter table public.capture_metrics enable row level security;
create policy "own metrics read" on public.capture_metrics for select to authenticated using (user_id = (select auth.uid()));
create policy "own metrics insert" on public.capture_metrics for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.capture_metrics from anon, authenticated;
grant select, insert (source, outcome, audio_ms, upload_ms, stt_ms, extract_ms, stt_model, used_ai, items) on public.capture_metrics to authenticated;
