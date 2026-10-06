# Prompt for the next Claude Code session

Paste everything below the line into Claude Code, started in the repo root
after `git checkout claude/budget-simulator-multicurrency-7dBR2 && git pull`.

---

You're continuing work on BudgetSim, a personal multi-currency budget app for
a household in Turkey that earns USD. It's built with Next.js 16, Supabase and
TanStack Query, and has a localStorage demo mode.

**Read these first:**

- `docs/HANDOFF.md`: how the app works, what PR #30 changed, the setup
  checklist, and the audit findings with confidence marks.
- `AGENTS.md`: this Next.js version has breaking changes. Read the relevant
  guide in `node_modules/next/dist/docs/` before using any framework API.

**Branch:** `claude/budget-simulator-multicurrency-7dBR2`, open as **PR #30**.
Keep working on this branch unless I say otherwise. Commit in small,
single-purpose commits. Don't push or open new PRs without asking me.

## Ground rules

- **Run before every commit:**
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
- **For UI changes,** also run the relevant Playwright tests, e.g.
  `pnpm exec playwright test -g recurring`, with `pnpm dev` already running
  on :3000. If a test fails, check whether it also fails on `main` before
  blaming the change.
- **Test-first for data bugs.** Write a failing Vitest test, then fix.
  Domain logic goes in `lib/domain/__tests__/`. Repo-level behaviour can be
  tested by driving `DemoRepo` under Node (see the lifecycle-test item below).
- **Fix it in both repos.** Any behaviour change in `SupabaseRepo` must be
  mirrored in `DemoRepo`, and the reverse.
- **Schema changes:** new migration files only (`supabase/migrations/0015_…`
  onwards). They must be idempotent, like the existing ones (if-not-exists,
  drop-then-create guards). Never run SQL against my production project.
  Tell me exactly which file to paste into the Supabase SQL editor.
  **Propose any migration to me before writing it.**
- **Strings:** every user-facing string goes in `lib/i18n/dictionaries.ts`,
  in both `en` and `tr`. `tr` is type-checked against `en`.
- **Style:** match the surrounding code's style and comment density. Use
  device-local prefs (`lib/prefs.ts`, `lib/ui/*`) for view settings, and
  `user_settings` for things that should sync.

## Work, in this order

Ask me before starting anything marked **(ask)**.

1. **Ledger pagination.** `SupabaseRepo.listTransactions` is one request
   capped by Supabase "Max rows" (default 1000). Add a shared paginated
   select helper (`.range()` in pages of 1000 until a short page comes back)
   and use it for every `list*` method.
   - Add a guard that fails loudly if an export hits a cap.
   - Then tell me whether reading balances from the `account_balances` view
     is worth it.
2. **Backfill choice for templates.** In the template form
   (`app/(app)/recurring/page.tsx`), when `startDate` is before today, show
   "N past items since <date>" and three choices:
   - *Already paid*: create the past rows as legacy completed rows. Mirror
     how `lib/domain/purchases.ts` treats past months.
   - *Leave to confirm*: today's behaviour.
   - *Start from today*.

   Implement it in `materialize` and in both repos, with tests. This stops a
   newly entered running loan from debiting a year of installments.
3. **Template edits reconcile future rows.** On `updateTemplate` (both
   repos):
   - delete this template's *planned* rows dated today or later, plus any
     after a shortened `endDate`
   - then re-materialize
   - in the edit modal, show "This will update N upcoming items"

   Start with a `DemoRepo` lifecycle test that reproduces the doubled
   months: edit amount, start and end, then assert exactly one row per month
   at the new amount.
4. **Stale-rate guard.**
   - Skip `autoCompleteDue` in `components/shell.tsx` while the rate table is
     stale, and retry when fresh rates arrive.
   - Make `useRates` (`lib/data/queries.ts`) throw on failure so React Query
     keeps the last good table. Use the fallback only as `placeholderData`.
   - Factor out one `isStaleTable()` helper; the logic is currently
     copy-pasted in three places.
   - Add `.eq("status", "planned")` to the auto-complete update.
5. **Visible errors.** Add a `MutationCache({ onError })` toast in
   `app/providers.tsx`, mapping common Postgres/PostgREST codes to plain
   messages:
   - 23503 FK restrict
   - 23514 check violation
   - 42703 / PGRST204 "database needs a migration"
   - expired JWT

   Run materialize and auto-complete in separate try blocks in the
   Bootstrapper, and show a small "Recurring sync failed, retry" banner.
6. **Auth cache churn.** In `lib/data/provider.tsx`, only rebuild the repo
   and clear the query cache when the user id actually changes. Ignore
   `TOKEN_REFRESHED` and a `SIGNED_IN` for the same user. Use
   `signOut({ scope: "local" })`.
7. **(ask) Occurrence identity and "skip this month".** Add an
   `occurrence_date` column, with the unique index moved onto it, plus a
   skipped state, so that moved or deleted occurrences stop coming back.
   Needs migration 0015. Propose the design first.
8. **(ask) Atomic writes and backup v2.**
   - Postgres functions called via `rpc()` for: mark VICTVS paid / undo,
     create loan, purchase reflect, card payment, delete-all, restore.
   - Backup v2 that includes every field, plans, savings plans and settings.
   - An export → import → export round-trip test.
9. **Finish the audit** for the areas not yet covered: loans / planner /
   projector / savings finance math; VICTVS / reports / dashboard; shell /
   i18n key parity / accessibility / PWA. Report findings to me with
   file:line evidence before fixing anything big.
10. **Process.**
    - Update README: migrations 0001→0014, `.env.example`, the Supabase
      dashboard settings from HANDOFF §3, and e2e instructions.
    - Add a GitHub Actions workflow on PRs: typecheck, lint, vitest, and
      Playwright `--grep-invert "renders at"` against `pnpm build && pnpm start`.

Small extras, if they come up naturally:

- The ticker's 24h change: `prevUsdPer.USD = 1`, and gold's change from
  Truncgil.
- The Recurring screen should honour its Settings → Views shape (rows/table).
- Delete template should be a proper 3-choice dialog instead of OK/Cancel.

Start by reading the two docs and running the three checks to confirm a green
baseline. Then give me a short plan for items 1–3 before writing code.
