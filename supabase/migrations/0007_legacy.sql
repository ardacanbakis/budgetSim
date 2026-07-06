-- Wave 7: legacy records — settled history imported for reference. Legacy
-- transactions appear in lists, item history and reports, but are excluded
-- from balances, net worth, debt, safe-to-spend and budgets.
-- Every statement is idempotent — the file can be re-run safely.

alter table transactions
  add column if not exists legacy boolean not null default false;

create index if not exists transactions_legacy_idx on transactions (user_id) where legacy;
