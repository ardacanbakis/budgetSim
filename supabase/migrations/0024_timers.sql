-- 0024: date timers for the Gadgets page.
--
-- A countdown to a moment ahead (kind 'until': a trip, a payday, New Year)
-- or a count of the time gone by since one (kind 'since': moving house, the
-- last cigarette). Only the moment is stored, as a timestamp; the days,
-- hours and minutes are worked out from the clock whenever it's shown
-- (lib/domain/countdown.ts).
--
-- A database where this hasn't run yet simply shows no timers, and adding
-- one says which file to run; nothing else depends on it.
-- Every statement is idempotent: re-running is safe.

create table if not exists timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'until',
  target_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table timers drop constraint if exists timers_kind_check;
alter table timers add constraint timers_kind_check check (kind in ('until', 'since'));

create index if not exists timers_user_idx on timers (user_id, target_at);

alter table timers enable row level security;

drop policy if exists "own timers" on timers;
create policy "own timers" on timers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
