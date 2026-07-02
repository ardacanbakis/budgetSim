"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useRates,
  useTransactions,
  useVictvsSessions,
} from "@/lib/data/queries";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { computePurchaseLiability, findDueCardPayments } from "@/lib/domain/purchases";
import { addDays, addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { CardPaymentReminder } from "@/components/cardPaymentReminder";
import { AvgSpendCard } from "@/components/avgSpendCard";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const victvs = useVictvsSessions();
  const rates = useRates();

  const completePlanned = useAppMutation(
    (id: string) => repo.completeTransaction(id, snapshotFromTable(rates.data!)),
    [KEYS.transactions, KEYS.accounts]
  );

  const today = todayISO();

  // computed per render (cheap at personal scale); the React compiler memoizes
  const derived = (() => {
    if (!accounts.data || !transactions.data || !rates.data) return null;
    const balances = computeBalances(accounts.data, transactions.data);
    const rawNetWorth = computeNetWorth(accounts.data, balances, rates.data.usdPer, displayCurrency);
    // remaining reflected installments count as debt now (current stat only —
    // the projector spreads them month by month, so it stays unadjusted)
    const liability = computePurchaseLiability(transactions.data, accounts.data, rates.data.usdPer, displayCurrency);
    const netWorth = { ...rawNetWorth, total: rawNetWorth.total - liability };
    let ccPostedDebt = 0;
    for (const a of accounts.data) {
      if (a.kind !== "credit_card" || a.archived) continue;
      const balance = balances.get(a.id) ?? 0;
      if (balance < 0) {
        const converted = convert(-balance, a.currency, displayCurrency, rates.data.usdPer);
        if (converted != null) ccPostedDebt += converted;
      }
    }
    const duePayments = findDueCardPayments(accounts.data, balances, transactions.data, today);

    const upcoming = transactions.data
      .filter((tx) => tx.status === "planned" && tx.dueDate <= addDays(today, 30))
      .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
      .slice(0, 6);

    // last 6 completed months of income/expense in display currency (transfers excluded)
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (let i = 5; i >= 0; i--) {
      byMonth.set(addMonthsClamped(today, -i).slice(0, 7), { income: 0, expense: 0 });
    }
    const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
    for (const tx of transactions.data) {
      if (tx.status !== "completed" || tx.transferGroupId) continue;
      const bucket = byMonth.get(tx.dueDate.slice(0, 7));
      const currency = currencyOf.get(tx.accountId);
      if (!bucket || !currency) continue;
      // historical figures use the snapshot captured at completion, so they never drift
      const usdPer = tx.fxSnapshot?.usdPer ?? rates.data.usdPer;
      const converted = convert(tx.amount, currency, displayCurrency, usdPer);
      if (converted == null) continue;
      if (tx.direction === "income") bucket.income += converted;
      else bucket.expense += converted;
    }
    const flow = [...byMonth.entries()].map(([month, v]) => ({
      month,
      income: Math.round(v.income * 100) / 100,
      expense: Math.round(v.expense * 100) / 100,
    }));

    return { balances, netWorth, liability, ccPostedDebt, duePayments, upcoming, flow };
  })();

  const unpaidVictvs = sumAmounts(
    "USD",
    (victvs.data ?? []).filter((s) => s.status === "unpaid").map((s) => s.amount)
  );

  if (!derived || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1700px]">
      {derived.duePayments.length > 0 ? <CardPaymentReminder duePayments={derived.duePayments} /> : null}

      {/* stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">
            {t("dashboard.netWorth")} ({displayCurrency})
          </div>
          <div className="mt-1 text-3xl font-bold">{formatAmount(derived.netWorth.total, displayCurrency, locale)}</div>
          {derived.liability > 0 ? (
            <div className="mt-1 text-xs text-zinc-400">
              −{formatAmount(derived.liability, displayCurrency, locale)} {t("purchases.inclInstallments")}
            </div>
          ) : null}
          {derived.netWorth.skippedAccountIds.length > 0 ? (
            <div className="mt-1 text-xs text-amber-600">{t("dashboard.skippedAccounts")}</div>
          ) : null}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">
            {t("purchases.ccDebtTile")} ({displayCurrency})
          </div>
          <div className={`mt-1 text-3xl font-bold ${derived.ccPostedDebt > 0 ? "text-red-600" : ""}`}>
            {formatAmount(derived.ccPostedDebt, displayCurrency, locale)}
          </div>
          {derived.liability > 0 ? (
            <div className="mt-1 text-xs text-zinc-400">
              +{formatAmount(derived.liability, displayCurrency, locale)} {t("purchases.upcomingInstallments").toLowerCase()}
            </div>
          ) : null}
          <Link href="/purchases" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
            {t("dashboard.seeAll")} →
          </Link>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("dashboard.unpaidVictvs")}</div>
          <div className="mt-1 text-3xl font-bold">{formatAmount(unpaidVictvs, "USD", locale)}</div>
          <Link href="/victvs" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
            {t("dashboard.seeAll")} →
          </Link>
        </Card>
        <Card className="p-4 sm:col-span-2 xl:col-span-1">
          <div className="text-xs text-zinc-500">{t("dashboard.accounts")}</div>
          <div className="mt-1 space-y-1">
            {activeAccounts.slice(0, 5).map((a) => (
              <div key={a.id} className="flex justify-between text-sm">
                <span className="truncate text-zinc-600 dark:text-zinc-300">{a.name}</span>
                <span className="font-medium tabular-nums">{formatAmount(derived.balances.get(a.id) ?? 0, a.currency, locale)}</span>
              </div>
            ))}
            {activeAccounts.length === 0 ? (
              <Link href="/accounts" className="text-sm text-teal-600 hover:underline">
                {t("accounts.empty")}
              </Link>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 3xl:grid-cols-4">
        {/* upcoming planned */}
        <Card className="3xl:col-span-1">
          <CardHeader
            title={t("dashboard.upcoming")}
            action={
              <Link href="/transactions" className="text-xs text-teal-600 hover:underline">
                {t("dashboard.seeAll")} →
              </Link>
            }
          />
          {derived.upcoming.length === 0 ? (
            <div className="p-4">
              <EmptyState>{t("dashboard.noUpcoming")}</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {derived.upcoming.map((tx) => {
                const account = accountById.get(tx.accountId);
                if (!account) return null;
                const overdue = tx.dueDate < today;
                return (
                  <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{tx.description || "—"}</div>
                      <div className="text-xs text-zinc-500">
                        {account.name} · {tx.dueDate} {overdue ? <Badge tone="red">!</Badge> : null}
                      </div>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${tx.direction === "income" ? "text-emerald-600" : ""}`}>
                      {tx.direction === "income" ? "+" : "−"}
                      {formatAmount(tx.amount, account.currency, locale)}
                    </span>
                    <Button variant="ghost" disabled={!rates.data} onClick={() => completePlanned.mutate(tx.id)}>
                      ✓ {t("dashboard.complete")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* monthly flow chart */}
        <Card className="3xl:col-span-2">
          <CardHeader title={`${t("dashboard.monthlyFlow")} (${displayCurrency})`} />
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.flow} margin={{ top: 8, right: 12, bottom: 0, left: 8 }} barGap={2}>
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatAmount(Number(v), displayCurrency, locale)} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name={t("dashboard.income")} fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expense" name={t("dashboard.expense")} fill="var(--viz-series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <AvgSpendCard className="xl:col-span-2 3xl:col-span-1" />
      </div>
    </div>
  );
}
