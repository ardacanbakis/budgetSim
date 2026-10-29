"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, usePlans, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { Loan } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { loanProgress } from "@/lib/domain/debt";
import { PayoffOption, PayoffSuggestion, suggestPayoff } from "@/lib/domain/debtPayoff";
import { goldRatiosOf } from "@/lib/domain/gold";
import { normalizePlan, planFundingOrder, shortThreshold } from "@/lib/domain/planner";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { monthLabel } from "@/lib/ui/pocket/dayGroups";
import { SELECTED_KEY } from "@/lib/usePlanScenarios";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * suggestPayoff (lib/domain/debtPayoff.ts) for one debt, with the funding
 * order and routine accounts of the plan open on Plan (the one this device
 * last picked, else the first), so "selling" means what it means there.
 */
export function usePayoffSuggestion(loan: Loan | null): PayoffSuggestion | null {
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const rates = useRates();
  const plans = usePlans();
  return useMemo(() => {
    if (!loan || loan.direction !== "owe" || !accounts.data || !transactions.data || !templates.data || !rates.data || !plans.data) return null;
    const today = todayISO();
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(SELECTED_KEY);
    } catch {
      // no storage: the first plan
    }
    const record = plans.data.find((p) => p.id === remembered) ?? plans.data[0];
    const plan = normalizePlan(record?.body ?? null, today.slice(0, 7));
    const drawable = accounts.data.filter((a) => !a.archived && a.kind !== "credit_card").map((a) => a.id);
    return suggestPayoff({
      loan,
      accounts: accounts.data,
      transactions: transactions.data,
      templates: templates.data,
      usdPer: rates.data.usdPer,
      goldRatios: goldRatiosOf(rates.data),
      display: displayCurrency,
      today,
      funding: { order: planFundingOrder(plan, drawable), routine: plan.funding?.routine ?? [] },
      threshold: shortThreshold(displayCurrency, rates.data.usdPer),
    });
  }, [loan, accounts.data, transactions.data, templates.data, rates.data, plans.data, displayCurrency]);
}

/**
 * "When can you repay it?" on a debt you owe: the first month without
 * selling anything, and an earlier one if you'd sell, each with a button that
 * plans the payment on its date; once a date is planned, the way back.
 */
export function PayoffSuggestionCard({ loan }: { loan: Loan }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const transactions = useTransactions();
  const accounts = useAccounts();
  const suggestion = usePayoffSuggestion(loan);
  const setDate = useAppMutation((date: string | null) => repo.updateLoan(loan.id, { payoffDate: date }), [KEYS.loans, KEYS.transactions, KEYS.templates]);

  if (loan.direction !== "owe") return null;
  const { remaining } = loanProgress(loan, transactions.data ?? []);
  if (remaining <= 0.005) return null;
  const once = loan.scheduleKind === "lumpSum";
  const money = (n: number) => formatAmount(n, loan.currency, locale);
  const accountName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "—";

  const option = (o: PayoffOption, selling: boolean) => (
    <li className="space-y-1.5 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60" data-payoff-option={selling ? "selling" : "without"}>
      <p className="text-sm font-medium">
        {selling ? t("debts.suggestIfSelling", { month: monthLabel(o.month, locale) }) : t("debts.suggestWithout", { month: monthLabel(o.month, locale) })}
      </p>
      <p className="text-xs text-zinc-500">
        {t("debts.suggestWithoutAmount", { amount: money(o.amount), date: fmtDate(o.date) })}
        {o.sells.length > 0
          ? ` · ${t("debts.suggestSells", { what: o.sells.map((s) => `${formatAmount(s.amount, s.currency, locale)} ${accountName(s.accountId)}`).join(", ") })}`
          : ""}
      </p>
      <Button variant={selling ? "secondary" : "primary"} disabled={setDate.isPending} onClick={() => setDate.mutate(o.date)}>
        {once ? t("debts.planIt", { date: fmtDate(o.date) }) : t("debts.payOffEarly", { date: fmtDate(o.date) })}
      </Button>
    </li>
  );

  return (
    <section className="space-y-2 border-t border-[var(--edge-soft)] p-4" data-payoff>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("debts.suggestTitle")}</h3>
      {loan.payoffDate ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{t("debts.suggestPaid", { date: fmtDate(loan.payoffDate) })}</span>
          <Button variant="ghost" disabled={setDate.isPending} onClick={() => setDate.mutate(null)}>
            {once ? t("debts.clearDate") : t("debts.clearPayoff")}
          </Button>
        </div>
      ) : null}
      {suggestion == null ? null : suggestion.withoutSelling == null && suggestion.ifSelling == null ? (
        <p className="text-sm text-zinc-500">{t("debts.suggestNone")}</p>
      ) : (
        <ul className="space-y-2">
          {suggestion.withoutSelling ? option(suggestion.withoutSelling, false) : null}
          {suggestion.ifSelling ? option(suggestion.ifSelling, true) : null}
        </ul>
      )}
      <p className="text-[11px] text-zinc-400">{t("debts.suggestHint")}</p>
    </section>
  );
}
