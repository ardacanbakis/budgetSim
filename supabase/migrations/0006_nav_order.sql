-- Wave 6: user-defined sidebar order.
-- Every statement is idempotent — the file can be re-run safely.

alter table user_settings
  -- ordered list of nav item ids, e.g. ["/", "/victvs", "/accounts", ...]
  add column if not exists nav_order jsonb;
