-- Wave 12: opt-in market-rate ticker in the header.
-- Every statement is idempotent — the file can be re-run safely.

alter table user_settings
  -- show the scrolling USD/TRY · EUR/TRY · BTC · gram-gold ticker; null = hidden
  add column if not exists show_rate_ticker boolean;
