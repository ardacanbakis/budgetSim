"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useLoans, useRates, useTransactions } from "@/lib/data/queries";
import { NewLoan } from "@/lib/data/repo";
import { Loan, LoanKind } from "@/lib/data/types";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { computeBalances } from "@/lib/domain/balances";
import { computeDebtOverview } from "@/lib/domain/debt";
import { amortizationSchedule } from "@/lib/domain/loan";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

export default function LoansPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const loans = useLoans();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const { displayCurrency } = useApp();
  const [trackOpen, setTrackOpen] = useState(false);

  // simulator state
  const [principal, setPrincipal] = useState("1000000");
  const [rate, setRate] = useState("2.89");
  const [term, setTerm] = useState("120");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [kind, setKind] = useState<LoanKind>("house");
  const [startDate, setStartDate] = useState(todayISO());

  const createLoan = useAppMutation((input: NewLoan) => repo.createLoan(input), [
    KEYS.loans,
    KEYS.templates,
    KEYS.transactions,
  ]);
  const deleteLoan = useAppMutation((id: string) => repo.deleteLoan(id), [KEYS.loans, KEYS.templates, KEYS.transactions]);

  const sim = useMemo(() => {
    const p = Number(principal);
    const r = Number(rate);
    const n = Math.floor(Number(term));
    if (!(p > 0) || !(r >= 0) || !(n > 0) || n > 600) return null;
    return amortizationSchedule(p, r, n, startDate, currency);
  }, [principal, rate, term, startDate, currency]);

  if (loans.isLoading || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const balances = computeBalances(accounts.data ?? [], transactions.data ?? []);
  const overview = rates.data
    ? computeDebtOverview({
        loans: loans.data ?? [],
        accounts: accounts.data ?? [],
        balances,
        transactions: transactions.data ?? [],
        usdPer: rates.data.usdPer,
        display: displayCurrency,
        today: todayISO(),
      })
    : null;
  const cardItems = overview?.items.filter((i) => i.kind === "card") ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]">
      <h1 className="text-xl font-bold">{t("nav.loans")}</h1>

      {overview && overview.items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs text-zinc-500">
              {t("debt.totalDebt")} ({displayCurrency})
            </div>
            <div className="mt-1 text-2xl font-bold text-red-600 tabular-nums">
              {formatAmount(overview.totalInDisplay, displayCurrency, locale)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-zinc-500">{t("debt.debtFree")}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{overview.debtFreeDate ?? "—"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-zinc-500">{t("debt.avalanche")}</div>
            <div className="mt-1 truncate text-lg font-bold">
              {overview.avalancheTarget ? `${overview.avalancheTarget.name} (%${overview.avalancheTarget.monthlyRatePct} ${t("debt.perMonth")})` : "—"}
            </div>
          </Card>
        </div>
      ) : null}

      {cardItems.length > 0 ? (
        <Card>
          <CardHeader title={t("debt.cards")} />
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {cardItems.map((item) => {
              const posted = -(balances.get(item.id) ?? 0);
              const upcoming = item.outstanding - Math.max(0, posted);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">💳 {item.name}</span>
                  <span className="tabular-nums text-zinc-500">
                    <span className="font-semibold text-red-600">{formatAmount(Math.max(0, posted), item.currency, locale)}</span>{" "}
                    {t("debt.posted")}
                    {upcoming > 0 ? (
                      <>
                        {" "}
                        + {formatAmount(upcoming, item.currency, locale)} {t("debt.upcoming")}
                      </>
                    ) : null}
                    {item.endDate ? ` · ${t("debt.debtFree").toLowerCase()}: ${item.endDate}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* simulator */}
        <Card>
          <CardHeader title={t("loans.simulator")} />
          <div className="space-y-3 p-4">
            <p className="text-xs text-zinc-500">{t("loans.compareHint")}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label={t("loans.principal")}>
                <Input type="number" step="any" min="0" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
              </Field>
              <Field label={t("loans.monthlyRate")}>
                <Input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
              <Field label={t("loans.termMonths")}>
                <Input type="number" step="1" min="1" max="600" value={term} onChange={(e) => setTerm(e.target.value)} />
              </Field>
              <Field label={t("common.currency")}>
                <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  {CURRENCIES.filter((c) => c !== "BTC" && c !== "XAU_G").map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("loans.kind")}>
                <Select value={kind} onChange={(e) => setKind(e.target.value as LoanKind)}>
                  <option value="house">{t("loans.house")}</option>
                  <option value="car">{t("loans.car")}</option>
                  <option value="other">{t("loans.other")}</option>
                </Select>
              </Field>
              <Field label={t("loans.firstPayment")}>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </div>

            {sim ? (
              <>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                  <div>
                    <div className="text-xs text-zinc-500">{t("loans.installment")}</div>
                    <div className="text-lg font-bold tabular-nums">{formatAmount(sim.installment, currency, locale)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">{t("loans.totalPayback")}</div>
                    <div className="text-lg font-bold tabular-nums">{formatAmount(sim.totalPaid, currency, locale)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">{t("loans.totalInterest")}</div>
                    <div className="text-lg font-bold tabular-nums text-red-600">{formatAmount(sim.totalInterest, currency, locale)}</div>
                  </div>
                </div>
                <Button variant="primary" className="w-full" onClick={() => setTrackOpen(true)}>
                  {t("loans.startTracking")}
                </Button>
                <details>
                  <summary className="cursor-pointer text-sm text-zinc-500">{t("loans.schedule")}</summary>
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    <table className="stack-sm sticky-head w-full text-xs tabular-nums">
                      <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                        <tr className="text-left text-zinc-400">
                          <th className="py-1 pr-2 font-medium">#</th>
                          <th className="py-1 pr-2 font-medium">{t("common.date")}</th>
                          <th className="py-1 pr-2 text-right font-medium">{t("loans.installment")}</th>
                          <th className="py-1 pr-2 text-right font-medium">{t("loans.totalInterest")}</th>
                          <th className="py-1 text-right font-medium">{t("loans.remaining")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sim.rows.map((row) => (
                          <tr key={row.n} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-2" data-label="#">{row.n}</td>
                            <td className="py-1 pr-2" data-label={t("common.date")}>{row.date}</td>
                            <td className="py-1 pr-2 text-right" data-label={t("loans.installment")}>{row.payment.toLocaleString(locale)}</td>
                            <td className="py-1 pr-2 text-right" data-label={t("loans.totalInterest")}>{row.interest.toLocaleString(locale)}</td>
                            <td className="py-1 text-right" data-label={t("loans.remaining")}>{row.remaining.toLocaleString(locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : null}
            <p className="text-xs text-zinc-400">{t("loans.offersMissing")}</p>
          </div>
        </Card>

        {/* tracked loans */}
        <Card>
          <CardHeader title={t("loans.tracked")} />
          <div className="space-y-3 p-4">
            {(loans.data ?? []).length === 0 ? (
              <EmptyState>{t("loans.empty")}</EmptyState>
            ) : (
              (loans.data ?? []).map((loan) => (
                <TrackedLoan
                  key={loan.id}
                  loan={loan}
                  paidCount={
                    (transactions.data ?? []).filter((tx) => tx.loanId === loan.id && tx.status === "completed").length
                  }
                  displayCurrency={displayCurrency}
                  usdPer={rates.data?.usdPer}
                  onDelete={() => {
                    if (window.confirm(t("loans.deleteWarning"))) deleteLoan.mutate(loan.id);
                  }}
                />
              ))
            )}
          </div>
        </Card>
      </div>

      <TrackModal
        open={trackOpen}
        onClose={() => setTrackOpen(false)}
        defaults={{ kind, currency, principal: Number(principal), monthlyRatePct: Number(rate), termMonths: Math.floor(Number(term)), startDate }}
        onConfirm={async (input) => {
          await createLoan.mutateAsync(input);
          setTrackOpen(false);
        }}
      />
    </div>
  );
}

function TrackedLoan({
  loan,
  paidCount,
  displayCurrency,
  usdPer,
  onDelete,
}: {
  loan: Loan;
  paidCount: number;
  displayCurrency: Currency;
  usdPer?: import("@/lib/domain/fx").UsdPerMap;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const schedule = useMemo(
    () => amortizationSchedule(loan.principal, loan.monthlyRatePct, loan.termMonths, loan.startDate, loan.currency),
    [loan]
  );
  const paid = Math.min(paidCount, loan.termMonths);
  const remaining = paid > 0 ? schedule.rows[paid - 1].remaining : loan.principal;
  const pct = Math.round((paid / loan.termMonths) * 100);
  const converted = usdPer && loan.currency !== displayCurrency ? convert(remaining, loan.currency, displayCurrency, usdPer) : null;

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{loan.name}</span>
            <Badge tone="sky">{t(`loans.${loan.kind}`)}</Badge>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {formatAmount(loan.installment, loan.currency, locale)}/{t("recurring.monthly").toLowerCase()} · %{loan.monthlyRatePct} · {loan.termMonths} {t("loans.termMonths").toLowerCase()}
          </div>
        </div>
        <Button variant="ghost" onClick={onDelete}>
          ✕
        </Button>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span>{t("loans.progress", { paid, term: loan.termMonths })}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-zinc-500">{t("loans.remaining")}</span>
          <span className="font-semibold tabular-nums">
            {formatAmount(remaining, loan.currency, locale)}
            {converted != null ? <span className="ml-1 text-xs font-normal text-zinc-400">≈ {formatAmount(converted, displayCurrency, locale)}</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function TrackModal({
  open,
  onClose,
  defaults,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  defaults: Pick<NewLoan, "kind" | "currency" | "principal" | "monthlyRatePct" | "termMonths" | "startDate">;
  onConfirm: (input: NewLoan) => Promise<void>;
}) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [autoComplete, setAutoComplete] = useState(false);

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const sameCurrency = active.filter((a) => a.currency === defaults.currency);
  const options = sameCurrency.length > 0 ? sameCurrency : active;
  const account = options.find((a) => a.id === accountId) ?? options[0];
  const loanCategory = (categories.data ?? []).find((c) => c.direction === "expense" && c.name.toLowerCase().includes("loan"));

  return (
    <Modal open={open} onClose={onClose} title={t("loans.startTracking")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!account) return;
          await onConfirm({
            ...defaults,
            name: name || `${t(`loans.${defaults.kind}`)} loan`,
            accountId: account.id,
            categoryId: loanCategory?.id ?? null,
            autoComplete,
          });
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="House loan — Ziraat" />
        </Field>
        <Field label={t("loans.paymentAccount")}>
          <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
          <span>
            <span className="block text-sm font-medium">{t("recurring.autoComplete")}</span>
            <span className="block text-xs text-zinc-500">{t("recurring.autoCompleteHint")}</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!account}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
