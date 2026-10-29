-- 0020: one income over time. A salary that got a raise is two recurring
-- items, the old amount ending the day before the new one starts; series
-- groups them (the first period's id), so Income shows one line with its
-- history. Each period stays an ordinary recurring item.
--
-- Only "Give a raise" and "Combine" write it; nothing else reads it.
-- Every statement is idempotent: the file can be re-run safely.

alter table recurring_templates add column if not exists series text;
