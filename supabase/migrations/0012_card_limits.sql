-- Credit cards carry a limit, not an overdraft. Knowing it lets the app say
-- how much room is left once every installment still to come is counted, and
-- warn before a plan would blow past it.
-- Every statement is idempotent — the file can be re-run safely.

alter table accounts
  add column if not exists credit_limit numeric(20, 8);

comment on column accounts.credit_limit is
  'Credit cards only: the agreed limit in the account currency. Null = not set.';
