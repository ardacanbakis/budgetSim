-- A gold account can hold a mix: coins by the piece (çeyrek, yarım, tam,
-- Cumhuriyet, Ata, Reşat, Hamit, ikibuçuk, beşli, gremse) and gram, has,
-- 22/18/14 ayar gold by the gram. Each is priced at a dealer's buying price,
-- and the account counts what they're worth in grams of gram gold, on top of
-- whatever its ledger holds. See lib/domain/gold.ts.
-- Every statement is idempotent — the file can be re-run safely.

alter table accounts
  add column if not exists holdings jsonb;

comment on column accounts.holdings is
  'Gold accounts only: [{"type": "tam", "qty": 2}, {"type": "has", "qty": 50}, ...]. qty is pieces for coins, grams otherwise. Null = none.';
