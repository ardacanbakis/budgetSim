"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Fieldset, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useLoans, useRates, useTransactions } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { buildCardBook } from "@/lib/domain/cards";
import { computeDebtOverview } from "@/lib/domain/debt";
import { todayISO } from "@/lib/domain/recurrence";
import { DebtSummary, LoanPane, loanIcon } from "@/components/debtsPanel";
import { AccountLine, LoanLine, PORTFOLIO_SEGMENTS, PortfolioSegment, sections as buildSections } from "@/lib/ui/pocket/portfolioSections";
import { formatSigned } from "@/lib/ui/pocket/format";
import { portfolioHref, readPortfolioQuery } from "@/lib/ui/portfolioUrl";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { GoldType, goldRatiosOf, readHoldings } from "@/lib/domain/gold";
import { HoldingsEditor, HoldingsList, HoldingsSummary } from "@/components/goldHoldings";
import { AdjustBalanceModal } from "@/components/adjustBalanceModal";
import { CURRENCIES, CURRENCY_META, Currency, formatAmount } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { ColumnsToggle, columnClass, useColumns } from "@/components/columns";
import { ViewSwitcher } from "@/components/viewSwitcher";
import { useSurfaceView } from "@/lib/ui/useViews";
import { useLocalToggle } from "@/lib/prefs";
import { pocketable } from "@/components/pocket/pocketable";
import { RecentChanges, useLastChange } from "@/components/history";
import { HistoryUpcoming } from "@/components/historyUpcoming";
import { CompleteModal, EditModal } from "@/components/txModals";
import { snapshotFromTable } from "@/lib/domain/fx";

const PocketPortfolio = dynamic(() => import("@/components/pocket/portfolio").then((m) => m.PocketPortfolio), {
  ssr: false,
  loading: () => <Spinner />,
});

export default pocketable(PortfolioPage, PocketPortfolio);

/** Day-of-month as an ordinal: "15th" (en) / "15." (tr). */
function ordinal(day: number, locale: string): string {
  if (locale === "tr") return `${day}.`;
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

function PortfolioPage() {
  // useSearchParams needs a Suspense boundary on a prerendered page
  return (
    <Suspense fallback={<Spinner />}>
      <PortfolioScreen />
    </Suspense>
  );
}

/**
 * The Portfolio: what you hold and what you owe, in three views — All,
 * Assets (cash, crypto and gold) and Debts (what each card owes and the
 * tracked loans, under a strip with the total, the debt-free date and what
 * to pay first). The view lives in the URL (?view=assets|debts; All is
 * none), as does an open loan (&loan=<id>, lib/ui/portfolioUrl.ts), so
 * /loans can redirect here and a link opens a loan; switching replaces the
 * query in place. An account opened in the right-hand pane stays this
 * screen's own state.
 */
function PortfolioScreen() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const query = readPortfolioQuery(params);
  const seg: PortfolioSegment = query.view ?? "all";
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const rates = useRates();
  const loans = useLoans();
  const [modalOpen, setModalOpen] = useState(false);
  const { columns, setColumns } = useColumns("renovator-cols-portfolio");
  // shape is how each holding is drawn; `columns` above is the page's own
  // master-detail vs stacked layout, which is a different question
  const view = useSurfaceView("accounts");
  const hideEmpty = useLocalToggle("renovator-portfolio-hide-empty", false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestFirst, setLatestFirst] = useState(true);
  const [adjusting, setAdjusting] = useState(false);
  // a row of the account's history being edited or completed
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [completingTx, setCompletingTx] = useState<Transaction | null>(null);
  const lastChangeOf = useLastChange();

  const createAccount = useAppMutation((input: NewAccount) => repo.createAccount(input), [KEYS.accounts]);
  const updateAccount = useAppMutation(
    (v: { id: string; patch: Partial<NewAccount> & { archived?: boolean } }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts, KEYS.transactions]
  );
  const deleteAccount = useAppMutation((id: string) => repo.deleteAccount(id), [KEYS.accounts, KEYS.transactions]);
  const txKeys = [KEYS.transactions, KEYS.accounts];
  const updateTx = useAppMutation(
    (v: { id: string; patch: Parameters<typeof repo.updateTransaction>[1] }) => repo.updateTransaction(v.id, v.patch),
    txKeys
  );
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), txKeys);
  const completeTx = useAppMutation(
    (v: { id: string; amount?: number; legacy?: boolean }) =>
      repo.completeTransaction(v.id, snapshotFromTable(rates.data!), v.amount, v.legacy),
    txKeys
  );

  const balances = useMemo(
    () =>
      accounts.data && transactions.data
        ? computeBalances(accounts.data, transactions.data, goldRatiosOf(rates.data))
        : new Map<string, number>(),
    [accounts.data, transactions.data, rates.data]
  );

  const today = todayISO();
  const usdPer = rates.data?.usdPer;
  // the cards and loans as Pocket's Portfolio counts them (lib/ui/pocket/portfolioSections.ts):
  // a card at what it owes, never its ledger balance; a loan at what's left of it
  const debts = useMemo(() => {
    if (!accounts.data || !transactions.data) return null;
    const book = buildCardBook(accounts.data, transactions.data);
    const overview = loans.data
      ? computeDebtOverview({
          loans: loans.data,
          accounts: accounts.data,
          balances,
          transactions: transactions.data,
          usdPer: usdPer ?? ({} as UsdPerMap),
          display: displayCurrency,
          today,
        })
      : null;
    const s = buildSections({
      accounts: accounts.data,
      balances,
      book,
      debt: overview,
      usdPer,
      display: displayCurrency,
      hideEmpty: false,
      today,
    });
    return { overview: usdPer ? overview : null, cards: s.cards.rows, loans: s.loans.rows };
  }, [accounts.data, transactions.data, loans.data, balances, usdPer, displayCurrency, today]);

  if (accounts.isLoading || transactions.isLoading) return <Spinner />;

  const showAssets = seg !== "debts";
  const showDebts = seg !== "assets";
  // an account sitting at zero is noise on a page about what you hold
  const all = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const list = hideEmpty.value ? all.filter((a) => Math.abs(balances.get(a.id) ?? 0) > 1e-9) : all;
  // a card owing nothing is empty too, where cards are listed
  const allCards = showDebts ? (debts?.cards ?? []) : [];
  const emptyCount =
    (showAssets ? all.filter((a) => Math.abs(balances.get(a.id) ?? 0) <= 1e-9).length : 0) + allCards.filter((l) => l.empty).length;
  const archived = (accounts.data ?? []).filter((a) => a.archived);
  const sections: Array<{ key: string; title: string; items: Account[] }> = showAssets
    ? [
        { key: "accounts", title: t("portfolio.accounts"), items: list.filter((a) => a.kind === "fiat") },
        { key: "assets", title: t("portfolio.assets"), items: list.filter((a) => a.kind === "crypto" || a.kind === "gold") },
      ]
    : [];
  const cardLines = hideEmpty.value ? allCards.filter((l) => !l.empty) : allCards;
  const loanLines = showDebts ? (debts?.loans ?? []) : [];
  const openLoan = query.loan ? ((loans.data ?? []).find((l) => l.id === query.loan) ?? null) : null;
  const selected = openLoan ? null : ((accounts.data ?? []).find((a) => a.id === selectedId) ?? null);

  const chooseView = (v: PortfolioSegment) => replaceQuery(portfolioHref({ view: v }));
  const chooseLoan = (id: string) => {
    setSelectedId(null);
    replaceQuery(portfolioHref({ view: seg, loan: id }));
  };
  const chooseAccount = (id: string) => {
    setSelectedId(id);
    // an account takes the pane from an open loan
    if (query.loan) replaceQuery(portfolioHref({ view: seg }));
  };
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]));

  // A gold account holding a mix reads best in lira, with what it holds
  // underneath: its gram-equivalent is a means of adding coins up, not a
  // number anyone thinks in.
  const mixed = (a: Account) => a.kind === "gold" && (a.holdings?.length ?? 0) > 0;
  const figure = (a: Account, balance: number): { amount: number; currency: Currency } => {
    if (mixed(a) && rates.data) {
      const inTry = convert(balance, a.currency, "TRY", rates.data.usdPer);
      if (inTry != null) return { amount: inTry, currency: "TRY" };
    }
    return { amount: balance, currency: a.currency };
  };
  const unitLabel = (a: Account) =>
    mixed(a) ? <HoldingsSummary holdings={a.holdings!} /> : a.currency === "XAU_G" ? "GOLD g" : a.currency;

  function itemRow(account: Account) {
    const balance = balances.get(account.id) ?? 0;
    const shown = figure(account, balance);
    const converted = rates.data ? convert(balance, account.currency, displayCurrency, rates.data.usdPer) : null;
    const isCard = account.kind === "credit_card";
    const active = selectedId === account.id;
    return (
      <button
        key={account.id}
        onClick={() => chooseAccount(account.id)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
          active ? "bg-teal-50 ring-1 ring-teal-500/40 dark:bg-teal-950" : "hover:bg-[var(--edge-soft)]"
        }`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-base">{isCard ? "💳" : account.kind === "crypto" ? "₿" : account.kind === "gold" ? "🪙" : "🏦"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{account.name}</span>
            <span className="block truncate text-[11px] text-zinc-400">{unitLabel(account)}</span>
            {(() => {
              const last = lastChangeOf(account, balance);
              // w-0 + min-w-full: as wide as the row allows, never wider (a long line can't stretch the page)
              return last ? (
                <span className="block w-0 min-w-full truncate text-[11px] text-zinc-400" data-last-change>
                  {last}
                </span>
              ) : null;
            })()}
          </span>
        </span>
        <span className="text-right">
          <span className={`block text-sm font-semibold tabular-nums ${isCard && balance < 0 ? "text-red-600" : ""}`}>
            {formatAmount(shown.amount, shown.currency, locale)}
          </span>
          {shown.currency !== displayCurrency && converted != null ? (
            <span className="block text-[11px] tabular-nums text-zinc-400">≈ {formatAmount(converted, displayCurrency, locale)}</span>
          ) : null}
        </span>
      </button>
    );
  }

  /** A holding as a card — roomier, and the shape that survives a phone best. */
  function itemCard(account: Account) {
    const balance = balances.get(account.id) ?? 0;
    const shown = figure(account, balance);
    const converted = rates.data ? convert(balance, account.currency, displayCurrency, rates.data.usdPer) : null;
    const isCard = account.kind === "credit_card";
    const active = selectedId === account.id;
    return (
      <button
        key={account.id}
        onClick={() => chooseAccount(account.id)}
        className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
          active
            ? "border-teal-500 bg-teal-50 dark:bg-teal-950"
            : "border-[var(--edge)] hover:border-teal-500/40"
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="text-base">{isCard ? "💳" : account.kind === "crypto" ? "₿" : account.kind === "gold" ? "🪙" : "🏦"}</span>
          <span className="min-w-0 truncate text-sm font-medium">{account.name}</span>
        </span>
        {mixed(account) ? <span className="truncate text-[11px] text-zinc-400">{unitLabel(account)}</span> : null}
        <span className={`tnum text-lg font-semibold ${isCard && balance < 0 ? "text-red-600" : ""}`}>
          {formatAmount(shown.amount, shown.currency, locale)}
        </span>
        {shown.currency !== displayCurrency && converted != null ? (
          <span className="tnum text-[11px] text-zinc-400">≈ {formatAmount(converted, displayCurrency, locale)}</span>
        ) : null}
      </button>
    );
  }

  /** A holding as a table row, for when you're comparing figures not browsing. */
  function itemTableRow(account: Account) {
    const balance = balances.get(account.id) ?? 0;
    const shown = figure(account, balance);
    const converted = rates.data ? convert(balance, account.currency, displayCurrency, rates.data.usdPer) : null;
    const isCard = account.kind === "credit_card";
    return (
      <tr
        key={account.id}
        onClick={() => chooseAccount(account.id)}
        className={`cursor-pointer border-b border-[var(--edge-soft)] ${
          selectedId === account.id ? "bg-teal-50 dark:bg-teal-950" : "hover:bg-[var(--edge-soft)]"
        }`}
      >
        <td className="px-3 py-1.5 text-sm" data-label={t("common.account")}>
          {account.name}
        </td>
        <td className="px-3 py-1.5 text-xs text-zinc-500" data-label={t("common.currency")}>
          {unitLabel(account)}
        </td>
        <td
          className={`px-3 py-1.5 text-right text-sm font-semibold tnum ${isCard && balance < 0 ? "text-red-600" : ""}`}
          data-label={t("common.balance")}
        >
          {formatAmount(shown.amount, shown.currency, locale)}
        </td>
        <td className="px-3 py-1.5 text-right text-xs tnum text-zinc-400" data-label={displayCurrency}>
          {converted != null ? formatAmount(converted, displayCurrency, locale) : "—"}
        </td>
      </tr>
    );
  }

  /** One section's holdings, in whichever shape is selected. */
  function sectionBody(items: Account[]) {
    if (view.shape === "grid") {
      return <div className={`grid gap-2 p-2 ${columnClass(view.columns)}`}>{items.map(itemCard)}</div>;
    }
    if (view.shape === "table") {
      return (
        <div className="overflow-x-auto">
          <table className="stack-sm w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
                <th className="px-3 py-2 font-medium">{t("common.account")}</th>
                <th className="px-3 py-2 font-medium">{t("common.currency")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("common.balance")}</th>
                <th className="px-3 py-2 text-right font-medium">{displayCurrency}</th>
              </tr>
            </thead>
            <tbody>{items.map(itemTableRow)}</tbody>
          </table>
        </div>
      );
    }
    return <div className="space-y-0.5 p-2">{items.map(itemRow)}</div>;
  }

  const history = selected
    ? (transactions.data ?? [])
        .filter((tx) => tx.accountId === selected.id)
        .sort((a, b) => (latestFirst ? (a.dueDate < b.dueDate ? 1 : -1) : a.dueDate > b.dueDate ? 1 : -1))
    : [];
  // what's planned reads soonest first, whichever way the history is sorted
  const upcoming = history
    .filter((tx) => tx.status === "planned")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const completed = history.filter((tx) => tx.status === "completed");

  // completed history grouped by month with this account's monthly net
  // (in the account's own currency; legacy records shown but not counted —
  // they never moved the balance)
  const completedMonths = (() => {
    const byMonth = new Map<string, { items: Transaction[]; net: number }>();
    for (const tx of completed) {
      const month = tx.dueDate.slice(0, 7);
      const bucket = byMonth.get(month) ?? { items: [], net: 0 };
      bucket.items.push(tx);
      if (!tx.legacy) bucket.net += tx.direction === "income" ? tx.amount : -tx.amount;
      byMonth.set(month, bucket);
    }
    return [...byMonth.entries()];
  })();

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long", year: "numeric" });

  function historyRow(tx: Transaction) {
    if (!selected) return null;
    const category = tx.categoryId ? categoryById.get(tx.categoryId) : null;
    const income = tx.direction === "income";
    return (
      <li key={tx.id} className={`flex flex-wrap items-center gap-x-3 px-4 py-2 sm:flex-nowrap ${tx.status === "planned" ? "opacity-70" : ""}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm">{tx.description || category?.name || (tx.transferGroupId ? t("tx.transfer") : "—")}</span>
            {tx.transferGroupId ? <Badge tone="sky">{t("tx.transfer")}</Badge> : null}
            {tx.status === "planned" ? <Badge tone="amber">{t("tx.planned")}</Badge> : null}
            {tx.legacy ? <Badge tone="zinc">{t("legacy.badge")}</Badge> : null}
            {tx.adjustment ? <Badge tone="violet">{t("adjust.badge")}</Badge> : null}
          </div>
          <div className="text-[11px] text-zinc-400">{fmtDate(tx.dueDate)}</div>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${income ? "text-green-600" : "text-red-600"}`}>
          {income ? "+" : "−"}
          {formatAmount(tx.amount, selected.currency, locale)}
        </span>
        {/* not read-only any more: what's wrong in an account's history is fixed where it's seen */}
        <span className="flex w-full shrink-0 justify-end gap-0.5 sm:w-auto">
          {tx.status === "planned" ? (
            <Button variant="ghost" title={t("tx.complete")} aria-label={t("tx.complete")} disabled={!rates.data} onClick={() => setCompletingTx(tx)}>
              ✓
            </Button>
          ) : null}
          {!tx.transferGroupId ? (
            <Button variant="ghost" title={t("tx.editTitle")} aria-label={t("tx.editTitle")} onClick={() => setEditingTx(tx)}>
              ✎
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-label={t("common.delete")}
            onClick={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(tx.id)}
          >
            ✕
          </Button>
        </span>
      </li>
    );
  }

  /** A card in the Debts view: what it owes; it opens on the Cards page, where it's paid. */
  function cardRow(line: AccountLine) {
    const { account, balance, converted, card } = line;
    return (
      <Link
        key={account.id}
        href="/cards"
        data-debt-row={account.name}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--edge-soft)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-base">💳</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{account.name}</span>
            <span className="block truncate text-[11px] text-zinc-400">
              {card?.paymentDay != null ? t("pocket.portfolio.cardDue", { day: ordinal(card.paymentDay, locale) }) : account.currency}
            </span>
          </span>
        </span>
        <span className="text-right">
          <span className={`block text-sm font-semibold tabular-nums ${balance < 0 ? "text-red-600" : ""}`}>
            {formatSigned(balance, account.currency, locale)}
          </span>
          {account.currency !== displayCurrency && converted != null ? (
            <span className="block text-[11px] tabular-nums text-zinc-400">≈ {formatSigned(converted, displayCurrency, locale)}</span>
          ) : null}
        </span>
      </Link>
    );
  }

  /** A debt: what's left of it, owed or owed to you; it opens in the right-hand pane. */
  function loanRow(line: LoanLine) {
    const { item, amount, converted } = line;
    const loan = (loans.data ?? []).find((l) => l.id === item.id);
    const active = openLoan?.id === item.id;
    const lent = item.direction === "lent";
    return (
      <button
        key={item.id}
        type="button"
        data-debt-row={item.name}
        aria-pressed={active}
        onClick={() => chooseLoan(item.id)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
          active ? "bg-teal-50 ring-1 ring-teal-500/40 dark:bg-teal-950" : "hover:bg-[var(--edge-soft)]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-base">{loan ? loanIcon(loan) : "📄"}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.name}</span>
            <span className="block truncate text-[11px] text-zinc-400">
              {item.endDate
                ? `${lent ? t("pages.lastPayment") : t("debt.debtFree")}: ${fmtDate(item.endDate)}`
                : t("debts.whenICan")}
            </span>
          </span>
        </span>
        <span className="text-right">
          <span className={`block text-sm font-semibold tabular-nums ${lent ? "text-green-600" : "text-red-600"}`}>
            {formatSigned(amount, item.currency, locale)}
          </span>
          {item.currency !== displayCurrency && converted != null ? (
            <span className="block text-[11px] tabular-nums text-zinc-400">≈ {formatSigned(converted, displayCurrency, locale)}</span>
          ) : null}
        </span>
      </button>
    );
  }

  const nothingListed =
    sections.every((section) => section.items.length === 0) && cardLines.length === 0 && loanLines.length === 0;

  return (
    <div className={`mx-auto space-y-4 ${columns === 1 ? "max-w-6xl 3xl:max-w-[1700px]" : "max-w-none"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("portfolio.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              checked={hideEmpty.value}
              onChange={(e) => hideEmpty.setValue(e.target.checked)}
            />
            {emptyCount > 0
              ? t("portfolio.hideEmptyCount", { count: emptyCount })
              : t("portfolio.hideEmpty")}
          </label>
          <ViewSwitcher
            surface="accounts"
            shape={view.shape}
            onShape={view.setShape}
            columns={view.columns}
            onColumns={view.setColumns}
          />
          <ColumnsToggle columns={columns} onChange={setColumns} max={2} />
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + {t("accounts.newAccount")}
          </Button>
        </div>
      </div>

      <div role="group" aria-label={t("pocket.portfolio.segLabel")} className="flex w-max gap-1 rounded-lg bg-[var(--edge-soft)] p-1">
        {PORTFOLIO_SEGMENTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={seg === v}
            onClick={() => chooseView(v)}
            className={`rounded-md px-3 py-1 text-sm font-medium ${seg === v ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"}`}
          >
            {v === "all" ? t("common.all") : v === "assets" ? t("pocket.portfolio.segAssets") : t("pocket.portfolio.segDebts")}
          </button>
        ))}
      </div>

      {seg === "debts" ? <DebtSummary overview={debts?.overview ?? null} display={displayCurrency} /> : null}

      <div
        className={
          columns === 1
            ? "grid items-start gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]"
            : "space-y-4"
        }
      >
        {/* left: sections */}
        <div className={columns === 1 ? "space-y-4" : columnClass(columns)}>
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <Card key={section.key}>
                <CardHeader title={section.title} />
                {sectionBody(section.items)}
              </Card>
            )
          )}
          {cardLines.length > 0 ? (
            <Card>
              <CardHeader title={t("debt.cards")} />
              <div className="space-y-0.5 p-2">{cardLines.map(cardRow)}</div>
            </Card>
          ) : null}
          {loanLines.some((l) => l.item.direction !== "lent") ? (
            <Card>
              <CardHeader title={t("loans.title")} />
              <div className="space-y-0.5 p-2">{loanLines.filter((l) => l.item.direction !== "lent").map(loanRow)}</div>
            </Card>
          ) : null}
          {loanLines.some((l) => l.item.direction === "lent") ? (
            <Card>
              <CardHeader title={t("debts.owedToYou")} />
              <div className="space-y-0.5 p-2" data-owed-to-you-list>
                {loanLines.filter((l) => l.item.direction === "lent").map(loanRow)}
              </div>
            </Card>
          ) : null}
          {nothingListed ? (
            <EmptyState>{seg === "debts" ? t("pages.noDebts") : t("accounts.empty")}</EmptyState>
          ) : null}
          {showAssets && archived.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-zinc-500">
                {t("accounts.archived")} ({archived.length})
              </summary>
              <Card className="mt-2">
                {sectionBody(archived)}
              </Card>
            </details>
          ) : null}
        </div>

        {/* right: detail + history */}
        <Card className="lg:sticky lg:top-16">
          {openLoan ? (
            <LoanPane
              key={openLoan.id}
              loan={openLoan}
              display={displayCurrency}
              usdPer={usdPer}
              onDeleted={() => replaceQuery(portfolioHref({ view: seg }))}
            />
          ) : query.loan && !loans.isLoading ? (
            <div className="p-8 text-center text-sm text-zinc-400">{t("pages.loanNotFound")}</div>
          ) : !selected ? (
            <div className="p-8 text-center text-sm text-zinc-400">
              {seg === "debts" ? t("pages.selectLoanHint") : t("portfolio.selectHint")}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--edge-soft)] p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{selected.name}</span>
                    <Badge tone={selected.kind === "credit_card" ? "red" : selected.kind === "crypto" ? "sky" : selected.kind === "gold" ? "amber" : "zinc"}>
                      {selected.kind === "credit_card" ? t("accounts.creditCard") : t(`currency.${selected.currency}`)}
                    </Badge>
                    {selected.archived ? <Badge tone="red">{t("accounts.archived")}</Badge> : null}
                  </div>
                  <div className={`mt-1 text-3xl font-bold tabular-nums ${selected.kind === "credit_card" && (balances.get(selected.id) ?? 0) < 0 ? "text-red-600" : ""}`}>
                    {(() => {
                      const shown = figure(selected, balances.get(selected.id) ?? 0);
                      return formatAmount(shown.amount, shown.currency, locale);
                    })()}
                  </div>
                  {rates.data && figure(selected, 0).currency !== displayCurrency ? (
                    <div className="text-sm text-zinc-400 tabular-nums">
                      ≈ {(() => {
                        const converted = convert(balances.get(selected.id) ?? 0, selected.currency, displayCurrency, rates.data.usdPer);
                        return converted != null ? formatAmount(converted, displayCurrency, locale) : t("common.rateUnavailable");
                      })()}
                    </div>
                  ) : null}
                  {selected.kind === "credit_card" && selected.paymentDay ? (
                    <div className="mt-1 text-xs text-zinc-500">
                      📅 {t("accounts.paymentDueOn", { day: ordinal(selected.paymentDay, locale) })}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {/* a mixed gold account is corrected by editing its holdings */}
                  {!selected.archived && !mixed(selected) && selected.kind !== "credit_card" ? (
                    <Button variant="ghost" onClick={() => setAdjusting(true)}>
                      ± {t("adjust.title")}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setEditing(selected)}>
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => updateAccount.mutate({ id: selected.id, patch: { archived: !selected.archived } })}
                  >
                    {selected.archived ? t("accounts.unarchive") : t("accounts.archive")}
                  </Button>
                </div>
              </div>

              {mixed(selected) ? (
                <div className="border-b border-[var(--edge-soft)]">
                  <p className="px-4 pt-3 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{t("gold.holdings")}</p>
                  <HoldingsList holdings={selected.holdings!} prices={rates.data?.goldTry} />
                </div>
              ) : null}

              <RecentChanges account={selected} balanceNow={balances.get(selected.id) ?? 0} />

              <HistoryUpcoming
                className="pb-2"
                historyCount={completed.length}
                upcomingCount={upcoming.length}
                historyAction={
                  <button onClick={() => setLatestFirst(!latestFirst)} className="text-xs text-teal-600 hover:underline">
                    {latestFirst ? t("portfolio.sortLatest") : t("portfolio.sortOldest")} ⇅
                  </button>
                }
                upcoming={
                  <ul className="max-h-[60vh] divide-y divide-[var(--edge-soft)] overflow-y-auto" data-account-upcoming>
                    {upcoming.map(historyRow)}
                  </ul>
                }
                history={
                  <div className="max-h-[60vh] overflow-y-auto" data-account-history>
                    {completedMonths.map(([month, { items, net }]) => (
                      <div key={month}>
                        <div className="flex items-center justify-between px-4 pt-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{monthLabel(month)}</span>
                          <span className={`text-[11px] font-semibold tabular-nums ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {net >= 0 ? "+" : "−"}
                            {formatAmount(Math.abs(net), selected.currency, locale)}
                          </span>
                        </div>
                        <ul className="divide-y divide-[var(--edge-soft)]">{items.map(historyRow)}</ul>
                      </div>
                    ))}
                  </div>
                }
              />
            </>
          )}
        </Card>
      </div>

      <EditModal
        tx={editingTx}
        accounts={(accounts.data ?? []).filter((a) => !a.archived && !(editingTx?.adjustment && a.kind === "credit_card"))}
        categories={categories.data ?? []}
        onClose={() => setEditingTx(null)}
        onSave={async (patch) => {
          if (editingTx) await updateTx.mutateAsync({ id: editingTx.id, patch });
          setEditingTx(null);
        }}
      />
      <CompleteModal
        tx={completingTx}
        accountCurrency={completingTx ? accounts.data?.find((a) => a.id === completingTx.accountId)?.currency : undefined}
        onClose={() => setCompletingTx(null)}
        onConfirm={async (amount, legacy) => {
          if (completingTx) await completeTx.mutateAsync({ id: completingTx.id, amount, legacy });
          setCompletingTx(null);
        }}
      />

      <AdjustBalanceModal
        open={adjusting && selected != null}
        account={selected}
        balance={selected ? (balances.get(selected.id) ?? 0) : 0}
        onClose={() => setAdjusting(false)}
      />

      <AccountModal
        open={modalOpen || editing != null}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (input) => {
          if (editing) await updateAccount.mutateAsync({ id: editing.id, patch: input });
          else await createAccount.mutateAsync(input);
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                if (window.confirm(t("accounts.deleteWarning"))) {
                  await deleteAccount.mutateAsync(editing.id);
                  setEditing(null);
                  setSelectedId(null);
                }
              }
            : undefined
        }
      />
    </div>
  );
}

export function AccountModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  initialKind,
}: {
  open: boolean;
  initial: Account | null;
  onClose: () => void;
  onSave: (input: NewAccount) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** a new account starts as this kind (a "new card" button opens with credit card ticked); ignored when editing */
  initialKind?: Account["kind"];
}) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const rates = useRates();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [opening, setOpening] = useState("0");
  const [isCard, setIsCard] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDay, setPaymentDay] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [holdings, setHoldings] = useState<{ type: GoldType; qty: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState<string | null>(null);

  // re-init form when target changes
  const targetKey = initial?.id ?? (open ? "new" : "closed");
  // Forget the last form once closed, so the next open starts from `initial`
  // again instead of the previous entry's leftovers.
  if (!open && initialized !== null) setInitialized(null);
  if (open && initialized !== targetKey) {
    setInitialized(targetKey);
    setName(initial?.name ?? "");
    // a new crypto or gold account starts in its one currency
    setCurrency(initial?.currency ?? (initialKind === "crypto" ? "BTC" : initialKind === "gold" ? "XAU_G" : "TRY"));
    setOpening(String(initial?.openingBalance ?? 0));
    setIsCard((initial?.kind ?? initialKind) === "credit_card");
    setPaymentAccountId(initial?.paymentAccountId ?? "");
    setPaymentDay(initial?.paymentDay != null ? String(initial.paymentDay) : "");
    setCreditLimit(initial?.creditLimit != null ? String(initial.creditLimit) : "");
    // a gold account's grams so far become a gram-gold holding, so the list
    // says everything it holds
    const held = initial?.holdings ?? [];
    const opening = initial?.currency === "XAU_G" ? initial.openingBalance : 0;
    setHoldings(
      [...(opening > 0 ? [{ type: "gram" as GoldType, qty: opening }] : []), ...held].map((h) => ({ type: h.type, qty: String(h.qty) }))
    );
  }

  const fiat = CURRENCY_META[currency].kind === "fiat";
  const gold = currency === "XAU_G";
  const paymentCandidates = (accounts.data ?? []).filter(
    (a) => !a.archived && a.kind === "fiat" && a.id !== initial?.id
  );

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("accounts.newAccount")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return; // double-Enter guard
          setSaving(true);
          try {
            const card = fiat && isCard;
            const day = Number(paymentDay);
            await onSave({
              name,
              currency,
              kind: card ? "credit_card" : CURRENCY_META[currency].kind,
              // a card's ledger balance isn't used (lib/domain/cards.ts): what it's
              // owed comes from the payments you record and the charges on it.
              // A gold account's grams live in its holdings.
              openingBalance: card ? (initial?.openingBalance ?? 0) : gold ? 0 : Number(opening) || 0,
              ...(gold ? { holdings: readHoldings(holdings.map((h) => ({ type: h.type, qty: Number(h.qty) }))) } : {}),
              paymentAccountId: card ? paymentAccountId || null : null,
              paymentDay: card && day >= 1 && day <= 31 ? day : null,
              creditLimit: card && Number(creditLimit) > 0 ? Number(creditLimit) : null,
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ziraat TRY" />
        </Field>
        <Field label={t("common.currency")}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {t(`currency.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        {fiat ? (
          // two buttons, so a Fieldset: a Field's <label> would rename the first one
          <Fieldset label={t("accounts.kind")}>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={!isCard ? "primary" : "secondary"} aria-pressed={!isCard} onClick={() => setIsCard(false)}>
                {t("accounts.bankOrCash")}
              </Button>
              <Button type="button" variant={isCard ? "primary" : "secondary"} aria-pressed={isCard} onClick={() => setIsCard(true)}>
                💳 {t("accounts.creditCard")}
              </Button>
            </div>
          </Fieldset>
        ) : null}
        {fiat && isCard ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("accounts.paymentAccount")} hint={t("accounts.paymentAccountHint")}>
              <Select value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {paymentCandidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("cards.creditLimit")} hint={t("cards.creditLimitHint")}>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </Field>
            <Field label={t("accounts.paymentDay")} hint={t("accounts.paymentDayHint")}>
              <Input
                type="number"
                min="1"
                max="31"
                inputMode="numeric"
                placeholder="15"
                value={paymentDay}
                onChange={(e) => setPaymentDay(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        {gold ? (
          // a list of controls, so a Fieldset: a Field's <label> would rename its first button
          <Fieldset label={t("gold.holdings")} hint={t("gold.holdingsHint")}>
            <HoldingsEditor value={holdings} onChange={setHoldings} prices={rates.data?.goldTry} />
          </Fieldset>
        ) : fiat && isCard ? null : (
          <Field label={t("accounts.openingBalance")}>
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </Field>
        )}
        <div className="flex justify-between gap-2 pt-1">
          {onDelete ? (
            <Button type="button" variant="danger" onClick={onDelete}>
              {t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
