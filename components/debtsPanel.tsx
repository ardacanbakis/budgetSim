"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useLoans, useRates, useTransactions } from "@/lib/data/queries";
import { Loan } from "@/lib/data/types";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { DebtOverview, loanProgress } from "@/lib/domain/debt";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";
import { loanHref } from "@/lib/ui/portfolioUrl";

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

const KIND_ICON: Record<Loan["kind"], string> = { house: "🏠", car: "🚗", other: "📄" };

export function loanIcon(loan: Pick<Loan, "kind">): string {
  return KIND_ICON[loan.kind] ?? KIND_ICON.other;
}

export function DebtSummary({ overview, display }: { overview: DebtOverview | null; display: Currency }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
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
        {/* a loan is tracked from a simulation: the shape you simulated is the shape that's filed */}
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
    </div>
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
  const repo = useRepo();
  const transactions = useTransactions();
  const deleteLoan = useAppMutation((id: string) => repo.deleteLoan(id), [KEYS.loans, KEYS.templates, KEYS.transactions]);
  const progress = useMemo(() => loanProgress(loan, transactions.data ?? []), [loan, transactions.data]);
  const { schedule, paid, term, remaining, pct, endDate } = progress;
  const converted = usdPer && loan.currency !== display ? convert(remaining, loan.currency, display, usdPer) : null;
  const money = (n: number) => formatAmount(n, loan.currency, locale);

  return (
    <div data-loan-pane={loan.id}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--edge-soft)] p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">
              {loanIcon(loan)} {loan.name}
            </span>
            <Badge tone="sky">{t(`loans.${loan.kind}`)}</Badge>
          </div>
          <div className="mt-1 text-xs text-zinc-500">{t("loans.remaining")}</div>
          <div className="text-3xl font-bold tabular-nums text-red-600">−{money(remaining)}</div>
          {converted != null ? (
            <div className="text-sm tabular-nums text-zinc-400">≈ −{formatAmount(converted, display, locale)}</div>
          ) : null}
          <div className="mt-1 text-xs text-zinc-500">
            {money(loan.installment)}/{t("recurring.monthly").toLowerCase()} · %{loan.monthlyRatePct} {t("debt.perMonth")} ·{" "}
            {t("planner.runwayMonths", { count: term })}
          </div>
        </div>
        <Button
          variant="danger"
          disabled={deleteLoan.isPending}
          onClick={async () => {
            if (!window.confirm(t("loans.deleteWarning"))) return;
            await deleteLoan.mutateAsync(loan.id);
            onDeleted();
          }}
        >
          {t("common.delete")}
        </Button>
      </div>

      <div className="space-y-2 p-4">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{t("loans.progress", { paid, term })}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
          <span>
            {t("loans.firstPayment")}: {schedule.rows[0] ? fmtDate(schedule.rows[0].date) : "—"}
          </span>
          <span>
            {t("pages.lastPayment")}: {endDate ? fmtDate(endDate) : "—"}
          </span>
        </div>
      </div>

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
    </div>
  );
}

/** The tracked loans, each a link to its place in the Portfolio's Debts view. */
export function TrackedLoansCard() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const loans = useLoans();
  const transactions = useTransactions();
  const rates = useRates();
  const usdPer = rates.data?.usdPer;

  return (
    <Card>
      <CardHeader
        title={t("loans.tracked")}
        action={
          <Link href={loanHref()} className="text-xs text-teal-600 hover:underline dark:text-teal-400">
            {t("pages.seeInPortfolio")} →
          </Link>
        }
      />
      {loans.isLoading || transactions.isLoading ? (
        <Spinner />
      ) : (loans.data ?? []).length === 0 ? (
        <div className="p-4">
          <EmptyState>{t("loans.empty")}</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--edge-soft)]">
          {(loans.data ?? []).map((loan) => {
            const { remaining, paid, term, pct } = loanProgress(loan, transactions.data ?? []);
            const converted = usdPer && loan.currency !== displayCurrency ? convert(remaining, loan.currency, displayCurrency, usdPer) : null;
            return (
              <li key={loan.id}>
                <Link href={loanHref(loan.id)} className="block px-4 py-3 hover:bg-[var(--edge-soft)]">
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
    </Card>
  );
}
