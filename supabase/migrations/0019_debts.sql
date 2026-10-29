-- 0019: debts in both directions — what you borrowed and what you lent, from
-- a bank or a person, repaid in installments, in one payment on a date, or
-- "when I can".
--
-- A loan row grows:
--   direction           'owe' (you borrowed it) or 'lent' (someone owes you)
--   counterparty        the bank or the person
--   deposit_account_id  where the money landed (owe) or left from (lent)
--   pay_account_id      where repayments leave from (owe) or land in (lent)
--   payoff_date         a one-payment debt's date; null = "when I can"
-- and two new values: kind 'personal' (a person, no bank) and schedule_kind
-- 'lumpSum' (repaid in one payment on payoff_date).
--
-- transactions.loan_principal marks the money borrowed or lent itself, and
-- what you get back of money you lent: it moves balances like any row, but
-- it isn't income or spending.
--
-- Existing loans become 'owe' debts with their schedule unchanged.
-- Every statement is idempotent: the file can be re-run safely.

alter type loan_kind add value if not exists 'personal';

alter table loans add column if not exists direction text not null default 'owe';
alter table loans drop constraint if exists loans_direction_check;
alter table loans add constraint loans_direction_check check (direction in ('owe', 'lent'));

alter table loans add column if not exists counterparty text;
alter table loans add column if not exists deposit_account_id uuid references accounts (id) on delete set null;
alter table loans add column if not exists pay_account_id uuid references accounts (id) on delete set null;
alter table loans add column if not exists payoff_date date;

alter table loans drop constraint if exists loans_schedule_kind_check;
alter table loans
  add constraint loans_schedule_kind_check
  check (schedule_kind in ('annuity', 'equalPrincipal', 'interestOnly', 'zeroInterest', 'custom', 'lumpSum'));

alter table transactions add column if not exists loan_principal boolean not null default false;
