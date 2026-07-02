-- Wave 2: category budgets, savings goals, per-user app settings.
-- Household-readiness: user_id stays the owner column everywhere; future
-- sharing = a households membership table + policy swap, no data migration.

create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  monthly_limit numeric(20, 8) not null check (monthly_limit > 0),
  currency currency_code not null default 'TRY',
  created_at timestamptz not null default now(),
  unique (user_id, category_id)
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  account_id uuid not null references accounts (id) on delete cascade,
  target_amount numeric(20, 8) not null check (target_amount > 0),
  target_date date,
  created_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dashboard_layout jsonb, -- { order: string[], hidden: string[] }
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  compact boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table budgets enable row level security;
alter table goals enable row level security;
alter table user_settings enable row level security;

create policy "own budgets" on budgets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own goals" on goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
