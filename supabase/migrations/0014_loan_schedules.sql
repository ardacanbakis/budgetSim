-- Loans grow a repayment shape and the two levies Turkish consumer credit
-- carries. Until now every loan was an untaxed annuity, which is one product
-- out of several people actually sign.
--
-- KKDF and BSMV ride on the interest portion of each payment, which is why the
-- installment a bank quotes is always higher than a plain annuity calculator
-- says. They are columns rather than constants because commercial loans pay
-- BSMV but not KKDF, and because the statutory rates move.
--
-- custom_instalments holds the payments for a schedule that follows no formula
-- worth reverse-engineering — you have the paper, so you type what it says.
--
-- Existing rows default to an untaxed annuity, which is exactly what they
-- already were, so nobody's tracked loan changes shape.
--
-- Every statement is idempotent: the file can be re-run safely.

alter table loans add column if not exists schedule_kind text not null default 'annuity';
alter table loans add column if not exists kkdf_pct numeric(6, 3) not null default 0;
alter table loans add column if not exists bsmv_pct numeric(6, 3) not null default 0;
alter table loans add column if not exists custom_instalments jsonb;

alter table loans drop constraint if exists loans_schedule_kind_check;
alter table loans
  add constraint loans_schedule_kind_check
  check (schedule_kind in ('annuity', 'equalPrincipal', 'interestOnly', 'zeroInterest', 'custom'));

-- A loan whose installments vary cannot be one repeating template, so its
-- payments are posted as dated rows tagged with the loan. This index is what
-- makes deleting or re-planning such a loan cheap.
create index if not exists transactions_loan_idx on transactions (user_id, loan_id) where loan_id is not null;
