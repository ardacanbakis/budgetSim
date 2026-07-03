-- Wave 5: structured VICTVS sessions, default deposit account + per-type
-- amounts, and extra theme ids.

alter table victvs_sessions
  add column session_no text not null default '';

alter table user_settings
  add column victvs_account_id uuid references accounts (id) on delete set null,
  -- { "IWCF": 60, "CIPS OR": 37.5, "CIPS CR": 60, "FIFA": 30 }
  add column victvs_defaults jsonb;

alter table user_settings drop constraint user_settings_theme_check;
alter table user_settings
  add constraint user_settings_theme_check
  check (theme in ('system', 'light', 'dark', 'slate', 'ocean', 'forest', 'mocha'));
