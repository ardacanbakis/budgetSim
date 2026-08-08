# BudgetSim

Personal multi-currency budget app for a household living in Turkey and earning USD:
accounts in **TRY / USD / EUR / BTC / gold (grams)**, live rates, planned→completed
payment tracking, cross-currency transfers with real-rate capture, **VICTVS session**
income tracking with paste-from-email bulk import, recurring templates, house/car
**loan simulation & tracking**, and a 12–24 month cashflow **projector**.

Successor to [budgetSim](https://github.com/ardacanbakis/budgetSim) and
[finSim](https://github.com/ardacanbakis/finSim). The defining difference:
**server-authoritative data**. There is no offline-first write layer — Postgres is
the only source of truth and balances are always derived from completed
transactions, so every device shows identical numbers.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS 4
- Supabase: Postgres + row-level security + email/password auth
- TanStack Query (read cache only — never a write store)
- Recharts, Vitest, Playwright
- Rates: [Frankfurter](https://frankfurter.dev) (fiat, free) ·
  [CoinGecko](https://coingecko.com) (BTC, free) ·
  [CollectAPI](https://collectapi.com) (gram gold TRY + bank loan offers, optional key)

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project keys
pnpm dev
```

### Supabase setup (one time)

1. Create a project at supabase.com.
2. Run every file in `supabase/migrations/` (0001 → 0006, in order) in the SQL
   editor. **All migrations are idempotent** — if a run fails halfway or you're
   unsure what already ran, just run the file again; `already exists` can't
   happen.
3. Auth → Providers: enable **Email** (password sign-in). Disable "Confirm email"
   if you want instant sign-in.
4. Copy the project URL and anon key into `.env.local`.

### Deploying to Vercel

Set these in **Vercel → Project → Settings → Environment Variables**, then
**redeploy** (they are inlined at build time — adding them without a new
deployment has no effect, and the login page will say "Server database is not
configured"):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `COLLECT_API_KEY` (optional — live gram-gold rate, and current Turkish
  bank loan rates in the planner's Borrowing card)
- `COLLECT_API_LOAN_URL` (optional — override the loan-rate endpoint if your
  CollectAPI plan exposes it under a different path)
- `SUPABASE_SERVICE_ROLE_KEY` (optional — fx rate history)

### Demo mode

The login page has **“Try the demo — no sign-up”**: a fully seeded sandbox
(5-currency accounts, transactions, VICTVS sessions, a tracked car loan) stored
only in the browser's localStorage. No server or account needed.

## How the numbers stay consistent

- Balances are **never stored** — always `opening_balance + Σ completed
  transactions`, computed from the same server data on every device.
- Completing a transaction snapshots **all** FX rates onto it (`fx_snapshot`),
  so historical figures never drift when you switch the display currency.
- All devices read rates from one endpoint (`/api/rates`, 15-min shared cache).
- The display currency switcher is display-only; stored data never changes.

## Money & conventions

- Amounts: Postgres `numeric`; all TS arithmetic goes through integer minor
  units (`lib/domain/money.ts`) — no float drift. BTC 8dp, fiat/gold 2dp.
- Loan rates use the Turkish bank convention: **monthly** interest %.
- Recurring templates materialize planned transactions 12 months ahead on app
  open; templates with **auto-complete** complete due items with that day's
  rates (also on app open — no cron required).

## Testing

```bash
pnpm test                   # Vitest: money/FX, balances, recurrence, parser, loan math, projector
pnpm exec playwright test   # demo-mode screenshots at 390 / 768 / 1280 / 3440×1440
```
