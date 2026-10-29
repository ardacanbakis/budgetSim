"use client";

import Link from "next/link";
import { Fragment, ReactNode, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PendingConversions } from "@/components/convertedIncome";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { OptionalCard } from "@/components/dashboardCards";
import { GoalsCard } from "@/components/goalsCard";
import { GoldLensCard } from "@/components/goldLens";
import { visibleNav } from "@/components/shell.nav";
import { Figure, Skeleton } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { KEYS, useAccounts, useBudgets, useCategories, useRates, useTransactions, useUserSettings, useVictvsSessions } from "@/lib/data/queries";
import { Account } from "@/lib/data/types";
import { budgetStatuses } from "@/lib/domain/budgets";
import { chargeAmount } from "@/lib/domain/cards";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { UsdPerMap } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { cardStandings, findDueCardPayments } from "@/lib/domain/purchases";
import { buildTickerItems, formatTickerValue } from "@/lib/domain/ticker";
import { useI18n } from "@/lib/i18n";
import { isStaleTable } from "@/lib/rates/fallback";
import { useDashboardData } from "@/lib/useDashboardData";
import { ComingUpItem, comingUp } from "@/lib/ui/pocket/attention";
import { groupMonthsDays } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import {
  accountTiles,
  AMOUNT_SLOT,
  COMING_UP_ROWS,
  visibleComingUp,
  comingUpTotal,
  HOME_SECTIONS_KEY,
  parseSections,
  RECENT_DAYS,
  recentRows,
  SECTION_CARD,
  SectionId,
  shownSections,
  topBudgets,
} from "@/lib/ui/pocket/homeSections";
import { isHeroFigure, POCKET_KEYS, usePocketFlag, usePocketPref } from "@/lib/ui/pocket/prefs";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";
import { PocketDayList, PocketTxRow, TxLookup, useDueLabel, useTxLookup } from "./dayList";
import { HomeSectionsEditor } from "./homeEditor";
import { Icon } from "./icons";
import { Approx, Avatar, FitFigure, Money, PocketPage, Section } from "./kit";
import { AmountPhrase, PaceBar } from "./paceBar";
import { PocketSheet } from "./sheet";
import { usePocketTxSheet } from "./txActions";

/**
 * Pocket's Home (/): what you have, what's due, and where the month stands,
 * before the first scroll on a 390×844 phone.
 *
 * 1. The hero: the lead figure chosen in Settings (net worth, or safe to
 *    spend), what the cards are owed, the other figure and this month's in
 *    and out, and the rates it was all priced at. Its eye blurs every figure.
 * 2. Then the sections in the order kept on the device (lib/ui/pocket/
 *    homeSections.ts): Coming up (overdue first, one action per row),
 *    Accounts, Budgets, Recent activity; Monthly flow, Goals and Gold when
 *    switched on, and the dashboards' optional cards (This month, Card
 *    statements, the trend, Debts, Fixed costs, the VICTVS outlook) as
 *    sections. The header's sliders open the Customise Home sheet
 *    (homeEditor.tsx), which edits them in place.
 *
 * Same numbers as Classic: useDashboardData for the hero and the accounts,
 * budgetStatuses for budgets, the list kit's comingUp/statementFigure for
 * what's due, and the same writes (useTxActions, CardPaymentModal).
 * "Coming up" and "Recent activity" don't wait for rates; the ✓ does.
 */

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

const headStyle = {
  fontWeight: "var(--ui-head-weight)" as unknown as number,
  letterSpacing: "var(--ui-head-tracking)",
  textTransform: "var(--ui-head-transform)" as React.CSSProperties["textTransform"],
};

const MASK = "•••••";

const unitOf = (c: Currency) => (c === "XAU_G" ? "g" : c);

export function PocketHome() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const victvs = useVictvsSessions();
  const budgets = useBudgets();
  const settings = useUserSettings();
  const derived = useDashboardData(displayCurrency);
  const lookup = useTxLookup();
  const txSheet = usePocketTxSheet();

  const [hero] = usePocketPref(POCKET_KEYS.hero, "net", isHeroFigure);
  const [hideAmounts] = usePocketFlag(POCKET_KEYS.hideAmounts);
  const [stored] = usePocketPref(HOME_SECTIONS_KEY, "");
  const [range] = usePocketPref(POCKET_KEYS.upcomingRange, "7", (v) => v === "7" || v === "30");
  const [paying, setPaying] = useState<Account | null>(null);
  const [customising, setCustomising] = useState(false);

  const days = Number(range);
  const today = lookup.today;
  const { book } = lookup;
  const usdPer = rates.data?.usdPer;
  const navOrder = settings.data?.navOrder;

  const sections = useMemo(() => shownSections(parseSections(stored)), [stored]);

  // what's due, from the ledger alone: it shows before rates arrive
  const due = useMemo(() => {
    if (!accounts.data || !transactions.data) return null;
    const unpaid = (victvs.data ?? []).filter((s) => s.status === "unpaid");
    // a page hidden from the menus stays out of Home too
    const victvsShown = visibleNav(navOrder).some((i) => i.href === "/victvs");
    return comingUp({
      transactions: transactions.data,
      accounts: accounts.data,
      book,
      today,
      days,
      duePayments: findDueCardPayments(accounts.data, book, today),
      standings: cardStandings(accounts.data, book, today),
      unpaidVictvsUsd: sumAmounts("USD", unpaid.map((s) => s.amount)),
      unpaidVictvsCount: victvsShown ? unpaid.length : 0,
    });
  }, [accounts.data, transactions.data, victvs.data, navOrder, book, today, days]);

  const recent = useMemo(() => {
    if (!transactions.data) return [];
    const rows = recentRows(transactions.data, book, lookup.accountsById, today);
    return groupMonthsDays(rows, { accountsById: lookup.accountsById, usdPer, display: displayCurrency, book });
  }, [transactions.data, book, lookup.accountsById, today, usdPer, displayCurrency]);

  const budgetRows = useMemo(() => {
    if (!budgets.data || !transactions.data || !accounts.data || !usdPer) return null;
    return budgetStatuses({
      budgets: budgets.data,
      transactions: transactions.data,
      accounts: accounts.data,
      usdPer,
      month: today.slice(0, 7),
    });
  }, [budgets.data, transactions.data, accounts.data, usdPer, today]);

  const lead = derived ? (hero === "safe" ? derived.safe.total : derived.netWorth.total) : null;
  const leadName = t(hero === "safe" ? "dashboard.safeToSpend" : "dashboard.netWorth");
  const condensed =
    lead != null ? `${leadName} ${hideAmounts ? MASK : formatSigned(lead, displayCurrency, locale)}` : undefined;

  // what a payment recorded now would cover, as the Cards page suggests it
  const coversFor = (cardId: string) => book.wouldCover(cardId, today.slice(0, 7));
  const covers = paying ? coversFor(paying.id) : [];

  const loading = lookup.loading;

  // memoised: the header is set again whenever its action changes
  const action = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setCustomising(true)}
        aria-label={t("pocket.home.customise")}
        aria-haspopup="dialog"
        className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
      >
        <Icon name="adjust" size={22} />
      </button>
    ),
    [t]
  );

  const render = (id: SectionId): ReactNode => {
    switch (id) {
      case "comingUp":
        return loading || !due ? (
          <SkeletonSection title={t("pocket.home.comingUp")} />
        ) : (
          <ComingUp
            items={due}
            days={days}
            lookup={lookup}
            onRowTap={txSheet.open}
            onComplete={txSheet.complete}
            onPay={setPaying}
          />
        );
      case "accounts":
        if (loading) return <SkeletonSection title={t("dashboard.accounts")} />;
        return <AccountsStrip derived={derived} usdPer={usdPer} />;
      case "budgets":
        if (!budgetRows || budgetRows.length === 0) return null;
        return <Budgets rows={budgetRows} today={today} />;
      case "recent":
        if (loading) return <SkeletonSection title={t("pocket.home.recent")} />;
        return (
          <Section title={t("pocket.home.recent")} flush>
            {recent.length > 0 ? (
              <PocketDayList months={recent} inCard stickyHeaders={false} onRowTap={txSheet.open} onComplete={txSheet.complete} />
            ) : (
              <p className="flex min-h-12 items-center px-4 text-sm text-zinc-500 dark:text-zinc-400">
                {t("pocket.home.nothingRecent", { count: RECENT_DAYS })}
              </p>
            )}
            <FooterLink href="/transactions">{t("pocket.home.seeAllActivity")}</FooterLink>
          </Section>
        );
      case "flow":
        return derived ? <FlowChart flow={derived.flow} /> : null;
      case "goals":
        return <GoalsCard />;
      case "gold":
        return <GoldLensCard />;
      case "debt":
      case "victvsOutlook":
        // a page hidden from the menus takes its section with it
        if (!visibleNav(navOrder).some((i) => i.href === (id === "debt" ? "/accounts" : "/victvs"))) return null;
        return derived ? <OptionalCard id={SECTION_CARD[id]} d={derived} frame="section" /> : null;
      case "thisMonth":
      case "statements":
      case "trend":
      case "commitments":
        return derived ? <OptionalCard id={SECTION_CARD[id]} d={derived} frame="section" /> : null;
    }
  };

  return (
    <PocketPage title={t("nav.dashboard")} condensed={condensed} action={action}>
      <Hero lead={lead} hero={hero === "safe" ? "safe" : "net"} derived={derived} loading={loading} />
      <PendingConversions />
      {sections.map((id) => (
        <Fragment key={id}>{render(id)}</Fragment>
      ))}
      {txSheet.element}
      {/* over Home, so each change shows behind it as it's made */}
      <PocketSheet open={customising} onClose={() => setCustomising(false)} title={t("pocket.home.customise")}>
        <HomeSectionsEditor />
      </PocketSheet>
      <CardPaymentModal
        card={paying}
        suggested={Math.max(0, covers.reduce((sum, c) => sum + chargeAmount(c), 0))}
        covers={covers}
        onClose={() => setPaying(null)}
      />
    </PocketPage>
  );
}

type Derived = ReturnType<typeof useDashboardData>;

/* ------------------------------------------------------------------ hero */

function Hero({
  lead,
  hero,
  derived,
  loading,
}: {
  lead: number | null;
  hero: "net" | "safe";
  derived: Derived;
  loading: boolean;
}) {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const [hideAmounts, setHideAmounts] = usePocketFlag(POCKET_KEYS.hideAmounts);
  const [sheet, setSheet] = useState<"safe" | "rates" | null>(null);

  const label = `${t(hero === "safe" ? "dashboard.safeToSpend" : "dashboard.netWorth")} · ${unitOf(displayCurrency)}`;
  const month = derived?.flow.at(-1);
  const leadTone = lead == null ? undefined : hero === "safe" ? (lead < 0 ? "neg" : "pos") : lead < 0 ? "neg" : undefined;

  const statLabel = "block text-xs text-zinc-500 dark:text-zinc-400";
  const statCell = "flex min-h-[64px] min-w-0 flex-col justify-center gap-0.5 px-4 py-2 text-left active:bg-[var(--edge-soft)]";

  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm"
    >
      <div className="pl-4 pr-1 pt-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]" style={headStyle}>
            {label}
          </span>
          <button
            type="button"
            aria-pressed={hideAmounts}
            aria-label={t("pocket.hideAmounts")}
            onClick={() => setHideAmounts(!hideAmounts)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge-soft)] dark:text-zinc-400"
          >
            <Icon name={hideAmounts ? "eyeOff" : "eye"} size={20} />
          </button>
        </div>
        <div className="pr-3">
          {derived && lead != null ? (
            <>
              <FitFigure tone={leadTone}>{formatSigned(lead, displayCurrency, locale)}</FitFigure>
              {derived.cardsOwed > 0.005 ? (
                <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  <AmountPhrase
                    text={t("pocket.home.owedOnCards", { amount: AMOUNT_SLOT })}
                    amount={formatSigned(derived.cardsOwed, displayCurrency, locale, "out")}
                  />
                </p>
              ) : null}
              {derived.netWorth.skippedAccountIds.length > 0 ? (
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{t("dashboard.skippedAccounts")}</p>
              ) : null}
            </>
          ) : (
            <div className="pb-1 pt-2">
              <div aria-hidden className="h-9 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              {!loading && !rates.data ? (
                <p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {t("pocket.lists.waitingRates")}
                </p>
              ) : (
                <Skeleton rows={1} className="mt-2 w-40" />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 divide-x divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
        {derived ? (
          hero === "net" ? (
            <button type="button" aria-haspopup="dialog" onClick={() => setSheet("safe")} className={statCell}>
              <span className={statLabel}>{t("dashboard.safeToSpend")}</span>
              <Figure size="md" tone={derived.safe.total < 0 ? "neg" : "pos"} className="block truncate">
                <Money amount={derived.safe.total} currency={displayCurrency} />
              </Figure>
            </button>
          ) : (
            <Link href="/accounts" className={statCell}>
              <span className={statLabel}>{t("dashboard.netWorth")}</span>
              <Figure size="md" tone={derived.netWorth.total < 0 ? "neg" : undefined} className="block truncate">
                <Money amount={derived.netWorth.total} currency={displayCurrency} />
              </Figure>
            </Link>
          )
        ) : (
          <div className={statCell}>
            <Skeleton rows={2} />
          </div>
        )}
        {month ? (
          <Link href="/transactions" className={statCell}>
            <span className={statLabel}>{t("pocket.home.thisMonth")}</span>
            <span className="block truncate text-[15px] font-semibold leading-5">
              <span className="sr-only">{t("dashboard.income")} </span>
              <Money amount={month.income} currency={displayCurrency} sign="in" tone={month.income > 0.005 ? "pos" : undefined} />
            </span>
            <span className="block truncate text-[15px] font-semibold leading-5">
              <span className="sr-only">{t("dashboard.expense")} </span>
              <Money amount={month.expense} currency={displayCurrency} sign="out" tone={month.expense > 0.005 ? "neg" : undefined} />
            </span>
          </Link>
        ) : (
          <div className={statCell}>
            <Skeleton rows={2} />
          </div>
        )}
      </div>

      <RatesFooter onOpen={() => setSheet("rates")} />

      {derived ? (
        <PocketSheet open={sheet === "safe"} onClose={() => setSheet(null)} title={t("dashboard.safeToSpend")}>
          <SafeBreakdown safe={derived.safe} />
        </PocketSheet>
      ) : null}
      <RatesSheet open={sheet === "rates"} onClose={() => setSheet(null)} />
    </section>
  );
}

function SafeBreakdown({ safe }: { safe: NonNullable<Derived>["safe"] }) {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const line = (label: string, amount: number, sign: "in" | "out" | "none") => (
    <li className="flex min-h-[48px] items-center justify-between gap-3 px-4">
      <span className="min-w-0 text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
      <Money amount={amount} currency={displayCurrency} sign={sign} className="text-[15px] font-semibold" />
    </li>
  );
  return (
    <div className="space-y-3 pb-2">
      <ul className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
        {line(t("pocket.home.safeLiquid"), safe.liquid, "none")}
        {line(t("pocket.home.safeIncome"), safe.plannedIncome, "in")}
        {line(t("pocket.home.safeBills"), safe.plannedExpense, "out")}
        <li className="flex min-h-[52px] items-center justify-between gap-3 bg-[var(--edge-soft)] px-4">
          <span className="text-sm font-semibold">{t("dashboard.safeToSpend")}</span>
          <Money amount={safe.total} currency={displayCurrency} tone={safe.total < 0 ? "neg" : "pos"} className="text-base font-bold" />
        </li>
      </ul>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("dashboard.safeHint")}</p>
    </div>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "USD/TRY 41.80 · EUR/TRY 45.56 · 14:05 ›": the rates every figure above was priced at. */
function RatesFooter({ onOpen }: { onOpen: () => void }) {
  const { t, locale } = useI18n();
  const rates = useRates();
  if (!rates.data) return <div className="min-h-[44px] border-t border-[var(--edge-soft)]" />;
  const items = buildTickerItems(rates.data.usdPer, rates.data.prevUsdPer).slice(0, 2);
  const stale = isStaleTable(rates.data);
  const quotes = items.map((i) => `${i.label} ${formatTickerValue(i, locale)}`).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex min-h-[44px] w-full items-center gap-2 border-t border-[var(--edge-soft)] px-4 text-left text-xs text-zinc-500 active:bg-[var(--edge-soft)] dark:text-zinc-400"
    >
      <span className="min-w-0 truncate tabular-nums">{quotes}</span>
      {/* stale rates say so instead of when they're from */}
      {stale ? (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("common.stale")}
        </span>
      ) : (
        <>
          <span className="sr-only">, {t("pocket.home.ratesAt", { time: timeOf(rates.data.fetchedAt) })}</span>
          <span aria-hidden className="shrink-0 tabular-nums">
            · {timeOf(rates.data.fetchedAt)}
          </span>
        </>
      )}
      <span className="flex-1" />
      <Icon name="chevron" size={16} className="shrink-0 text-zinc-400" />
    </button>
  );
}

/** Every quote with its day's move, when they were fetched, and a way to fetch them again. */
function RatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const rates = useRates();
  const queryClient = useQueryClient();
  if (!rates.data) return null;
  const items = buildTickerItems(rates.data.usdPer, rates.data.prevUsdPer);
  const stale = isStaleTable(rates.data);
  return (
    <PocketSheet open={open} onClose={onClose} title={t("rates.title")}>
      <ul className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-[52px] items-center gap-3 px-4">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
            <span className="text-[15px] font-semibold tabular-nums">{formatTickerValue(item, locale)}</span>
            <span
              className={`w-16 text-right text-xs tabular-nums ${
                item.changePct == null
                  ? "text-zinc-400"
                  : item.changePct >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
              }`}
            >
              {item.changePct == null ? "—" : `${item.changePct >= 0 ? "▲" : "▼"} ${Math.abs(item.changePct).toFixed(2)}%`}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 pb-2">
        <span className={`text-xs ${stale ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>
          {`${t("common.ratesUpdated")} ${timeOf(rates.data.fetchedAt)}${stale ? ` (${t("common.stale")})` : ""}`}
        </span>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: KEYS.rates })}
          className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          <Icon name="refresh" size={18} />
          {t("pocket.refreshRates")}
        </button>
      </div>
    </PocketSheet>
  );
}

/* ------------------------------------------------------------- coming up */

function ComingUp({
  items,
  days,
  lookup,
  onRowTap,
  onComplete,
  onPay,
}: {
  items: ComingUpItem[];
  days: number;
  lookup: TxLookup;
  onRowTap: Parameters<typeof PocketTxRow>[0]["onTap"];
  onComplete: NonNullable<Parameters<typeof PocketTxRow>[0]["onComplete"]>;
  onPay: (card: Account) => void;
}) {
  const { t, locale } = useI18n();
  const total = comingUpTotal(items, { book: lookup.book, usdPer: lookup.usdPer, display: lookup.display });
  const dated = items.some((i) => i.kind !== "victvs");
  return (
    <Section
      title={t("pocket.home.comingUp")}
      flush
      action={
        total != null && dated ? (
          <span className="truncate whitespace-nowrap text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            <AmountPhrase
              text={t("pocket.home.nextDays", { count: days, amount: AMOUNT_SLOT })}
              amount={formatSigned(total, lookup.display, locale)}
            />
          </span>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="flex min-h-12 items-center px-4 pb-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("pocket.home.nothingDue", { count: days })}
        </p>
      ) : (
        <ul data-coming-up className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
          {visibleComingUp(items).map((item) =>
            item.kind === "planned" ? (
              <PocketTxRow key={item.key} tx={item.tx} lookup={lookup} onTap={onRowTap} onComplete={onComplete} due />
            ) : item.kind === "card" ? (
              <CardDueRow key={item.key} item={item} lookup={lookup} onPay={onPay} />
            ) : (
              <VictvsRow key={item.key} count={item.count} amount={item.amountUsd} lookup={lookup} />
            )
          )}
        </ul>
      )}
      {items.length > COMING_UP_ROWS ? (
        <FooterLink href="/transactions?show=due">{t("pocket.home.seeAllN", { count: items.length })}</FooterLink>
      ) : null}
    </Section>
  );
}

const rowClass =
  "flex min-h-[var(--pocket-row-tx,60px)] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left active:bg-[var(--edge-soft)]";

/** A card's statement: what to pay now, what it's owed in all, and Pay. */
function CardDueRow({
  item,
  lookup,
  onPay,
}: {
  item: Extract<ComingUpItem, { kind: "card" }>;
  lookup: TxLookup;
  onPay: (card: Account) => void;
}) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const { account, figure } = item;
  const when = dueLabel(item.date, lookup.today);
  return (
    <li className="flex items-center">
      <Link href="/cards" className={`${rowClass} pr-1`}>
        <span className="shrink-0">
          <Avatar label={account.name} icon={<Icon name="card" size={18} />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{account.name}</span>
          <span className={`block truncate text-xs ${when.late ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
            {when.text}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money amount={figure.amount} currency={account.currency} sign="out" tone="auto" className="block text-[15px] font-semibold" />
          <span className="block whitespace-nowrap text-[11px] tabular-nums text-zinc-400">
            <AmountPhrase
              text={t("pocket.home.totalOwed", { amount: AMOUNT_SLOT })}
              amount={formatSigned(figure.totalOwed, account.currency, locale, "none")}
            />
          </span>
        </span>
      </Link>
      <span className="pr-1">
        <button
          type="button"
          onClick={() => onPay(account)}
          aria-haspopup="dialog"
          aria-label={t("pocket.home.payCard", { name: account.name })}
          className="flex h-11 min-w-11 items-center justify-center px-1"
        >
          <span className="flex h-8 items-center rounded-[var(--pocket-chip-radius,9999px)] bg-teal-600 px-3 text-[13px] font-semibold text-white active:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950">
            {t("pocket.home.pay")}
          </span>
        </button>
      </span>
    </li>
  );
}

function ClipboardGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6v3H9zM9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M9 12h6M9 16h4" />
    </svg>
  );
}

/** Sessions you've given and not been paid for: one undated row, to /victvs. */
function VictvsRow({ count, amount, lookup }: { count: number; amount: number; lookup: TxLookup }) {
  const { t } = useI18n();
  return (
    <li className="flex items-center">
      <Link href="/victvs" className={`${rowClass} pr-2`}>
        <span className="shrink-0">
          <Avatar color="#0ea5e9" label="V" icon={<ClipboardGlyph />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {count === 1 ? t("pocket.home.unpaidSessionsOne") : t("pocket.home.unpaidSessionsMany", { count })}
          </span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t("nav.victvs")}</span>
        </span>
        <span className="shrink-0 text-right">
          <Money amount={amount} currency="USD" sign="in" tone="pos" className="block text-[15px] font-semibold" />
          <Approx amount={amount} from="USD" to={lookup.display} usdPer={lookup.usdPer} />
        </span>
        <Icon name="chevron" size={18} className="shrink-0 text-zinc-400" />
      </Link>
    </li>
  );
}

/* -------------------------------------------------------------- accounts */

function AccountsStrip({ derived, usdPer }: { derived: Derived; usdPer: UsdPerMap | undefined }) {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const headId = useId();
  // which accounts the dashboards list is synced (dashboardLayout.accounts);
  // Home only reads it here
  const { layout } = useDashboardLayout();
  const tiles =
    derived && layout
      ? accountTiles({
          accounts: derived.accounts,
          balances: derived.balances,
          book: derived.book,
          today: derived.today,
          usdPer,
          display: displayCurrency,
          hiddenIds: layout.accounts.hidden,
          hideEmpty: layout.accounts.hideEmpty,
        })
      : null;
  // what the strip leaves out, for the end tile
  const leftOut = tiles && derived ? derived.accounts.filter((a) => !a.archived).length - tiles.length : 0;

  return (
    <section aria-labelledby={headId}>
      <div className="flex min-h-[44px] items-center justify-between gap-2">
        <h2 id={headId} className="text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]" style={headStyle}>
          {t("dashboard.accounts")}
        </h2>
        <Link
          href="/accounts"
          className="-mr-2 flex h-11 items-center gap-0.5 rounded-full px-2 text-sm font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
        >
          {t("pocket.home.allAccounts")}
          <Icon name="chevron" size={16} />
        </Link>
      </div>
      {tiles == null ? (
        <div className="-mx-4 flex gap-2 overflow-hidden px-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="min-h-[5.5rem] w-[9.5rem] shrink-0 rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] p-3">
              <Skeleton rows={2} />
            </div>
          ))}
        </div>
      ) : tiles.length === 0 && leftOut === 0 ? (
        <Link
          href="/accounts"
          className="flex min-h-[56px] items-center gap-3 rounded-[var(--ui-card-radius)] border border-dashed border-[var(--edge)] px-4 py-3 text-sm text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          <span className="flex-1">{t("accounts.empty")}</span>
          <Icon name="chevron" size={18} className="shrink-0" />
        </Link>
      ) : (
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tiles.map((tile) => (
            <li key={tile.account.id} className="shrink-0 snap-start">
              <Link
                href={`/accounts?account=${encodeURIComponent(tile.account.id)}`}
                className="flex min-h-[5.5rem] w-[9.5rem] flex-col justify-between gap-2 rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] p-3 shadow-sm active:bg-[var(--edge-soft)]"
              >
                <span className="block truncate text-[13px] text-zinc-600 dark:text-zinc-300">{tile.account.name}</span>
                <span className="block min-w-0">
                  <Figure size="sm" tone={tile.card && tile.amount < 0 ? "neg" : undefined} className="block truncate">
                    <Money amount={tile.amount} currency={tile.currency} />
                  </Figure>
                  <Approx amount={tile.amount} from={tile.currency} to={displayCurrency} usdPer={usdPer} />
                </span>
              </Link>
            </li>
          ))}
          <li className="shrink-0 snap-start">
            <Link
              href="/accounts"
              className="flex min-h-[5.5rem] w-[9.5rem] items-center justify-center gap-1 rounded-[var(--ui-card-radius)] border border-dashed border-[var(--edge)] p-3 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              {t("pocket.home.allAccounts")}
              {leftOut > 0 ? <span data-left-out>{t("pocket.home.moreAccounts", { count: leftOut })}</span> : null}
              <span aria-hidden>→</span>
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- budgets */

function Budgets({ rows, today }: { rows: ReturnType<typeof budgetStatuses>; today: string }) {
  const { t } = useI18n();
  const categories = useCategories();
  const [all, setAll] = useState(false);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const bar = (row: (typeof rows)[number]) => {
    const category = byId.get(row.budget.categoryId);
    return (
      <PaceBar
        key={row.budget.id}
        name={category?.name ?? "—"}
        color={category?.color}
        spent={row.spent}
        limit={row.budget.monthlyLimit}
        currency={row.budget.currency}
        today={today}
      />
    );
  };
  return (
    <Section
      title={t("budgets.title")}
      action={
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setAll(true)}
          className="-mr-2 flex h-11 items-center gap-0.5 rounded-full px-2 text-sm font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
        >
          {t("pocket.home.allBudgetsN", { count: rows.length })}
          <Icon name="chevron" size={16} />
        </button>
      }
    >
      <div className="divide-y divide-[var(--edge-soft)]">{topBudgets(rows).map(bar)}</div>
      <PocketSheet open={all} onClose={() => setAll(false)} title={t("budgets.title")}>
        <div className="divide-y divide-[var(--edge-soft)]">{topBudgets(rows, rows.length).map(bar)}</div>
        {/* budgets are edited on Settings' Categories tab */}
        <Link
          href="/settings?tab=categories"
          className="mb-2 mt-3 flex min-h-[48px] items-center justify-center gap-1 rounded-xl border border-[var(--edge)] text-[15px] font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("budgets.editIn")}
          <Icon name="chevron" size={16} />
        </Link>
      </PocketSheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ flow */

function FlowChart({ flow }: { flow: NonNullable<Derived>["flow"] }) {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const monthName = (m: string) =>
    new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1))
    );
  return (
    <Section title={`${t("dashboard.monthlyFlow")} (${unitOf(displayCurrency)})`}>
      <div data-amount className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={flow} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={monthName}
              tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--viz-axis)" }}
            />
            <YAxis
              width={36}
              tick={{ fontSize: 10, fill: "var(--viz-muted)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { notation: "compact" }).format(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(m) => monthName(String(m))}
              formatter={(v) => formatAmount(Number(v), displayCurrency, locale)}
              cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
            />
            <Bar dataKey="income" name={t("dashboard.income")} fill="var(--viz-series-1)" radius={[3, 3, 0, 0]} maxBarSize={14} />
            <Bar dataKey="expense" name={t("dashboard.expense")} fill="var(--viz-series-2)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-series-1)" }} />
          {t("dashboard.income")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-series-2)" }} />
          {t("dashboard.expense")}
        </span>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- shared */

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[44px] items-center justify-center gap-0.5 border-t border-[var(--edge-soft)] text-sm font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
    >
      {children}
      <Icon name="chevron" size={16} />
    </Link>
  );
}

function SkeletonSection({ title }: { title: string }) {
  return (
    <Section title={title}>
      <div className="space-y-4 py-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div aria-hidden className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <Skeleton rows={2} className="flex-1" />
          </div>
        ))}
      </div>
    </Section>
  );
}
