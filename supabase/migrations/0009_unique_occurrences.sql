-- Wave 11: prevent duplicate recurring occurrences at the database level.
-- Every statement is idempotent — the file can be re-run safely.

-- Clean any duplicates that already slipped in (keep the oldest row of each
-- template+date group; only planned rows are safe to drop automatically).
delete from transactions t
using transactions keep
where t.recurring_template_id is not null
  and t.recurring_template_id = keep.recurring_template_id
  and t.due_date = keep.due_date
  and t.user_id = keep.user_id
  and t.status = 'planned'
  and keep.created_at < t.created_at;

-- One transaction per template occurrence. Postgres treats NULLs as distinct,
-- so manual transactions (recurring_template_id null) are unaffected. A full
-- (non-partial) index so ON CONFLICT ... DO NOTHING can infer it.
create unique index if not exists transactions_template_due_ux
  on transactions (user_id, recurring_template_id, due_date);
