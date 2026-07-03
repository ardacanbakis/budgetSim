-- Renovator: multi-currency budget app — initial schema.
-- Server-authoritative: balances are always derived from completed
-- transactions (see account_balances view), never stored.
-- Every statement is idempotent — the file can be re-run safely.

do $$ begin
  create type currency_code as enum ('TRY', 'USD', 'EUR', 'BTC', 'XAU_G');
exception when duplicate_object then null; end $$;
do $$ begin
  create type account_kind as enum ('fiat', 'crypto', 'gold');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tx_direction as enum ('income', 'expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type tx_status as enum ('planned', 'completed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type frequency as enum ('weekly', 'monthly', 'yearly');
exception when duplicate_object then null; end $$;
do $$ begin
  create type victvs_status as enum ('unpaid', 'paid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type loan_kind as enum ('house', 'car', 'other');
exception when duplicate_object then null; end $$;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  currency currency_code not null,
  kind account_kind not null default 'fiat',
  opening_balance numeric(20, 8) not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  direction tx_direction not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now()
);

create table if not exists recurring_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  account_id uuid not null references accounts (id) on delete cascade,
  direction tx_direction not null,
  category_id uuid references categories (id) on delete set null,
  amount numeric(20, 8) not null check (amount > 0),
  frequency frequency not null default 'monthly',
  start_date date not null,
  end_date date,
  auto_complete boolean not null default false,
  loan_id uuid, -- fk added after loans table exists
  created_at timestamptz not null default now()
);

create table if not exists victvs_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payment_date date not null,
  account_id uuid not null references accounts (id) on delete restrict,
  total numeric(20, 8) not null,
  transaction_id uuid, -- fk added after transactions table exists
  session_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists victvs_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  session_type text not null default 'Session',
  amount numeric(20, 8) not null check (amount > 0), -- USD
  status victvs_status not null default 'unpaid',
  payout_id uuid references victvs_payouts (id) on delete set null,
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'paste')),
  created_at timestamptz not null default now()
);

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind loan_kind not null default 'other',
  currency currency_code not null default 'TRY',
  principal numeric(20, 8) not null check (principal > 0),
  monthly_rate_pct numeric(8, 4) not null check (monthly_rate_pct >= 0),
  term_months integer not null check (term_months > 0),
  start_date date not null,
  installment numeric(20, 8) not null,
  recurring_template_id uuid references recurring_templates (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table recurring_templates drop constraint if exists recurring_templates_loan_fk;
alter table recurring_templates
  add constraint recurring_templates_loan_fk
  foreign key (loan_id) references loans (id) on delete cascade;

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  direction tx_direction not null,
  category_id uuid references categories (id) on delete set null,
  amount numeric(20, 8) not null check (amount > 0),
  status tx_status not null default 'completed',
  due_date date not null,
  completed_at timestamptz,
  description text not null default '',
  fx_snapshot jsonb, -- { usdPer: {TRY,USD,EUR,BTC,XAU_G}, at } captured at completion
  transfer_group_id uuid,
  transfer_market_rate numeric(20, 10),
  recurring_template_id uuid references recurring_templates (id) on delete set null,
  loan_id uuid references loans (id) on delete set null,
  victvs_payout_id uuid references victvs_payouts (id) on delete set null,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or completed_at is not null)
);

alter table victvs_payouts drop constraint if exists victvs_payouts_transaction_fk;
alter table victvs_payouts
  add constraint victvs_payouts_transaction_fk
  foreign key (transaction_id) references transactions (id) on delete set null;

-- Global (not per-user) rate history written by the server cron.
create table if not exists fx_rates (
  id bigint generated always as identity primary key,
  currency currency_code not null,
  usd_per numeric(20, 10) not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index if not exists transactions_user_due_idx on transactions (user_id, due_date);
create index if not exists transactions_account_idx on transactions (account_id);
create index if not exists transactions_transfer_group_idx on transactions (transfer_group_id) where transfer_group_id is not null;
create index if not exists victvs_sessions_user_status_idx on victvs_sessions (user_id, status, date);
create index if not exists fx_rates_currency_fetched_idx on fx_rates (currency, fetched_at desc);

-- Derived balances: the single source of truth every device reads.
create or replace view account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.user_id,
  a.currency,
  a.opening_balance + coalesce(
    sum(case t.direction when 'income' then t.amount else -t.amount end)
      filter (where t.status = 'completed'),
    0
  ) as balance
from accounts a
left join transactions t on t.account_id = a.id
group by a.id;

-- Row-level security: each user only ever sees their own rows.
alter table accounts enable row level security;
alter table categories enable row level security;
alter table recurring_templates enable row level security;
alter table victvs_payouts enable row level security;
alter table victvs_sessions enable row level security;
alter table loans enable row level security;
alter table transactions enable row level security;
alter table fx_rates enable row level security;

drop policy if exists "own accounts" on accounts;
create policy "own accounts" on accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own categories" on categories;
create policy "own categories" on categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own recurring_templates" on recurring_templates;
create policy "own recurring_templates" on recurring_templates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own victvs_payouts" on victvs_payouts;
create policy "own victvs_payouts" on victvs_payouts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own victvs_sessions" on victvs_sessions;
create policy "own victvs_sessions" on victvs_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own loans" on loans;
create policy "own loans" on loans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own transactions" on transactions;
create policy "own transactions" on transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Anyone signed in (including anonymous demo sessions) may read rates;
-- only the service role writes them.
drop policy if exists "read rates" on fx_rates;
create policy "read rates" on fx_rates for select to authenticated using (true);

-- Default categories for a new user, callable right after signup.
create or replace function seed_default_categories()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into categories (user_id, name, direction, color)
  select auth.uid(), v.name, v.direction::tx_direction, v.color
  from (values
    ('Salary', 'income', '#16a34a'),
    ('VICTVS', 'income', '#0ea5e9'),
    ('Freelance', 'income', '#8b5cf6'),
    ('Other income', 'income', '#64748b'),
    ('Rent & housing', 'expense', '#ef4444'),
    ('Groceries', 'expense', '#f59e0b'),
    ('Utilities & bills', 'expense', '#06b6d4'),
    ('Transport', 'expense', '#84cc16'),
    ('Loan payment', 'expense', '#dc2626'),
    ('Health', 'expense', '#ec4899'),
    ('Entertainment', 'expense', '#a855f7'),
    ('Other expense', 'expense', '#64748b')
  ) as v(name, direction, color)
  where auth.uid() is not null
    and not exists (select 1 from categories c where c.user_id = auth.uid());
end;
$$;
