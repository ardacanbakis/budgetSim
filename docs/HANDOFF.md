# BudgetSim: where things stand (2026-10-05)

A handoff for continuing in a local Claude Code session. It covers how the app
works, what this branch changed, what you need to configure (keys, env vars,
dashboard settings), what the audit found, and how to improve the process.

- Branch: `claude/budget-simulator-multicurrency-7dBR2` → **PR #30**
- Base: `main` @ `33d07af` (PR #29, "Loans: five repayment shapes…")
- Checks on this branch: `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` 291/291 ✓ ·
  Playwright functional suite ✓ (the 5-viewport screenshot loop was not run)

---

## 1. How the app works

**Stack.** Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind 4,
Supabase (Postgres + RLS + email/password auth), TanStack Query as a read cache
only, Recharts, Vitest, Playwright. `AGENTS.md` warns that this Next version has
breaking changes: read `node_modules/next/dist/docs/` before touching
framework APIs. For example, `middleware.ts` is now `proxy.ts`.

**Data flow.**

```
UI page ──useQuery──▶ lib/data/queries.ts ──▶ Repo (lib/data/repo.ts)
   │                                            ├─ SupabaseRepo  (real data, RLS per user_id)
   └─useAppMutation──▶ repo.write() ──▶ invalidate query keys
                                                └─ DemoRepo      (one localStorage blob, "Try the demo")
```

- **Server-authoritative.** Postgres is the only source of truth, and there is
  no offline write layer. Every list method is a full-table `select *` scoped
  by RLS.
- **Balances are never stored.** They are recomputed in the browser as
  `opening_balance + Σ completed, non-legacy transactions`
  (`lib/domain/balances.ts`).
- **Completing a transaction freezes all FX rates onto it** (`fx_snapshot`),
  so history does not drift when the display currency changes.
- **App-open bootstrap** (`Bootstrapper` in `components/shell.tsx`) runs once
  per page load, after rates arrive:
  1. seed default categories
  2. materialize recurring templates 12 months ahead
     (`lib/domain/materialize.ts`), including past dates since `startDate`
  3. auto-complete due items of auto-complete templates, using today's rates
  4. take the monthly net-worth snapshot (skipped if rates are stale)

  There is no cron. Nothing happens unless someone opens the app.
- **Rates.** Every device calls `/api/rates`, which walks provider chains:
  - FX: Frankfurter → Truncgil → GenelPara
  - gold: Truncgil → GenelPara → CollectAPI
  - BTC: CoinGecko

  Provider responses are cached for 15 minutes in Next's data cache. If
  everything fails, the app falls back to hard-coded rates and marks them
  "stale" (`lib/rates/fallback.ts`). `/api/loan-rates` tries TCMB EVDS first,
  then CollectAPI.
- **Domain logic** is pure and tested in `lib/domain/*`: money in integer
  minor units, recurrence, loans (5 schedule shapes + KKDF/BSMV), planner,
  projector, savings finance, parsers.
- **Preferences.** Some are synced in `user_settings` (theme, date format,
  ticker…). Others stay on the device in localStorage (UI style, density,
  per-screen view shape, rate providers, and now the label colours).

---

## 2. What this branch changed (PR #30)

**Recurring: status labels, filters, adjustable colours** (what you asked for)

- Each recurring item derives a status from its schedule and its ledger rows
  (`lib/domain/templateStatus.ts`, 9 unit tests):
  - **Completed**: the schedule has ended and every item is settled.
  - **To confirm**: items are due but not completed. Shown as "N to confirm",
    also on active items with overdue entries.
  - **Not started**: the first date is still ahead.
  - **Active**: everything else.
- Cards show a progress line ("3 of 7 done · Next 26 Oct") with a thin bar
  when there is an end date. Finished cards are dimmed and lose the
  auto-complete badge.
- Status filter with counts (All / Active / Not started / To confirm /
  Completed) and an Income / Expense filter. Both are remembered per device.
  Under "All", items to confirm sort first and completed ones last.
- **Label colours** (green, teal, blue, violet, yellow, amber, red, grey) for
  Completed / Not started / To confirm. You can change them from the
  "Label colours" button on the Recurring screen, or in Settings → Views &
  layout. They are stored per device, so no migration is needed. If you want
  them synced across devices, see §5.
- e2e test: `recurring: finished items are labelled, filterable, and the label colour is adjustable`.

**Bugs fixed while verifying**

- **Stale forms.** The Recurring, Account and Goal forms kept the previous
  entry's values (name, amount, dates, the auto-complete tick) when reopened
  after a save or cancel. A second new item could silently inherit
  auto-complete from the first. Fixed by resetting the init guard on close.
- **Demo mode showed stale data after auto-complete or edits.** DemoRepo
  handed its own objects to the query cache, and in-place updates made the
  refetch look unchanged. Reads now return copies, like a network response.
  This was demo-only; Supabase mode was not affected.
- **Two flaky e2e tests** ("portfolio … hiding accounts", "cards … retired")
  counted rows before the page rendered, and failed intermittently on `main`
  too. They now wait for the first row.
- Added **`.env.example`** (the README referenced it, but it didn't exist) and
  `!.env.example` in `.gitignore`.

---

## 3. What you need to configure

### Environment variables (full list is in `.env.example`)

| Variable | Needed? | Where to get it | Without it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Supabase → Project Settings → API | Only demo mode works |
| `TCMB_EVDS_KEY` | Optional, free | evds2.tcmb.gov.tr → profile → API key | No free loan-rate averages in the loan picker |
| `COLLECT_API_KEY` | Optional, paid/metered | collectapi.com (bare token, no `apikey ` prefix) | No per-bank loan offers; gold still works keyless |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only | Supabase → API → service_role | Nothing visible: the `fx_rates` history it writes is never read |
| `TRUNCGIL_URL`, `GENELPARA_*`, `COLLECT_API_*_URL`, `TCMB_EVDS_URL/SERIES` | Overrides only | — | Defaults are used |

These rate providers need no key: Frankfurter (ECB), CoinGecko, Truncgil, and
GenelPara.

On Vercel, `NEXT_PUBLIC_*` values are inlined at build time, so you must
**redeploy** after changing them.

### Supabase dashboard settings (do these even if the app "works")

1. **Run migrations 0001 → 0014.** The README still says 0001 → 0006, which
   is wrong. Materialization needs 0009 (unique occurrence index). Creating
   accounts needs 0012. Loans need 0014. All files are idempotent, so it's
   safe to re-run them if you aren't sure what ran.
2. **Raise API "Max rows".** Go to Project Settings → API (Data API) → Max
   rows (default 1000). The app downloads the entire ledger in one request.
   Past 1000 rows, the *oldest* history is silently dropped, and every
   balance and backup goes wrong. Set it to e.g. 50000 until pagination lands
   (§4, item 1).
3. **Turn off public sign-ups** once your household accounts exist (Auth →
   Providers / Sign-in). Anyone who finds the Vercel URL can sign up today.
4. **Auth → URL Configuration → Site URL** = your Vercel domain.
5. **Confirm email.** Either turn it off, or configure custom SMTP. The
   built-in sender is rate-limited.
6. **Free tier pauses after about a week of inactivity.** Restore the project
   from the dashboard if that happens.

---

## 4. What the audit found

Six read-only auditors covered the codebase. Three finished before this
handoff:

- data/auth
- market data
- ledger/recurring

Not yet audited (the next session should do these):

- loans/planner/savings finance
- VICTVS/reports/dashboard
- shell/i18n/tooling

Confidence key:

- ✅ **confirmed**: I read the code, or reproduced it.
- 🔎 **reported**: an auditor found it with file:line evidence, and some
  reproduced it with a scratch test, but it was not independently re-checked.

### High priority: data correctness

1. ✅ **Ledger capped at 1000 rows.** `listTransactions` is a single request
   with `.limit(10000)` (`lib/data/supabaseRepo.ts`), but PostgREST caps it at
   Max rows. Rows are sorted newest first, so old history drops off silently.
   This breaks balances, net worth, card debt and backups.
   **Fix:** page with `.range()` in a shared helper. Longer term, read
   balances from the existing `account_balances` view.
2. ✅ **Adding a running loan or bill with a past start date and auto-complete
   on posts every past installment as a real payment** on the next app open.
   For example, "Tansu Akbank 100k Kredi" started a year ago would deduct
   about 12 installments from the account. Purchases already handle this case
   by creating past rows as legacy; templates don't.
   **Fix:** when `startDate < today`, the template form asks: *already paid
   (record as legacy)* / *leave as to-confirm* / *start from today*.
3. ✅ **Editing a template doesn't touch its already-created planned rows.**
   `updateTemplate` only updates the template row. Amount and account changes
   don't reach upcoming items. Changing the start date or frequency adds a
   second set of rows. Shortening the end date leaves rows after it, and they
   still auto-complete. 🔎 An auditor reproduced the doubled months with a
   scratch test.
   **Fix:** on update, delete future planned rows and re-materialize, and say
   "This will update N upcoming items".
4. 🔎 **Moving or deleting one recurring occurrence brings it back** on the
   next app open, because occurrence identity is `template + due_date`. You
   can't "skip a month"; moving an installment two days creates a duplicate.
   **Fix:** add an `occurrence_date` column (unique per template) separate
   from the editable `due_date`, plus a "skipped" state. This needs
   migration 0015.
5. ✅ **Stale fallback rates get frozen into history.** If `/api/rates` fails
   at app open, auto-complete still runs with the hard-coded mid-2026 rates
   (TRY 41.8, gold $78.5/g). Only the net-worth snapshot checks for
   staleness. `useRates` also swallows errors, so one failed refetch replaces
   good live rates with the fallback.
   **Fix:** skip auto-complete while rates are stale, and make `useRates`
   throw so React Query keeps the last good data.
6. ✅🔎 **Restore is destructive and not atomic.** `importAll` deletes
   everything first, then re-inserts across about 15 requests. A failure
   halfway leaves the database partly empty, and the error says "invalid
   file". Backups also drop fields: loan schedule kind and KKDF/BSMV, card
   limits, VICTVS session numbers, plans, savings plans, and settings. A loan
   restored from backup becomes a plain annuity.
   **Fix:** use one Postgres function (single transaction), backup v2 with
   all fields, and a round-trip test.
7. 🔎 **Multi-step writes aren't transactional.** VICTVS mark-paid (4
   requests), undo payout, loan creation, purchase "reflect", and card
   payment (transfer + N installment completions). A dropped connection
   leaves half a record. For example, Mark paid with amount 0 creates an
   orphan payout, because the input allows 0 but the database rejects it.
   **Fix:** `rpc()` Postgres functions.

### Medium priority

- ✅ **Failed saves are invisible.** There's no `onError` anywhere, so a
  database error (missing migration, foreign-key restrict, expired session)
  looks like nothing happened.
  **Fix:** a `MutationCache({ onError })` toast in `app/providers.tsx`.
- ✅ **Every auth event clears the whole query cache**
  (`provider.tsx` `onAuthStateChange`). That includes token refreshes and
  possibly tab refocus, which can wipe half-filled forms.
  **Fix:** only clear when the user id changes.
- ✅ **Auto-complete re-completes items you reopened.** Its update also
  filters only by id, with no `status = 'planned'` guard, so two devices can
  overwrite each other's `completed_at` and `fx_snapshot`.
- 🔎 **Future-dated transfers never settle.** Completing one from the ledger
  completes only the outgoing leg.
- 🔎 **Overdue planned items are easy to miss.** They drop out of
  safe-to-spend and the projection.
- 🔎 **The projector double-counts** an occurrence that was paid early or
  moved.
- 🔎 **Rate providers are a per-device setting.** Phone and laptop can value
  accounts differently and freeze different rates.
- 🔎 **The ticker's 24h change only works for EUR/TRY.** `prevUsdPer` lacks
  `USD` and gold. It's a one-line fix.
- 🔎 **`/api/loan-rates` is public.** It passes the caller's parameters
  through to the metered CollectAPI, so anyone can burn the key.
- 🔎 **`fx_rates` history is written unreliably and never read.** The service
  role key currently buys nothing.
- 🔎 **Changing an account's currency reinterprets all its history**, and
  deleting an account leaves orphan transfer legs.
- 🔎 **There is no password reset**, and sign-out logs out every device
  (`signOut()` defaults to global scope).
- 🔎 **Backdated transfers and legacy imports use today's rates**, not that
  day's.

### Low priority

- 🔎 The CPI table (`lib/data/inflation.ts`) ends at 2026-06, so real-terms
  reports clamp later months.
- 🔎 The fallback rates are aging. Fallback gold is about 20% below current.
- ✅ Delete template: pressing "Cancel" on the "also delete planned items?"
  confirm still deletes the template, and keeps its rows unlinked.
- ✅ Settings → Views offers a rows/table shape for **Recurring**, but the
  Recurring page ignores it.
- 🔎 Loans tracked as plain recurring items don't appear in the debt overview
  (debt-free date, avalanche).

### How the new status labels interact with these

The labels read the ledger as-is, so they inherit issues 1, 3 and 4. Past
1000 rows, old completed items stop being counted in "N of M done". Orphan
rows left by a shortened end date keep an item "Active". Each fix above makes
the labels more accurate without changing them.

---

## 5. Process improvements

- **README:**
  - Migrations 0001 → 0014.
  - Point to `.env.example`.
  - Add the Supabase settings from §3.
  - Add the e2e instructions (below).
- **Track migrations:**
  - Adopt the Supabase CLI (`supabase/config.toml`, `supabase db push`) so
    production's applied migrations are recorded.
  - Add a `schema_version` check that shows a banner when the database is
    behind. Today a missing migration only shows up as a silently failing
    write.
- **CI:** there is no `.github/` today. Add a workflow on every PR:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - the Playwright demo suite (`--grep-invert "renders at"` keeps it fast)
- **Repo contract tests:** one Vitest suite run against `DemoRepo`. It works
  under Node, and auditors did exactly that with scratch tests. Later, run it
  against `SupabaseRepo` on `supabase start` in CI. Cover:
  - template edit
  - move/delete occurrence
  - backfill
  - export → import → export equality
  - mark paid / undo
- **Move materialize + auto-complete server-side** with Supabase Cron
  (pg_cron) shortly after midnight Europe/Istanbul. That gives you:
  - three fewer full-ledger downloads per app open
  - items settle on their date even if nobody opens the app
  - a natural place for the stale-rate guard
- **Backups:** add a nightly `supabase db dump --data-only` via GitHub Action.
  The free tier has no downloadable backups, so the in-app export (which is
  lossy, see item 6) is your only safety net.
- **Label colours across devices:** add a `label_colors jsonb` column to
  `user_settings` (migration) if you want them synced.
  `lib/ui/labelColors.ts` is the single place to change.

---

## 6. Running it locally

```bash
pnpm install
cp .env.example .env.local        # fill in Supabase URL + anon key (or skip → demo mode only)
pnpm dev                          # http://localhost:3000 → "Try the demo" needs no account
pnpm typecheck && pnpm lint && pnpm test
```

Playwright e2e: `playwright.config.ts` reuses a server already on `:3000`,
otherwise it runs `pnpm start` (which needs `pnpm build` first).

```bash
pnpm dev &                                           # or: pnpm build && pnpm start
pnpm exec playwright test --grep-invert "renders at" # functional tests (~5 min)
pnpm exec playwright test -g recurring               # just the recurring ones
# PW_CHROMIUM_PATH=/path/to/chromium to use an existing Chromium
```

Auto-complete in the browser waits for `/api/rates`. If the providers are
slow or unreachable, expect a delay of a few seconds after load.

Key files:

| Area | Files |
|---|---|
| Data layer | `lib/data/{repo,supabaseRepo,demoRepo,queries,provider}.ts(x)` |
| Recurring | `app/(app)/recurring/page.tsx`, `lib/domain/{recurrence,materialize,templateStatus}.ts` |
| Bootstrap on open | `components/shell.tsx` (`Bootstrapper`) |
| Rates | `app/api/rates/route.ts`, `lib/rates/*`, `lib/data/queries.ts` (`useRates`) |
| Schema | `supabase/migrations/0001…0014` |
| Strings | `lib/i18n/dictionaries.ts` (`en` + `tr`; `tr` is type-checked against `en`) |
