-- 0016: balance adjustments.
--
-- A balance adjustment brings an account in line with what the bank shows:
-- transfer fees, late-payment charges, a little interest — money that moved
-- but was never entered one by one. It is an ordinary completed income or
-- expense row, so balances, reports and the account's history all count it;
-- this flag only lets the screens label it ("Adjustment") and keep it apart.
--
-- The app sends the column only for adjustments, so every other entry keeps
-- saving on a database where this hasn't run yet.
-- Every statement is idempotent — the file can be re-run safely.

alter table transactions
  add column if not exists adjustment boolean not null default false;

comment on column transactions.adjustment is
  'True for a manual balance correction entered to match the bank (fees, small leaks, interest). Counted like any income/expense; the flag is for labelling.';
