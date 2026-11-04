-- 0025: rate alerts and pinned conversions for the Gadgets page.
--
-- rate_alerts: "tell me when 1 USD buys more than 43 TRY". A pair of the
-- converter's units (TRY, USD, EUR, BTC, XAU_G, or a gold type as
-- 'gold:ceyrek'), a direction and a threshold. The first time the app sees
-- a live rate meet it, triggered_at and triggered_rate are filled in, so it
-- fires once and says when; acknowledged_at is when its notice was
-- dismissed. Re-arming clears all three.
--
-- pinned_conversions: the conversions kept at hand (100 USD → TRY), shown as
-- tiles over the converter.
--
-- A database where this hasn't run yet simply has neither, and adding one
-- says which file to run; nothing else depends on them.
-- Every statement is idempotent: re-running is safe.

create table if not exists rate_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  direction text not null default 'above',
  threshold numeric not null check (threshold > 0),
  triggered_at timestamptz,
  triggered_rate numeric,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table rate_alerts drop constraint if exists rate_alerts_direction_check;
alter table rate_alerts add constraint rate_alerts_direction_check check (direction in ('above', 'below'));

create index if not exists rate_alerts_user_idx on rate_alerts (user_id, created_at);

alter table rate_alerts enable row level security;

drop policy if exists "own rate alerts" on rate_alerts;
create policy "own rate alerts" on rate_alerts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists pinned_conversions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists pinned_conversions_user_idx on pinned_conversions (user_id, created_at);

alter table pinned_conversions enable row level security;

drop policy if exists "own pinned conversions" on pinned_conversions;
create policy "own pinned conversions" on pinned_conversions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
