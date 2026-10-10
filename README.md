# BudgetSim

Personal multi-currency budget app for a household living in Turkey and earning USD:
accounts in **TRY / USD / EUR / BTC / gold** (grams, or a mix of coins and gram
gold), live rates, planned→completed payment tracking, credit cards and their
**taksit** purchases, cross-currency transfers with real-rate capture, **VICTVS
session** income tracking with paste-from-email bulk import, recurring templates,
house/car **loan simulation & tracking**, and a 12–24 month cashflow **projector**.

Successor to [budgetSim](https://github.com/ardacanbakis/budgetSim) and
[finSim](https://github.com/ardacanbakis/finSim). The defining difference:
**server-authoritative data**. There is no offline-first write layer — Postgres is
the only source of truth and balances are always derived from completed
transactions, so every device shows identical numbers.

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind CSS 4. This Next
  version has breaking changes: read `node_modules/next/dist/docs/` before
  touching framework APIs (see `AGENTS.md`).
- Supabase: Postgres + row-level security + email/password auth
- TanStack Query (read cache only — never a write store)
- Recharts, Vitest, Playwright
- Rates, all free and keyless unless noted:
  - fiat: [Frankfurter](https://frankfurter.dev) (ECB), then Truncgil, then GenelPara
  - gold: Truncgil (gram, has, 22/18/14 ayar, and every coin from çeyrek to
    beşli), then GenelPara, then [CollectAPI](https://collectapi.com) (key)
  - BTC: [CoinGecko](https://coingecko.com)
  - loan rates: TCMB EVDS (free key) and CollectAPI (key), both optional

## Getting started

Needs **Node 22.12+** (or 20.19+): Vitest's bundler won't load on older versions.

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project keys, or skip for demo mode only
pnpm dev                     # http://localhost:3000
```

`.env.example` lists every variable the code reads, which are required, and
where to get each key.

### Supabase setup (one time)

1. Create a project at supabase.com.
2. Run every file in `supabase/migrations/` (**0001 → 0015**, in order) in the
   SQL editor. **All migrations are idempotent** — if a run fails halfway or
   you're unsure what already ran, just run the file again; `already exists`
   can't happen. A database that's behind shows "The database is behind this
   version of the app" when a save needs a newer file.
3. Auth → Providers: enable **Email** (password sign-in).
4. Auth → URL Configuration → **Site URL**: your deployed domain.
5. **Confirm email**: either turn it off for instant sign-in, or set up custom
   SMTP. The built-in sender is rate-limited.
6. Once your household's accounts exist, **turn off public sign-ups**. Anyone
   who finds the URL can otherwise create an account.
7. Copy the project URL and anon key into `.env.local`.

API "Max rows" can stay at its default: every list is read page by page until
it's complete, whatever that setting is. The free tier pauses a project after
about a week without activity; restore it from the dashboard.

### Deploying to Vercel

Set the variables from `.env.example` in **Vercel → Project → Settings →
Environment Variables**, then **redeploy**. `NEXT_PUBLIC_*` values are inlined
at build time: adding them without a new deployment has no effect, and the
login page will say "Server database is not configured".

- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Optional: `TCMB_EVDS_KEY` (loan-rate averages by type, free key from
  evds2.tcmb.gov.tr), `COLLECT_API_KEY` (per-bank loan offers and a third gold
  provider), `SUPABASE_SERVICE_ROLE_KEY` (fx rate history; nothing reads it yet)
- Overrides, only if a provider moves: `TRUNCGIL_URL`, `GENELPARA_GOLD_URL`,
  `GENELPARA_FX_URL`, `COLLECT_API_GOLD_URL`, `COLLECT_API_LOAN_URL`,
  `TCMB_EVDS_URL`, `TCMB_EVDS_SERIES`

Settings → Market data shows which provider actually served each number, and
every attempt that failed, so you can tell a moved endpoint from a rate limit
without reading server logs. `/api/loan-rates` returns `{"status":"ok"}` once
`COLLECT_API_KEY` works; a `404` in its message means the path moved.

### Demo mode

The welcome and login pages have **“Try the demo — no sign-up”**: a fully seeded sandbox
(5-currency accounts, transactions, a credit card with a taksit purchase, VICTVS
sessions, a tracked car loan) stored only in the browser's localStorage. No
server or account needed.

## How the numbers stay consistent

- Balances are **never stored** — always `opening_balance + Σ completed
  transactions`, computed from the same server data on every device.
- Completing a transaction snapshots **all** FX rates onto it (`fx_snapshot`),
  so historical figures never drift when you switch the display currency.
  Anything that freezes rates automatically (auto-complete, the monthly
  net-worth snapshot) waits for a live rate table, never the static fallback.
- All devices read rates from one endpoint (`/api/rates`, 15-min shared cache).
  A failed refresh keeps the last good table.
- The display currency switcher is display-only; stored data never changes.
- **Credit cards count when they're paid** (`lib/domain/cards.ts`). A payment
  into a card is the expense. What's charged to a card (taksit installments,
  recurring items billed to it) is a breakdown of what a payment covers, so it
  isn't counted again. A payment made in month M covers the card's charges
  dated before M, and they count as paid once it's made. A card owes its
  unmade payments plus any charges no payment covers yet; that's what comes off
  its limit and off net worth.
- **Gold** is valued at a dealer's buying price (alış). A gold account can hold
  a mix (`lib/domain/gold.ts`); it stays in gram gold, with each holding worth
  its quantity × its own price ÷ the gram price.

## Money & conventions

- Amounts: Postgres `numeric`; all TS arithmetic goes through integer minor
  units (`lib/domain/money.ts`) — no float drift. BTC 8dp, fiat/gold 2dp.
- Loan rates use the Turkish bank convention: **monthly** interest %.
- Recurring templates materialize planned transactions 12 months ahead on app
  open, moving forward from each template's latest row, so a deleted or moved
  occurrence stays the way you left it. A template that starts in the past
  asks whether those dates were already paid, wait to be confirmed, or are
  left out by starting from today. **Auto-complete** settles dates as they arrive, never a backlog
  from before the template existed. There is no cron: nothing happens until
  someone opens the app.

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test                    # Vitest: domain logic, and DemoRepo driven under Node
```

Playwright drives the demo mode, so it needs no Supabase project. It reuses a
server already on `:3000` (`pnpm dev`, or `pnpm build && pnpm start`), and
otherwise starts `pnpm start` itself, which needs a build first.

```bash
pnpm exec playwright test --grep-invert "renders at"   # the functional suite (~4 min)
pnpm exec playwright test -g recurring                 # just the recurring tests
pnpm exec playwright test -g "renders at"              # screenshots at 5 viewports
# PW_CHROMIUM_PATH=/path/to/chromium to use an existing Chromium
```

**CI** (`.github/workflows/ci.yml`) runs typecheck, lint, the unit tests and the
functional Playwright suite against a production build on every pull request
and every push to `main`.
