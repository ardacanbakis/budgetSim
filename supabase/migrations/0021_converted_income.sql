-- 0021: income paid in one currency and converted into another — a salary
-- paid in dollars that a middleman turns into lira, landing in a lira
-- account.
--
--   recurring_templates.convert_to_account_id  where it's converted into
--   recurring_templates.convert_from           the first payday that's
--                                              converted (set when it's
--                                              turned on; earlier paydays
--                                              are history as they are)
--   transactions.converts_id                   on both legs of the transfer
--                                              that converted a payday:
--                                              that payday's row
--
-- A converted payday is the income (in its own currency, as before) and a
-- transfer into the lira account for what actually arrived, so the
-- middleman's cut shows in the FX insights like any conversion.
-- Every statement is idempotent: the file can be re-run safely.

alter table recurring_templates add column if not exists convert_to_account_id uuid references accounts (id) on delete set null;
alter table recurring_templates add column if not exists convert_from date;
alter table transactions add column if not exists converts_id uuid references transactions (id) on delete set null;
