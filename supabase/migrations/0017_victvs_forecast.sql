-- 0017: your own figures in the VICTVS forecast.
--
-- The forecast reads each month ahead from the same month in earlier years
-- (lib/domain/victvsForecast.ts). When you know better — a busy exam season
-- booked, a month off — you can set a month's figure yourself, and put the
-- forecast back later. The figures live here so every device sees them:
--   { "overrides": { "2026-12": 900, "2027-01": 0 } }
-- USD a month's work should earn, by the month the work is done.
--
-- The app sends the column only when a figure changes, so every other
-- setting keeps saving on a database where this hasn't run yet; reading it
-- there just means no figures of your own.
-- Every statement is idempotent — the file can be re-run safely.

alter table user_settings
  add column if not exists victvs_forecast jsonb;

comment on column user_settings.victvs_forecast is
  'VICTVS forecast edits: {"overrides": {"yyyy-MM": usd}}. USD the month''s work should earn, in place of the computed forecast. Null = none.';
