-- 0023: a debt repaid through a card's installments.
--
-- A cash advance taken on a credit card is borrowed money, but it's repaid
-- through the card's statements as a big purchase's installments, not by
-- payments of its own. A debt linked to that purchase plans nothing itself:
-- what's left follows the installments as the card's statements pay them,
-- and the money borrowed stays out of income.
--
-- Deleting the purchase unlinks the debt. Every statement is idempotent:
-- re-running is safe.

alter table loans add column if not exists purchase_id uuid references purchases (id) on delete set null;
