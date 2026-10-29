"use client";

import { useViaCard } from "@/lib/useViaCard";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DebtModal, DeleteDebtModal, RecordDebtPaymentModal } from "@/components/debtModal";
import { EntityChanges } from "@/components/history";
import { HistoryUpcoming } from "@/components/historyUpcoming";
import { PayoffSuggestionCard } from "@/components/payoffSuggestion";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";
import { PlanCard } from "@/components/plannerCard";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useLoans, useRates, useTransactions } from "@/lib/data/queries";
import { Loan, Transaction } from "@/lib/data/types";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { DebtOverview, debtRows, loanProgress, repayingPurchase } from "@/lib/domain/debt";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";
import { loanHref, portfolioHref } from "@/lib/ui/portfolioUrl";
import { replaceQuery } from "@/lib/ui/shallowUrl";

/**
 * What the old Debt page held besides its simulator, now in the Portfolio's
 * Debts view (/accounts?view=debts) on Classic:
 *
 * - DebtSummary: the strip at the top — what's owed in all, the debt-free
 *   date and what to pay off first — with the way to the loan simulator,
 *   where a loan is tracked.
 * - LoanPane: one tracked loan in the right-hand pane (&loan=<id>): what's
 *   left, how far along it is, its schedule with the paid rows ticked, and
 *   Delete.
 * - TrackedLoansCard: the tracked loans as links, beside the simulator on
 *   Plan's Loan simulator tab.
 *
 * Pocket draws its own (components/pocket/loanDetail.tsx). Both read a loan
 * through loanProgress (lib/domain/debt.ts), as computeDebtOverview does.
 */

export const SIMULATOR_HREF = "/planner?tab=loan";

const KIND_ICON: Record<Loan["kind"], string> = { house: "🏠", car: "🚗", other: "📄", personal: "🤝" };

export function loanIcon(loan: Pick<Loan, "kind">): string {
  return KIND_ICON[loan.kind] ?? KIND_ICON.other;
}

export function DebtSummary({ overview, display }: { overview: DebtOverview | null; display: Currency }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const [creating, setCreating] = useState(false);
  const target = overview?.avalancheTarget ?? null;
  return (
    <div className="space-y-3" data-debt-summary>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">
            {t("debt.totalDebt")} ({display})
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-red-600">
            {overview ? formatAmount(overview.totalInDisplay, display, locale) : "—"}
          </div>
          {overview && overview.lentInDisplay > 0 ? (
            <div className="mt-1 text-xs text-zinc-500" data-owed-to-you>
              {t("debts.owedToYou")}: <span className="font-semibold tabular-nums text-green-600">{formatAmount(overview.lentInDisplay, display, locale)}</span>
            </div>
          ) : null}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("debt.debtFree")}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {overview?.debtFreeDate ? fmtDate(overview.debtFreeDate) : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("debt.avalanche")}</div>
          <div className="mt-1 truncate text-lg font-bold">
            {target ? `${target.name} (%${target.monthlyRatePct} ${t("debt.perMonth")})` : "—"}
          </div>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setCreating(true)}>
          + {t("debts.newDebt")}
        </Button>
        {/* a bank loan is tracked from a simulation: the shape you simulated is the shape that's filed */}
        <Link
          href={SIMULATOR_HREF}
          className="inline-flex items-center rounded-lg border border-[var(--edge)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium hover:border-teal-500/40"
        >
          + {t("pages.trackLoan")}
        </Link>
        <Link
          href={SIMULATOR_HREF}
          className="inline-flex items-center px-1 py-1.5 text-sm text-teal-600 hover:underline dark:text-teal-400"
        >
          {t("pages.loanSimulator")} →
        </Link>
      </div>
      <DebtModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => replaceQuery(portfolioHref({ view: "debts", loan: id }))} />
    </div>
  );
}

/** Planned repayments listed under Upcoming; the schedule below has the rest. */
const NEXT_PLANNED = 6;

/**
 * A debt's own rows, as Upcoming and History (or both): the next repayments
 * still planned, soonest first, and what's happened, newest first: repayments
 * made and the money borrowed or lent. Each says what it is without repeating
 * the debt's name. A debt repaid through a card lists that purchase's
 * installments, paid once the card's statement covering them is.
 */
function DebtRows({ loan }: { loan: Loan }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const transactions = useTransactions();
  const accounts = useAccounts();
  const via = useViaCard();
  const { money, repayments: own } = debtRows(loan, transactions.data ?? []);
  const purchase = repayingPurchase(loan, via?.purchases);
  const installments = purchase ? (transactions.data ?? []).filter((r) => r.purchaseId === purchase.id) : [];
  const repayments = [...own, ...installments];
  const isDone = (r: Transaction) => (purchase && via && r.purchaseId === purchase.id ? via.book.isPaid(r) : r.status === "completed");
  const planned = repayments.filter((r) => !isDone(r)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const happened = [...money, ...repayments.filter(isDone)].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const more = planned.length - NEXT_PLANNED;
  const label = (description: string) => {
    const rest = description.startsWith(loan.name) ? description.slice(loan.name.length).trim() : description.trim();
    return rest || t("debts.payment");
  };
  const currencyOf = (id: string) => accounts.data?.find((a) => a.id === id)?.currency ?? loan.currency;
  const nameOf = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "—";
  const row = (r: (typeof happened)[number]) => {
    const isMoney = money.includes(r);
    return (
      <li key={r.id} className="flex items-baseline justify-between gap-2 text-sm" data-debt-row-status={isMoney || isDone(r) ? "completed" : "planned"}>
        <span className="min-w-0 truncate">
          {!isMoney && isDone(r) ? <span aria-label={t("pages.paid")}>✓ </span> : null}
          {isMoney ? (loan.direction === "lent" ? t("debts.moneyLent") : t("debts.moneyBorrowed")) : label(r.description)}
          <span className="ml-2 text-[11px] text-zinc-400">
            {fmtDate(r.dueDate)} · {nameOf(r.accountId)}
          </span>
          {!isMoney && !isDone(r) ? (
            <span className="ml-1.5">
              <Badge tone="zinc">{t("tx.planned")}</Badge>
            </span>
          ) : null}
        </span>
        <span className={`shrink-0 tabular-nums ${r.direction === "income" ? "text-green-600" : ""}`}>
          {r.direction === "income" ? "+" : "−"}
          {formatAmount(r.amount, currencyOf(r.accountId), locale)}
        </span>
      </li>
    );
  };
  return (
    <section className="space-y-1.5 border-t border-[var(--edge-soft)] pt-4" data-debt-rows>
      <h3 className="px-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("debts.payments")}</h3>
      <HistoryUpcoming
        className="pb-4"
        emptyClassName="px-4 py-2 text-xs text-zinc-400"
        historyCount={happened.length}
        upcomingCount={planned.length}
        upcoming={
          <div className="space-y-1.5 px-4 pt-2">
            <ul className="space-y-1">{planned.slice(0, NEXT_PLANNED).map(row)}</ul>
            {more > 0 ? <p className="text-xs text-zinc-400">{t("debts.morePlanned", { count: more })}</p> : null}
          </div>
        }
        history={
          <div className="space-y-1.5 px-4 pt-2">
            {!repayments.some(isDone) ? <p className="text-xs text-zinc-400">{t("debts.noPayments")}</p> : null}
            <ul className="space-y-1">{happened.map(row)}</ul>
          </div>
        }
      />
    </section>
  );
}

export function LoanPane({
  loan,
  display,
  usdPer,
  onDeleted,
}: {
  loan: Loan;
  display: Currency;
  usdPer: UsdPerMap | undefined;
  onDeleted: () => void;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const transactions = useTransactions();
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const via = useViaCard();
  const progress = useMemo(() => loanProgress(loan, transactions.data ?? [], via), [loan, transactions.data, via]);
  const { schedule, paid, term, remaining, pct, endDate, paidAmount, total } = progress;
  const lent = loan.direction === "lent";
  const once = loan.scheduleKind === "lumpSum";
  const converted = usdPer && loan.currency !== display ? convert(remaining, loan.currency, display, usdPer) : null;
  const money = (n: number) => formatAmount(n, loan.currency, locale);
  const sign = lent ? "+" : "−";
  const nameOf = (id: string | null) => (id ? (accounts.data?.find((a) => a.id === id)?.name ?? "—") : null);
  const deposit = nameOf(loan.depositAccountId);
  const pay = nameOf(loan.payAccountId);
  // repaid through a card's installments: the card's statements pay it, nothing here does
  const purchase = repayingPurchase(loan, via?.purchases);

  return (
    <div data-loan-pane={loan.id}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--edge-soft)] p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">
              {loanIcon(loan)} {loan.name}
            </span>
            <Badge tone="sky">{t(`loans.${loan.kind}`)}</Badge>
            <Badge tone={lent ? "green" : "red"}>{lent ? t("debts.lentBadge") : t("debts.oweBadge")}</Badge>
          </div>
          {loan.counterparty && loan.counterparty !== loan.name ? <div className="text-sm text-zinc-500">{loan.counterparty}</div> : null}
          <div className="mt-1 text-xs text-zinc-500">{once || !(loan.monthlyRatePct > 0) ? (lent ? t("debts.leftToGet") : t("debts.leftToPay")) : t("loans.remaining")}</div>
          <div className={`text-3xl font-bold tabular-nums ${lent ? "text-green-600" : "text-red-600"}`} data-debt-remaining>
            {sign}
            {money(remaining)}
          </div>
          {converted != null ? (
            <div className="text-sm tabular-nums text-zinc-400">
              ≈ {sign}
              {formatAmount(converted, display, locale)}
            </div>
          ) : null}
          <div className="mt-1 text-xs text-zinc-500" data-debt-shape>
            {purchase
              ? t("debts.viaCardLine", { purchase: purchase.name, card: nameOf(purchase.accountId) ?? "—" })
              : once
              ? loan.payoffDate
                ? t("debts.repayOn", { date: fmtDate(loan.payoffDate) })
                : t("debts.whenICan")
              : `${money(loan.installment)}/${t("recurring.monthly").toLowerCase()} · %${loan.monthlyRatePct} ${t("debt.perMonth")} · ${t("planner.runwayMonths", { count: term })}`}
          </div>
          {deposit || pay ? (
            <div className="text-xs text-zinc-400">{t("debts.accounts", { deposit: deposit ?? "—", pay: pay ?? "—" })}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {purchase ? null : (
            <Button variant="primary" onClick={() => setRecording(true)}>
              {lent ? t("debts.recordBack") : t("debts.recordPayment")}
            </Button>
          )}
          <Button onClick={() => setEditing(true)}>{t("common.edit")}</Button>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            {t("common.delete")}
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-4">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>
            {purchase
              ? t("debts.viaCardProgress", { paid, term, amount: money(paidAmount), total: money(total) })
              : once || !(loan.monthlyRatePct > 0)
              ? t("debts.paidSoFar", { paid: money(paidAmount), total: money(total) })
              : t("loans.progress", { paid, term })}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className={`h-full rounded-full ${lent ? "bg-green-600" : "bg-teal-600"}`} style={{ width: `${pct}%` }} />
        </div>
        {term > 0 && !purchase ? (
          <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
            <span>
              {t("loans.firstPayment")}: {schedule.rows[0] ? fmtDate(schedule.rows[0].date) : "—"}
            </span>
            <span>
              {t("pages.lastPayment")}: {endDate ? fmtDate(endDate) : "—"}
            </span>
          </div>
        ) : null}
      </div>

      <PayoffSuggestionCard loan={loan} />
      <DebtRows loan={loan} />

      {once || term === 0 || purchase ? null : (
        <div className="max-h-[50vh] overflow-y-auto border-t border-[var(--edge-soft)] px-4 pb-3">
          <table className="stack-sm sticky-head w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-[var(--surface)]">
              <tr className="text-left text-zinc-400">
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-2 font-medium">{t("common.date")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{t("loans.installment")}</th>
                <th className="py-1.5 text-right font-medium">{t("loans.remaining")}</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((row) => {
                const done = row.n <= paid;
                return (
                  <tr key={row.n} data-paid={done || undefined} className={`border-t border-[var(--edge-soft)] ${done ? "text-zinc-400" : ""}`}>
                    <td className="py-1 pr-2" data-label="#">
                      {done ? <span aria-label={t("pages.paid")}>✓ </span> : null}
                      {row.n}
                    </td>
                    <td className="py-1 pr-2" data-label={t("common.date")}>
                      {fmtDate(row.date)}
                    </td>
                    <td className="py-1 pr-2 text-right" data-label={t("loans.installment")}>
                      {money(row.payment)}
                    </td>
                    <td className="py-1 text-right" data-label={t("loans.remaining")}>
                      {money(row.remaining)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--edge-soft)] p-4">
        <EntityChanges entityType="loan" entityId={loan.id} />
      </div>

      <DebtModal open={editing} onClose={() => setEditing(false)} editing={loan} />
      <RecordDebtPaymentModal loan={loan} open={recording} onClose={() => setRecording(false)} />
      <DeleteDebtModal loan={loan} open={deleting} onClose={() => setDeleting(false)} onDeleted={onDeleted} />
    </div>
  );
}

/** The tracked loans, each a link to its place in the Portfolio's Debts view. */
export function TrackedLoansCard() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const loans = useLoans();
  const transactions = useTransactions();
  const via = useViaCard();
  const rates = useRates();
  const usdPer = rates.data?.usdPer;

  return (
    // the Plan page's frame: it sits beside the simulator on Plan's loan tab
    <PlanCard
      id="loan-tracked"
      title={t("loans.tracked")}
      actions={
        <Link href={loanHref()} className="text-xs text-teal-600 hover:underline dark:text-teal-400">
          {t("pages.seeInPortfolio")} →
        </Link>
      }
    >
      {loans.isLoading || transactions.isLoading ? (
        <Spinner />
      ) : (loans.data ?? []).length === 0 ? (
        <EmptyState>{t("loans.empty")}</EmptyState>
      ) : (
        <ul className="-my-3 divide-y divide-[var(--edge-soft)]">
          {(loans.data ?? []).map((loan) => {
            const { remaining, paid, term, pct } = loanProgress(loan, transactions.data ?? [], via);
            const converted = usdPer && loan.currency !== displayCurrency ? convert(remaining, loan.currency, displayCurrency, usdPer) : null;
            return (
              <li key={loan.id}>
                <Link href={loanHref(loan.id)} className="-mx-2 block rounded-lg px-2 py-3 hover:bg-[var(--edge-soft)]">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {loanIcon(loan)} {loan.name}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600">
                      −{formatAmount(remaining, loan.currency, locale)}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <span>{t("loans.progress", { paid, term })}</span>
                    {converted != null ? <span className="tabular-nums">≈ −{formatAmount(converted, displayCurrency, locale)}</span> : null}
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span className="block h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PlanCard>
  );
}
