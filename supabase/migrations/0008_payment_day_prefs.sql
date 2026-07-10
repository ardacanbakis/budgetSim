-- Wave 10: credit-card statement due day + display preferences.
-- Every statement is idempotent — the file can be re-run safely.

-- Day of month (1–31) the card's statement bill is due (credit cards only).
alter table accounts
  add column if not exists payment_day integer check (payment_day between 1 and 31);

alter table user_settings
  -- how yyyy-mm-dd dates are displayed: 'iso' | 'dmy' | 'mdy' | 'dmy-dot' | 'long'
  add column if not exists date_format text,
  -- show the floating quick-add (+) shortcut; null/true = shown
  add column if not exists show_quick_add boolean;
