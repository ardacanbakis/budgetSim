-- 0026: how much a card is typically spent on beyond its installments.
--
-- A big purchase writes its own rows, so the app can read every taksit. It
-- cannot read the rest — the shopping, the fuel, the dinners — so a month
-- ahead holding nothing but taksit reads as a cheap month, and a plan built
-- on those months is optimistic by however much you actually spend.
--
-- The figure itself is measured from the statements already paid and is not
-- stored. What is stored is the choice: whether the plan carries it, how
-- many statements the measurement reads, and any figure set by hand for a
-- card (0 meaning "never for this one").
--
-- A database where this hasn't run yet simply carries nothing, which is
-- also the default where it has. Every statement is idempotent: re-running
-- is safe.

alter table user_settings add column if not exists card_spend jsonb;
