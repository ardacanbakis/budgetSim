-- Planner scenarios move off the device and into the database, so the same
-- named plan opens on the phone and the laptop. The plan body stays jsonb:
-- it's a scratchpad whose shape changes with the planner, and nothing else
-- queries inside it.
-- Every statement is idempotent — the file can be re-run safely.

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_user_idx on plans (user_id, updated_at desc);

alter table plans enable row level security;

drop policy if exists "own plans" on plans;
create policy "own plans" on plans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
