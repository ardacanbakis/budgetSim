-- Tasarruf finansman ("evim sistemi") scenarios, stored the same way planner
-- scenarios are: a name and a jsonb body, one row per saved plan.
--
-- Inputs only. The schedule — instalments, delivery period, compliance — is
-- derived deterministically from those inputs, so storing it would create a
-- second copy that can silently disagree with the engine the moment a rounding
-- rule or a BDDK threshold changes. Recompute it every time, exactly like
-- balances.
--
-- Every statement is idempotent: the file can be re-run safely.

create table if not exists savings_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists savings_plans_user_idx on savings_plans (user_id, updated_at desc);

alter table savings_plans enable row level security;

drop policy if exists "own savings plans" on savings_plans;
create policy "own savings plans" on savings_plans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
