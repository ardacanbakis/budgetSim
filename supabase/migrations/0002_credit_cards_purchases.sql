-- Wave 1: credit cards as debt accounts + big purchases log (taksit installments).

alter type account_kind add value if not exists 'credit_card';

-- Default account the card's bill is paid from (credit cards only).
alter table accounts
  add column payment_account_id uuid references accounts (id) on delete set null;

create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- card or account it was bought with; nullable = unlinked log entry
  account_id uuid references accounts (id) on delete set null,
  amount numeric(20, 8) not null check (amount > 0),
  purchase_date date not null,
  -- 1 = one-shot purchase, >1 = equal monthly installments
  installment_count integer not null default 1 check (installment_count >= 1),
  first_due date not null,
  details text not null default '',
  reflected boolean not null default true,
  category_id uuid references categories (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table transactions
  add column purchase_id uuid references purchases (id) on delete cascade;

create index purchases_user_idx on purchases (user_id, purchase_date desc);
create index transactions_purchase_idx on transactions (purchase_id) where purchase_id is not null;

alter table purchases enable row level security;
create policy "own purchases" on purchases for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
