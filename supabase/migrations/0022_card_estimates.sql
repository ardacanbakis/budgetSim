-- 0022: what you expect a card's statement to be.
--
-- A bank shows a card's installments for the months ahead before the app
-- can know them: everything bought outside the tracked big purchases. Each
-- row is one such expectation for one statement month, with the day it was
-- noted. Noting a month again adds a row rather than overwriting, so how
-- the expectation moved, and how the statement finally came out against it,
-- can be read back. Until a month's payment is recorded the plan pays the
-- larger of the latest expectation and the charges the app tracks.
--
-- A database where this hasn't run yet simply has no expectations; nothing
-- else depends on it. Every statement is idempotent: re-running is safe.

create table if not exists card_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null check (amount >= 0),
  noted_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists card_estimates_user_idx on card_estimates (user_id, account_id, month);

alter table card_estimates enable row level security;

drop policy if exists "own card estimates" on card_estimates;
create policy "own card estimates" on card_estimates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
