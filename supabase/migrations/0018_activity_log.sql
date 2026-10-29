-- 0018: what changed, and when — the history behind every account, card and
-- item.
--
-- Money movements already tell their own story (transactions). What they
-- don't tell is everything else: gold holdings edited, an opening balance or
-- a card limit changed, a row edited or deleted, a payment completed or
-- reopened, a recurring item or big purchase changed. Each of those writes
-- one row here, with the fields it changed as { field: [before, after] }.
--
-- Written by the app after the change itself succeeds; a database where this
-- hasn't run yet simply keeps no history (nothing else depends on it).
-- Every statement is idempotent: the file can be re-run safely.

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  entity_type text not null,
  entity_id text not null,
  account_id uuid,
  action text not null,
  summary text not null default '',
  changes jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_user_at_idx on activity_log (user_id, at desc);
create index if not exists activity_log_account_idx on activity_log (user_id, account_id, at desc);

alter table activity_log enable row level security;

drop policy if exists "own activity" on activity_log;
create policy "own activity" on activity_log for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
