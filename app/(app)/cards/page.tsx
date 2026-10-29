"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCardEstimates, useCategories, usePurchases, useRates, useTransactions } from "@/lib/data/queries";
import { NewPurchase } from "@/lib/data/repo";
import { Account, Purchase } from "@/lib/data/types";
import { buildCardBook, cardSchedule, chargeAmount, estimateTopUps, NextCardPayment, nextCardPayment } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import {
  buildInstallmentPlan,
  cardStandings,
  buildPurchaseTransactionSpecs,
  defaultFirstDue,
  findOverlappingCharges,
  lastDueDate,
  purchaseProgress,
} from "@/lib/domain/purchases";
import { averageMonthlySpend } from "@/lib/domain/stats";
import { CARDS_TAB_KEY, useLocalChoice } from "@/lib/prefs";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { AccountModal } from "@/app/(app)/accounts/page";
import { ViewSwitcher } from "@/components/viewSwitcher";
import { useSurfaceView } from "@/lib/ui/useViews";
import { todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { ColumnsToggle, columnClass, useColumns } from "@/components/columns";
import { pocketable } from "@/components/pocket/pocketable";
import { CardDetailsModal, PurchaseDetailsModal } from "@/components/cardDetails";

const PocketCards = dynamic(() => import("@/components/pocket/cards").then((m) => m.PocketCards), {
  ssr: false,
  loading: () => <Spinner />,
});

export default pocketable(PurchasesPage, PocketCards);

const PURCHASE_KEYS = [KEYS.purchases, KEYS.transactions, KEYS.accounts];
const TABS = ["cards", "purchases"] as const;

function PurchasesPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const purchases = usePurchases();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const rates = useRates();
  const [modalOpen, setModalOpen] = useState(false);
  const [paying, setPaying] = useState<Account | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [editingCard, setEditingCard] = useState<Account | null>(null);
  // the card or purchase whose details are open
  const [detailsCard, setDetailsCard] = useState<Account | null>(null);
  const [detailsPurchase, setDetailsPurchase] = useState<Purchase | null>(null);
  const { columns, setColumns } = useColumns("renovator-cols-purchases");
  const purchaseColumns = useColumns("renovator-cols-bigpurchases", 2);
  const view = useSurfaceView("cards");
  const tab = useLocalChoice<(typeof TABS)[number]>(CARDS_TAB_KEY, TABS, "cards");

  const updateAccount = useAppMutation(
    (v: { id: string; patch: Parameters<typeof repo.updateAccount>[1] }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts]
  );
  const setArchived = useAppMutation(
    (v: { id: string; archived: boolean }) => repo.updateAccount(v.id, { archived: v.archived }),
    [KEYS.accounts]
  );

  // what each card is owed and which payment covers what (lib/domain/cards.ts)
  const estimates = useCardEstimates();
  const book = useMemo(
    () => buildCardBook(accounts.data ?? [], transactions.data ?? [], estimates.data),
    [accounts.data, transactions.data, estimates.data]
  );

  const stats = useMemo(() => {
    if (!accounts.data || !transactions.data || !categories.data || !rates.data) return null;
    return averageMonthlySpend({
      transactions: transactions.data,
      accounts: accounts.data,
      categories: categories.data,
      usdPer: rates.data.usdPer,
      display: displayCurrency,
      windowMonths: 3,
      today: todayISO(),
    });
  }, [accounts.data, transactions.data, categories.data, rates.data, displayCurrency]);

  if (purchases.isLoading || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const accountList = accounts.data ?? [];
  const cards = accountList.filter((a) => a.kind === "credit_card" && !a.archived);
  const retired = (accounts.data ?? []).filter((a) => a.kind === "credit_card" && a.archived);
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const standings = new Map(cardStandings(accountList, book, today).map((s) => [s.account.id, s]));
  // the latest payments first, made or still to make
  const recentPayments = (cardId: string) => [...book.payments(cardId)].reverse().slice(0, 6);
  // what a payment recorded now would cover: charges from before this month no payment covers yet
  const coversFor = (cardId: string) => book.wouldCover(cardId, thisMonth);
  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
      month: "short",
      year: "2-digit",
    });
  // when the next statement is due: its payment day, or the month when the card has none
  const nextWhen = (next: NextCardPayment) => (next.date ? fmtDate(next.date) : monthLabel(next.month));
  const byAccount = new Map<string | null, Purchase[]>();
  for (const p of purchases.data ?? []) {
    const key = p.accountId;
    byAccount.set(key, [...(byAccount.get(key) ?? []), p]);
  }
  const nonCardPurchases = (purchases.data ?? []).filter(
    (p) => !p.accountId || !cards.some((c) => c.id === p.accountId)
  );

  function renderPurchase(purchase: Purchase, account: Account | undefined) {
    const currency = account?.currency ?? "TRY";
    const progress = purchaseProgress(purchase, book, transactions.data ?? [], currency);
    const isInstallment = purchase.installmentCount > 1;
    const pct = isInstallment && purchase.reflected ? Math.round((progress.paidCount / progress.totalCount) * 100) : 0;
    return (
      <button
        key={purchase.id}
        type="button"
        onClick={() => setDetailsPurchase(purchase)}
        aria-label={`${purchase.name} — ${t("cards.openDetails")}`}
        data-purchase={purchase.name}
        className="w-full rounded-lg border border-zinc-200 p-3 text-left transition-colors hover:border-teal-500/60 hover:bg-[var(--edge-soft)] dark:border-zinc-800"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">{purchase.name}</span>
              <Badge tone={purchase.reflected ? "green" : "zinc"}>
                {purchase.reflected ? t("purchases.reflected") : t("purchases.logOnly")}
              </Badge>
              {isInstallment ? (
                <Badge tone="sky">
                  {purchase.installmentCount}× {t("purchases.installments").toLowerCase()}
                </Badge>
              ) : (
                <Badge tone="zinc">{t("purchases.oneShot")}</Badge>
              )}
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatAmount(purchase.amount, currency, locale)}</div>
            <div className="text-xs text-zinc-500">
              {fmtDate(purchase.purchaseDate)}
              {isInstallment
                ? ` · ${formatAmount(buildInstallmentPlan({ amount: purchase.amount, currency, count: purchase.installmentCount, firstDue: purchase.firstDue })[0].amount, currency, locale)} ${t("purchases.perInstallment")} · ${fmtDate(purchase.firstDue)} → ${fmtDate(lastDueDate(purchase.firstDue, purchase.installmentCount))}`
                : ""}
            </div>
            {purchase.details ? <div className="mt-1 text-xs text-zinc-400">{purchase.details}</div> : null}
          </div>
          <span aria-hidden className="shrink-0 text-zinc-400">›</span>
        </div>
        {isInstallment && purchase.reflected ? (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>{t("purchases.progress", { paid: progress.paidCount, total: progress.totalCount })}</span>
              <span>
                {t("purchases.remaining")}: {formatAmount(progress.remainingAmount, currency, locale)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </button>
    );
  }

  // the big purchases grid: one, two or three across, the user's choice
  const purchaseGrid =
    purchaseColumns.columns === 1
      ? "grid gap-3 p-4"
      : purchaseColumns.columns === 2
        ? "grid gap-3 p-4 sm:grid-cols-2"
        : "grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"

  /**
   * Every card on one line. The full cards answer "what is going on with this
   * card"; this answers "which card needs me first", which is a different
   * question and a worse fit for a page of tall cards you have to scroll.
   */
  const cardsTable = (
    <Card>
      <div className="overflow-x-auto">
        <table className="stack-sm w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">{t("cards.title")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("cards.colNextPayment")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("cards.colTotalOwed")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("cards.colLimitLeft")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("cards.colDueIn")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const standing = standings.get(card.id);
              const owed = standing?.owed ?? 0;
              const available = standing?.available ?? null;
              const days = standing?.daysToDue ?? null;
              const next = nextCardPayment(book, card, today);
              return (
                <tr key={card.id} className="border-b border-[var(--edge-soft)]">
                  <td className="px-3 py-1.5 font-medium" data-label={t("cards.title")}>
                    <button type="button" className="text-left hover:underline" onClick={() => setDetailsCard(card)}>
                      {card.name}
                    </button>
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tnum ${next?.date != null && next.date < today ? "text-red-600" : ""}`}
                    data-label={t("cards.colNextPayment")}
                  >
                    {next ? (
                      <>
                        {formatAmount(next.amount, card.currency, locale)}
                        <span className="block text-[11px] text-zinc-400">{nextWhen(next)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tnum text-zinc-500" data-label={t("cards.colTotalOwed")}>
                    {formatAmount(owed, card.currency, locale)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tnum ${available != null && available < 0 ? "text-red-600" : ""}`}
                    data-label={t("cards.colLimitLeft")}
                  >
                    {available != null ? formatAmount(available, card.currency, locale) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tnum" data-label={t("cards.colDueIn")}>
                    {days != null ? days : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button onClick={() => setPaying(card)}>{t("cards.recordPayment")}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div className={`mx-auto space-y-4 ${columns === 1 ? "max-w-5xl 3xl:max-w-7xl" : "max-w-none"}`}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("cards.title")}</h1>
        <div className="flex items-center gap-2">
          <ViewSwitcher
            surface="cards"
            shape={view.shape}
            onShape={view.setShape}
            columns={view.columns}
            onColumns={view.setColumns}
          />
          {tab.value === "purchases" ? (
            <ColumnsToggle columns={purchaseColumns.columns} onChange={purchaseColumns.setColumns} />
          ) : (
            <ColumnsToggle columns={columns} onChange={setColumns} max={2} />
          )}
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + {t("purchases.newPurchase")}
          </Button>
        </div>
      </div>

      {(purchases.data ?? []).length === 0 && cards.length === 0 ? <EmptyState>{t("purchases.empty")}</EmptyState> : null}

      <div role="tablist" aria-label={t("cards.title")} className="flex gap-1 border-b border-[var(--edge)]">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab.value === id}
            onClick={() => tab.setValue(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab.value === id
                ? "border-teal-600 text-teal-700 dark:text-teal-300"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {id === "cards" ? t("cards.tabCards") : t("cards.tabPurchases")}
          </button>
        ))}
      </div>

      {/* big purchases: each installment is paid with that month's card payment, nothing to tick */}
      {tab.value === "purchases" ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">{t("cards.bigPurchasesHint")}</p>
          {(purchases.data ?? []).length === 0 ? <EmptyState>{t("purchases.empty")}</EmptyState> : null}
          {cards
            .filter((card) => (byAccount.get(card.id) ?? []).length > 0)
            .map((card) => (
              <Card key={card.id}>
                <CardHeader title={card.name} />
                <div className={purchaseGrid} data-purchase-grid>
                  {(byAccount.get(card.id) ?? []).map((p) => renderPurchase(p, card))}
                </div>
              </Card>
            ))}
        </div>
      ) : null}

      {tab.value === "cards" && view.shape === "table" ? cardsTable : null}

      <div
        className={
          tab.value !== "cards" || view.shape === "table"
            ? "hidden"
            : view.shape === "grid"
              ? columnClass(view.columns)
              : columnClass(columns)
        }
      >
      {cards.map((card) => {
        const owed = standings.get(card.id)?.owed ?? 0;
        const schedule = cardSchedule(book, card.id, thisMonth);
        const next = nextCardPayment(book, card, today);
        const payments = recentPayments(card.id);
        const bigPurchases = byAccount.get(card.id)?.length ?? 0;
        const avg = stats?.byAccount.get(card.id);
        return (
          <Card key={card.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {card.name}
                  {/* the headline is the next statement; the whole debt comes second */}
                  {next ? (
                    <span title={t("cards.nextPaymentHint")} data-card-next>
                      <Badge tone={next.date != null && next.date < today ? "red" : "amber"}>
                        {t("cards.nextPayment", { amount: formatAmount(next.amount, card.currency, locale), date: nextWhen(next) })}
                        {/* your expectation, not only what's tracked, makes this figure */}
                        {estimateTopUps(book, card.id, next.month).some((u) => u.month === next.month) ? ` · ${t("cards.expectedBadge")}` : null}
                      </Badge>
                    </span>
                  ) : null}
                  {/* payments recorded but not made, plus charges no payment covers yet */}
                  <span title={t("cards.owedHint")} data-card-owed>
                    <Badge tone={owed > 0.005 ? "zinc" : "green"}>
                      {owed <= 0.005
                        ? t("cards.nothingOwed")
                        : schedule.length > 1
                          ? t("cards.totalOwedMonths", { amount: formatAmount(owed, card.currency, locale), count: schedule.length })
                          : t("cards.totalOwed", { amount: formatAmount(owed, card.currency, locale) })}
                    </Badge>
                  </span>
                  {avg ? (
                    <Badge tone="zinc">
                      {t("purchases.avgMonthlySpend")}: {formatAmount(avg, displayCurrency, locale)}
                    </Badge>
                  ) : null}
                  {standings.get(card.id)?.available != null ? (
                    <Badge tone={standings.get(card.id)!.available! < 0 ? "red" : "green"}>
                      {standings.get(card.id)!.available! < 0
                        ? t("cards.limitOver", {
                            amount: formatAmount(-standings.get(card.id)!.available!, card.currency, locale),
                          })
                        : t("cards.limitLeft", {
                            amount: formatAmount(standings.get(card.id)!.available!, card.currency, locale),
                            limit: formatAmount(card.creditLimit ?? 0, card.currency, locale),
                          })}
                    </Badge>
                  ) : null}
                  {card.paymentDay ? (
                    <span className="text-xs font-normal text-zinc-400">
                      {t("accounts.paymentDueOn", { day: card.paymentDay })}
                    </span>
                  ) : null}
                </span>
              }
              action={
                <div className="flex items-center gap-2">
                  {standings.get(card.id)?.idle ? (
                    <Button
                      variant="ghost"
                      title={t("cards.inactiveHint")}
                      onClick={() => setArchived.mutate({ id: card.id, archived: true })}
                    >
                      {t("cards.markInactive")}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setDetailsCard(card)}>
                    {t("cards.openDetails")}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingCard(card)}>
                    {t("common.edit")}
                  </Button>
                  <Button onClick={() => setPaying(card)}>{t("cards.recordPayment")}</Button>
                </div>
              }
            />

            {/* what this card is going to cost you, month by month */}
            {schedule.length ? (
              <div className="border-b border-[var(--edge-soft)] px-4 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  {t("cards.upcomingByMonth")}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {schedule.map(({ month, total }) => (
                    <span key={month} className="text-xs tabular-nums text-zinc-500">
                      {monthLabel(month)}{" "}
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {formatAmount(total, card.currency, locale)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* and what you've paid it, or are about to: each payment is the spending */}
            {payments.length ? (
              <div className="border-b border-[var(--edge-soft)] px-4 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  {t("cards.paymentsMade")}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {payments.map((p) => (
                    <li key={p.groupId} className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-500">{fmtDate(p.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-400">{p.paying.description}</span>
                      {p.made ? null : <Badge tone="amber">{t("tx.planned")}</Badge>}
                      <span className="tabular-nums text-red-600">−{formatAmount(p.amount, card.currency, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {bigPurchases ? (
              <button
                type="button"
                onClick={() => tab.setValue("purchases")}
                className="w-full px-4 py-2 text-left text-xs text-teal-600 hover:underline dark:text-teal-400"
              >
                {bigPurchases === 1 ? t("cards.seeBigPurchasesOne") : t("cards.seeBigPurchases", { count: bigPurchases })} →
              </button>
            ) : null}
          </Card>
        );
      })}
      </div>

      {tab.value === "purchases" && nonCardPurchases.length > 0 ? (
        <Card>
          <CardHeader title={t("purchases.otherAccounts")} />
          <div className={purchaseGrid}>
            {nonCardPurchases.map((p) =>
              renderPurchase(
                p,
                accountList.find((a) => a.id === p.accountId)
              )
            )}
          </div>
        </Card>
      ) : null}

      {retired.length > 0 ? (
        <Card>
          <CardHeader
            title={`${t("cards.inactive")} (${retired.length})`}
            action={
              <Button variant="ghost" onClick={() => setShowRetired((v) => !v)}>
                {showRetired ? t("common.close") : t("cards.showRetired")}
              </Button>
            }
          />
          {showRetired ? (
            <ul className="divide-y divide-[var(--edge-soft)] p-2">
              {retired.map((card) => (
                <li key={card.id} className="flex items-center gap-3 px-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-500">{card.name}</span>
                  <Button onClick={() => setArchived.mutate({ id: card.id, archived: false })}>
                    {t("cards.markActive")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <AccountModal
        open={editingCard != null}
        initial={editingCard}
        onClose={() => setEditingCard(null)}
        onSave={async (input) => {
          if (editingCard) await updateAccount.mutateAsync({ id: editingCard.id, patch: input });
          setEditingCard(null);
        }}
      />

      <PurchaseModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <CardDetailsModal
        key={detailsCard?.id ?? "none"}
        card={detailsCard}
        book={book}
        purchases={purchases.data ?? []}
        transactions={transactions.data ?? []}
        onClose={() => setDetailsCard(null)}
        onPay={(card) => setPaying(card)}
        onOpenPurchase={(p) => {
          setDetailsCard(null);
          setDetailsPurchase(p);
        }}
      />
      <PurchaseDetailsModal
        key={detailsPurchase?.id ?? "none"}
        purchase={detailsPurchase}
        book={book}
        transactions={transactions.data ?? []}
        onClose={() => setDetailsPurchase(null)}
      />
      <CardPaymentModal
        card={paying}
        suggested={paying ? Math.max(0, coversFor(paying.id).reduce((sum, c) => sum + chargeAmount(c), 0)) : 0}
        covers={paying ? coversFor(paying.id) : []}
        onClose={() => setPaying(null)}
      />
    </div>
  );
}

export function PurchaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const transactions = useTransactions();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [hasInstallments, setHasInstallments] = useState(true);
  const [count, setCount] = useState("6");
  const [firstDue, setFirstDue] = useState("");
  const [details, setDetails] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reflected, setReflected] = useState(true);
  const [removeOverlaps, setRemoveOverlaps] = useState(true);

  const createPurchase = useAppMutation(
    (input: NewPurchase) => repo.createPurchase(input, rates.data ? snapshotFromTable(rates.data) : null),
    PURCHASE_KEYS
  );
  const removeCharges = useAppMutation(
    (ids: string[]) => Promise.all(ids.map((id) => repo.deleteTransaction(id))).then(() => undefined),
    PURCHASE_KEYS
  );

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  // cards first — the primary use case
  const ordered = [...active].sort((a, b) => Number(b.kind === "credit_card") - Number(a.kind === "credit_card"));
  const account = ordered.find((a) => a.id === accountId) ?? ordered[0];
  const effectiveFirstDue = firstDue || defaultFirstDue(purchaseDate, account?.kind === "credit_card" ? account.paymentDay : null);
  const parsedCount = Math.max(1, Math.floor(Number(count) || 1));
  const parsedAmount = Number(amount);
  const expenseCategories = (categories.data ?? []).filter((c) => c.direction === "expense");

  const perInstallment =
    account && parsedAmount > 0 && hasInstallments && parsedCount > 1
      ? buildInstallmentPlan({ amount: parsedAmount, currency: account.currency, count: parsedCount, firstDue: effectiveFirstDue })[0].amount
      : null;

  // the same taksit entered before (as a recurring item, say): reflecting this
  // as well would count those months twice
  const overlaps =
    account && reflected && parsedAmount > 0
      ? findOverlappingCharges(
          account.id,
          buildPurchaseTransactionSpecs(
            {
              name,
              amount: parsedAmount,
              installmentCount: hasInstallments ? parsedCount : 1,
              purchaseDate,
              firstDue: hasInstallments ? effectiveFirstDue : purchaseDate,
            },
            account.currency,
            todayISO()
          ),
          transactions.data ?? [],
          account.currency
        )
      : [];

  return (
    <Modal open={open} onClose={onClose} title={t("purchases.newPurchase")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!account || !(parsedAmount > 0)) return;
          await createPurchase.mutateAsync({
            name,
            accountId: account.id,
            amount: parsedAmount,
            purchaseDate,
            installmentCount: hasInstallments ? parsedCount : 1,
            firstDue: hasInstallments ? effectiveFirstDue : purchaseDate,
            details,
            reflected,
            categoryId: categoryId || null,
          });
          if (overlaps.length > 0 && removeOverlaps) await removeCharges.mutateAsync(overlaps.map((c) => c.id));
          setName("");
          setAmount("");
          setDetails("");
          onClose();
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone 17" />
        </Field>
        <Field label={t("purchases.paidWith")}>
          <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kind === "credit_card" ? "💳 " : ""}
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} ${account ? `(${account.currency})` : ""}`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("purchases.purchaseDate")}>
            <Input type="date" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={hasInstallments} onChange={(e) => setHasInstallments(e.target.checked)} />
          <span className="text-sm font-medium">{t("purchases.installments")}</span>
        </label>

        {hasInstallments ? (
          <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("purchases.installmentCount")}>
                <Input type="number" step="1" min="2" max="48" required value={count} onChange={(e) => setCount(e.target.value)} />
              </Field>
              <Field label={t("purchases.firstDue")} hint={account?.kind === "credit_card" ? t("purchases.firstDueHint") : undefined}>
                <Input type="date" value={effectiveFirstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              {perInstallment != null && account
                ? `${formatAmount(perInstallment, account.currency, locale)} ${t("purchases.perInstallment")} · `
                : ""}
              {t("purchases.lastDue")}: {lastDueDate(effectiveFirstDue, parsedCount)}
            </p>
          </div>
        ) : null}

        <Field label={t("common.category")}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("purchases.details")} (${t("common.optional")})`}>
          <Textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>

        <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={reflected} onChange={(e) => setReflected(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">{t("purchases.reflect")}</span>
            <span className="block text-xs text-zinc-500">{t("purchases.reflectHint")}</span>
          </span>
        </label>

        {overlaps.length > 0 && account ? (
          <div data-purchase-overlaps className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium text-amber-800 dark:text-amber-200">{t("purchases.overlapTitle", { count: overlaps.length })}</p>
            <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
              {overlaps.slice(0, 6).map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {c.dueDate} · {c.description || "—"}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatAmount(c.amount, account.currency, locale)}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-600"
                checked={removeOverlaps}
                onChange={(e) => setRemoveOverlaps(e.target.checked)}
              />
              {t("purchases.overlapRemove")}
            </label>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={createPurchase.isPending || removeCharges.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
