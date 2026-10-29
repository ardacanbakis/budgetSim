"use client";

import dynamic from "next/dynamic";
import { ReactNode, Suspense, useMemo, useState } from "react";
import { redirect, useSearchParams } from "next/navigation";
import { Badge, Button, Card, EmptyState, Select, Spinner } from "@/components/ui";
import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { Account, Category, Transaction, TxDirection, TxStatus } from "@/lib/data/types";
import { buildCardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useApp } from "@/lib/data/provider";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { ColumnsToggle, columnClass, useColumns } from "@/components/columns";
import { RecurringTab } from "@/components/recurringTab";
import { CompleteModal, EditModal } from "@/components/txModals";
import { canBeCardPayment, ConvertToCardPaymentModal } from "@/components/convertToCardPayment";
import { pocketable } from "@/components/pocket/pocketable";
import { COLLAPSE_HISTORY_KEY, useLocalToggle } from "@/lib/prefs";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { RECURRING_HREF } from "@/lib/ui/recurringUrl";
import { timelineHref } from "@/lib/ui/timeline";
import { parseTab } from "@/lib/ui/urlTab";

const PocketTransactions = dynamic(() => import("@/components/pocket/transactions").then((m) => m.PocketTransactions), {
  ssr: false,
  loading: () => <Spinner />,
});

export default pocketable(TransactionsPage, PocketTransactions);

const TABS = ["ledger", "income", "bills"] as const;
type Tab = (typeof TABS)[number];

function TransactionsPage() {
  // useSearchParams needs a Suspense boundary on a prerendered page
  return (
    <Suspense fallback={<Spinner />}>
      <TransactionsScreen />
    </Suspense>
  );
}

/**
 * The ledger and the recurring items that fill it, as three tabs: the
 * ledger, Income and Bills. The open tab lives in the URL (?tab=income,
 * ?tab=bills), so a link opens the right one. Switching replaces the history
 * entry (replaceQuery), so Back leaves the page rather than stepping between
 * tabs. The old Recurring tab (?tab=recurring, and /recurring) lands on
 * Income; the Timeline is Reports' first report now, and its old address
 * lands there.
 */
function TransactionsScreen() {
  const { t } = useI18n();
  const params = useSearchParams();
  if (params.get("tab") === "timeline") redirect(timelineHref(params.get("account")));
  if (params.get("tab") === "recurring") redirect(RECURRING_HREF.income);
  const tab: Tab = parseTab(params.get("tab"), TABS, "ledger");

  const tabs = (
    <div role="tablist" aria-label={t("tx.title")} className="flex gap-1 border-b border-[var(--edge)]">
      {TABS.map((id) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => replaceQuery(id === "ledger" ? "/transactions" : `/transactions?tab=${id}`)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === id
              ? "border-teal-600 text-teal-700 dark:text-teal-300"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          {id === "ledger" ? t("tx.tabLedger") : id === "income" ? t("income.tabIncome") : t("income.tabBills")}
        </button>
      ))}
    </div>
  );

  if (tab === "income" || tab === "bills") return <RecurringTab key={tab} tabs={tabs} kind={tab} />;
  return <LedgerTab tabs={tabs} />;
}

function LedgerTab({ tabs }: { tabs: ReactNode }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const rates = useRates();

  const [filterAccount, setFilterAccount] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | TxStatus>("all");
  const [filterDirection, setFilterDirection] = useState<"all" | TxDirection>("all");
  const [latestFirst, setLatestFirst] = useState(true);
  const [txModal, setTxModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [completing, setCompleting] = useState<Transaction | null>(null);
  const [converting, setConverting] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { columns, setColumns } = useColumns("renovator-cols-transactions");
  const collapseHistory = useLocalToggle(COLLAPSE_HISTORY_KEY, true);

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), invalidate);
  const updateTx = useAppMutation(
    (v: { id: string; patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">> }) =>
      repo.updateTransaction(v.id, v.patch),
    invalidate
  );
  const reopenTx = useAppMutation((id: string) => repo.reopenTransaction(id), invalidate);
  const completeTx = useAppMutation(
    (v: { id: string; amount?: number; legacy?: boolean }) =>
      repo.completeTransaction(v.id, snapshotFromTable(rates.data!), v.amount, v.legacy),
    invalidate
  );
  const toggleLegacy = useAppMutation(
    (v: { id: string; legacy: boolean }) => repo.setTransactionLegacy(v.id, v.legacy),
    invalidate
  );
  const bulkLegacy = useAppMutation(
    (ids: string[]) => repo.bulkCompleteAsLegacy(ids, snapshotFromTable(rates.data!)),
    invalidate
  );

  // Cards (lib/domain/cards.ts): a payment into a card is the spending, so
  // what was charged to the card, and the payment's landing on it, stay off
  // this page. The Cards page lists them.
  const book = useMemo(() => buildCardBook(accounts.data ?? [], transactions.data ?? []), [accounts.data, transactions.data]);
  const listed = useMemo(
    () => (transactions.data ?? []).filter((tx) => book.roleOf(tx) !== "charge" && book.roleOf(tx) !== "cardSide"),
    [transactions.data, book]
  );

  const overduePlanned = listed.filter((tx) => tx.status === "planned" && tx.dueDate < todayISO());

  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  // a transfer is one action written as two rows; pair them so it reads as one
  const transferLegs = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const tx of transactions.data ?? []) {
      if (tx.transferGroupId && tx.direction === "income") map.set(tx.transferGroupId, tx);
    }
    return map;
  }, [transactions.data]);
  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  const filtered = useMemo(() => {
    let list = listed;
    if (filterAccount !== "all") list = list.filter((tx) => tx.accountId === filterAccount);
    if (filterStatus !== "all") list = list.filter((tx) => tx.status === filterStatus);
    if (filterDirection !== "all") list = list.filter((tx) => tx.direction === filterDirection);
    return [...list].sort((a, b) =>
      latestFirst ? (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0) : a.dueDate > b.dueDate ? 1 : a.dueDate < b.dueDate ? -1 : 0
    );
  }, [listed, filterAccount, filterStatus, filterDirection, latestFirst]);

  const thisMonth = todayISO().slice(0, 7);

  // Year → month grouping with a per-month outcome in the display currency:
  // income − expense = net, transfers excluded but card payments counted (they
  // are the spending), and legacy kept in its own running total so imported
  // history is visible without skewing the real one.
  const groups = useMemo(() => {
    const currencyOf = new Map((accounts.data ?? []).map((a) => [a.id, a.currency] as const));
    const byMonth = new Map<
      string,
      { items: Transaction[]; income: number; expense: number; legacyIncome: number; legacyExpense: number }
    >();
    for (const tx of filtered) {
      const month = tx.dueDate.slice(0, 7);
      const bucket =
        byMonth.get(month) ?? { items: [], income: 0, expense: 0, legacyIncome: 0, legacyExpense: 0 };
      bucket.items.push(tx);
      const income = isIncome(tx, book);
      if (income || isSpending(tx, book)) {
        const currency = currencyOf.get(tx.accountId);
        const usdPer = tx.fxSnapshot?.usdPer ?? rates.data?.usdPer;
        const converted = currency && usdPer ? convert(tx.amount, currency, displayCurrency, usdPer) : null;
        if (converted != null) {
          if (tx.legacy) {
            if (income) bucket.legacyIncome += converted;
            else bucket.legacyExpense += converted;
          } else if (income) bucket.income += converted;
          else bucket.expense += converted;
        }
      }
      byMonth.set(month, bucket);
    }
    const months = [...byMonth.entries()].map(([month, b]) => ({ month, ...b, net: b.income - b.expense }));

    // "now" first, then recent history, with the future after it — landing on
    // a ledger full of next year's planned rows helps nobody
    const rank = (month: string) => (month === thisMonth ? 0 : month < thisMonth ? 1 : 2);
    months.sort((a, b) => {
      const ra = rank(a.month);
      const rb = rank(b.month);
      if (ra !== rb) return ra - rb;
      // past: nearest first; future: nearest first
      return ra === 2 ? (a.month < b.month ? -1 : 1) : a.month < b.month ? 1 : -1;
    });

    const byYear = new Map<string, typeof months>();
    for (const m of months) {
      const year = m.month.slice(0, 4);
      byYear.set(year, [...(byYear.get(year) ?? []), m]);
    }
    // years inherit the order their first month landed in
    return [...byYear.entries()];
  }, [filtered, accounts.data, rates.data, displayCurrency, thisMonth, book]);

  // history collapses by default: only the current year is open on arrival
  const currentYear = thisMonth.slice(0, 4);
  const [collapseInit, setCollapseInit] = useState(false);
  if (!collapseInit && collapseHistory.loaded && groups.length > 0) {
    setCollapseInit(true);
    if (collapseHistory.value) {
      setCollapsed(new Set(groups.map(([year]) => year).filter((year) => year !== currentYear)));
    }
  }

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long" });

  if (accounts.isLoading || transactions.isLoading || categories.isLoading) return <Spinner />;

  return (
    <div className={`mx-auto space-y-4 ${columns === 1 ? "max-w-5xl 3xl:max-w-7xl" : "max-w-none"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("tx.title")}</h1>
        <div className="flex items-center gap-2">
          <ColumnsToggle columns={columns} onChange={setColumns} />
          <Button onClick={() => setTransferModal(true)}>⇄ {t("tx.newTransfer")}</Button>
          <Button variant="primary" onClick={() => setTxModal(true)}>
            + {t("tx.newTransaction")}
          </Button>
        </div>
      </div>

      {tabs}

      <div className="flex flex-wrap gap-2">
        <Select className="!w-auto" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">
            {t("tx.filterAccount")}: {t("common.all")}
          </option>
          {/* cards have their own page: nothing on them is listed here */}
          {(accounts.data ?? [])
            .filter((a) => a.kind !== "credit_card")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
        <Select className="!w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as never)}>
          <option value="all">
            {t("tx.filterStatus")}: {t("common.all")}
          </option>
          <option value="planned">{t("tx.planned")}</option>
          <option value="completed">{t("tx.completed")}</option>
        </Select>
        <Select className="!w-auto" value={filterDirection} onChange={(e) => setFilterDirection(e.target.value as never)}>
          <option value="all">
            {t("tx.filterDirection")}: {t("common.all")}
          </option>
          <option value="income">{t("tx.income")}</option>
          <option value="expense">{t("tx.expense")}</option>
        </Select>
        <button onClick={() => setLatestFirst(!latestFirst)} className="text-xs text-teal-600 hover:underline">
          {latestFirst ? t("portfolio.sortLatest") : t("portfolio.sortOldest")} ⇅
        </button>
      </div>

      {filterStatus === "planned" && overduePlanned.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--edge)] bg-[var(--edge-soft)] px-4 py-2.5 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">{t("legacy.overdueCount", { count: overduePlanned.length })}</span>
          <Button
            disabled={!rates.data || bulkLegacy.isPending}
            onClick={() => {
              if (window.confirm(t("legacy.bulkConfirm", { count: overduePlanned.length }))) {
                bulkLegacy.mutate(overduePlanned.map((tx) => tx.id));
              }
            }}
          >
            {t("legacy.bulkComplete")}
          </Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState>{t("tx.empty")}</EmptyState>
      ) : (
        groups.map(([year, months]) => {
          const yearCollapsed = collapsed.has(year);
          const yearNet = months.reduce((s, m) => s + m.net, 0);
          const yearLegacy = months.reduce((s, m) => s + m.legacyIncome - m.legacyExpense, 0);
          return (
            <div key={year} className="space-y-3">
              <button onClick={() => toggleCollapsed(year)} className="flex w-full flex-wrap items-center gap-2 text-left">
                <span className="text-lg font-bold">{yearCollapsed ? "▸" : "▾"} {year}</span>
                <span className={`text-sm font-semibold tabular-nums ${yearNet >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {yearNet >= 0 ? "+" : "−"}{formatAmount(Math.abs(yearNet), displayCurrency, locale)}
                </span>
                {yearLegacy !== 0 ? (
                  <Badge tone="zinc">
                    {t("legacy.badge")} {yearLegacy >= 0 ? "+" : "−"}
                    {formatAmount(Math.abs(yearLegacy), displayCurrency, locale)}
                  </Badge>
                ) : null}
              </button>
              {yearCollapsed ? null : (
                <div className={columnClass(columns)}>
                  {months.map(({ month, items, income, expense, net, legacyIncome, legacyExpense }) => {
                    const monthCollapsed = collapsed.has(month);
                    return (
                      <Card key={month}>
                        <button
                          onClick={() => toggleCollapsed(month)}
                          className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-[var(--edge-soft)] px-4 py-2.5 text-left"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            <span>{monthCollapsed ? "▸" : "▾"}</span>
                            {monthLabel(month)}
                            <span className="font-normal text-zinc-400">{items.length}</span>
                          </span>
                          <span className="text-xs tabular-nums text-zinc-500">
                            <span className="text-green-600">+{formatAmount(income, displayCurrency, locale)}</span>
                            {" − "}
                            <span className="text-red-600">{formatAmount(expense, displayCurrency, locale)}</span>
                            {" = "}
                            <span className={`font-semibold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {net >= 0 ? "+" : "−"}{formatAmount(Math.abs(net), displayCurrency, locale)}
                            </span>
                            {legacyIncome !== 0 || legacyExpense !== 0 ? (
                              // imported history is kept out of the net above, so it gets
                              // its own line rather than silently disappearing
                              <span className="ml-2 text-zinc-400">
                                · {t("legacy.badge")}{" "}
                                {legacyIncome !== 0 ? `+${formatAmount(legacyIncome, displayCurrency, locale)}` : ""}
                                {legacyIncome !== 0 && legacyExpense !== 0 ? " / " : ""}
                                {legacyExpense !== 0 ? `−${formatAmount(legacyExpense, displayCurrency, locale)}` : ""}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {monthCollapsed ? null : (
                          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {items
                              .filter((tx) => tx.transferGroupId == null || tx.direction === "expense")
                              .map((tx) => (
                              <TxRow
                                key={tx.id}
                                tx={tx}
                                counterpart={
                                  tx.transferGroupId ? transferLegs.get(tx.transferGroupId) : undefined
                                }
                                landingAccount={
                                  tx.transferGroupId
                                    ? accountById.get(transferLegs.get(tx.transferGroupId)?.accountId ?? "")
                                    : undefined
                                }
                                account={accountById.get(tx.accountId)}
                                category={tx.categoryId ? categoryById.get(tx.categoryId) : null}
                                fmtDate={fmtDate}
                                hasRates={Boolean(rates.data)}
                                onComplete={() => setCompleting(tx)}
                                onEdit={() => setEditing(tx)}
                                onToggleLegacy={() => toggleLegacy.mutate({ id: tx.id, legacy: !tx.legacy })}
                                onReopen={() => reopenTx.mutate(tx.id)}
                                onDelete={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(tx.id)}
                                onCardPayment={
                                  canBeCardPayment(tx, accounts.data ?? []) ? () => setConverting(tx) : undefined
                                }
                                cardPayment={book.roleOf(tx) === "payment"}
                              />
                            ))}
                          </ul>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <TransactionModal open={txModal} onClose={() => setTxModal(false)} />

      <TransferModal open={transferModal} onClose={() => setTransferModal(false)} />

      <ConvertToCardPaymentModal key={converting?.id ?? "none"} tx={converting} onClose={() => setConverting(null)} />
      <CompleteModal
        tx={completing}
        accountCurrency={completing ? accountById.get(completing.accountId)?.currency : undefined}
        onClose={() => setCompleting(null)}
        onConfirm={async (amount, legacy) => {
          if (completing) await completeTx.mutateAsync({ id: completing.id, amount, legacy });
          setCompleting(null);
        }}
      />

      <EditModal
        tx={editing}
        // an adjustment corrects a bank or cash balance; on a card it would
        // turn into a charge under the card rules, so cards aren't offered
        accounts={(accounts.data ?? []).filter((a) => !a.archived && !(editing?.adjustment && a.kind === "credit_card"))}
        categories={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (editing) await updateTx.mutateAsync({ id: editing.id, patch });
          setEditing(null);
        }}
      />
    </div>
  );
}

function TxRow({
  tx,
  counterpart,
  landingAccount,
  account,
  category,
  fmtDate,
  hasRates,
  onComplete,
  onEdit,
  onToggleLegacy,
  onReopen,
  onDelete,
  onCardPayment,
  cardPayment,
}: {
  tx: Transaction;
  /** the other half of a transfer — the leg that lands, and where */
  counterpart?: Transaction;
  landingAccount?: Account;
  account: Account | undefined;
  category: Category | null | undefined;
  fmtDate: (iso: string) => string;
  hasRates: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onToggleLegacy: () => void;
  onReopen: () => void;
  onDelete: () => void;
  /** offered on a planned expense that could be a card's statement */
  onCardPayment?: () => void;
  /** a payment into a card: the spending, so it reads as an expense */
  cardPayment?: boolean;
}) {
  const { t, locale } = useI18n();
  if (!account) return null;
  const isTransfer = tx.transferGroupId != null && !cardPayment;
  const landing = landingAccount;
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${tx.status === "planned" ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {tx.description || category?.name || (isTransfer ? t("tx.transfer") : "—")}
          </span>
          {isTransfer ? <Badge tone="sky">{t("tx.transfer")}</Badge> : null}
          {cardPayment ? <Badge tone="red">{t("tx.cardPayment")}</Badge> : null}
          {category && !isTransfer ? (
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: category.color }}
            >
              {category.name}
            </span>
          ) : null}
          {tx.status === "planned" ? <Badge tone="amber">{t("tx.planned")}</Badge> : null}
          {tx.legacy ? <Badge tone="zinc">{t("legacy.badge")}</Badge> : null}
          {tx.adjustment ? <Badge tone="violet">{t("adjust.badge")}</Badge> : null}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {/* one line for the whole move, not one per leg */}
          {(isTransfer || cardPayment) && landing ? `${account.name} → ${landing.name}` : account.name} · {fmtDate(tx.dueDate)}
        </div>
      </div>
      <div
        className={`text-right text-sm font-semibold tabular-nums ${
          isTransfer ? "text-zinc-500" : tx.direction === "income" ? "text-green-600" : "text-red-600"
        }`}
      >
        {isTransfer ? "" : tx.direction === "income" ? "+" : "−"}
        {formatAmount(tx.amount, account.currency, locale)}
        {isTransfer && landing && landing.currency !== account.currency && counterpart ? (
          <span className="block text-[11px] font-normal text-zinc-400">
            → {formatAmount(counterpart.amount, landing.currency, locale)}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        {onCardPayment ? (
          <Button variant="ghost" title={t("tx.toCardPayment")} aria-label={t("tx.toCardPayment")} onClick={onCardPayment}>
            💳
          </Button>
        ) : null}
        {tx.status === "planned" ? (
          <Button variant="primary" disabled={!hasRates} onClick={onComplete}>
            {t("tx.complete")}
          </Button>
        ) : !isTransfer ? (
          <>
            <Button
              variant="ghost"
              title={tx.legacy ? t("legacy.unmark") : t("legacy.mark")}
              onClick={onToggleLegacy}
            >
              {tx.legacy ? "↩" : "🗄"}
            </Button>
            <Button variant="ghost" onClick={onReopen}>
              {t("tx.reopen")}
            </Button>
          </>
        ) : null}
        {!isTransfer && !cardPayment ? (
          <Button variant="ghost" aria-label={t("tx.editTitle")} title={t("tx.editTitle")} onClick={onEdit}>
            ✎
          </Button>
        ) : null}
        <Button variant="ghost" aria-label={t("common.delete")} onClick={onDelete}>
          ✕
        </Button>
      </div>
    </li>
  );
}
