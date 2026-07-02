-- Wave 3: net-worth history snapshots (one per user per month, auto-taken on
-- app open, plus on-demand). Rates of the day are frozen in, so history stays
-- honest when FX moves later.

create table net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_date date not null,
  -- { [accountId]: balance } in each account's own currency
  balances jsonb not null,
  -- usdPer rate map frozen at snapshot time
  usd_per jsonb not null,
  total_usd numeric(20, 8) not null,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

alter table net_worth_snapshots enable row level security;
create policy "own snapshots" on net_worth_snapshots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
