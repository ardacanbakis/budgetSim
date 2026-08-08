"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import { LoanOffer } from "@/lib/domain/loanRates";
import { addMonthKey, monthsBetween, PlanLoan, planLoanSummary } from "@/lib/domain/planner";
import { useI18n } from "@/lib/i18n";

const uid = () => Math.random().toString(36).slice(2, 10);

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Borrowing, as a what-if.
 *
 * A loan isn't two plan items — the installment is a consequence of the
 * principal, the rate and the term, and typing it in by hand means it stops
 * being right the moment you change your mind about any of them. So the loan
 * is the thing you enter and the timeline is derived.
 */
export function PlanLoansCard({
  loans,
  accounts,
  displayCurrency,
  firstMonth,
  onChange,
}: {
  loans: PlanLoan[];
  accounts: { id: string; name: string; currency: Currency }[];
  displayCurrency: Currency;
  firstMonth: string;
  onChange: (next: PlanLoan[]) => void;
}) {
  const { t, locale } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PlanLoan | null>(null);

  const save = (loan: PlanLoan) => {
    onChange(loans.some((l) => l.id === loan.id) ? loans.map((l) => (l.id === loan.id ? loan : l)) : [...loans, loan]);
    setAdding(false);
    setEditing(null);
  };

  return (
    <>
      <Card>
        <CardHeader
          title={t("planner.loansTitle")}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              + {t("planner.addLoan")}
            </Button>
          }
        />
        {loans.length === 0 ? (
          <div className="p-4">
            <EmptyState>{t("planner.loansEmpty")}</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--edge-soft)]">
            {loans.map((loan) => {
              const s = planLoanSummary(loan);
              // a loan drawn before the horizon is one you already carry
              const alreadyDrawn = monthsBetween(firstMonth, loan.receivedMonth) < 0;
              return (
                <li key={loan.id} className={`px-4 py-3 ${loan.enabled ? "" : "opacity-50"}`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-teal-600"
                      checked={loan.enabled}
                      aria-label={loan.label}
                      onChange={(e) =>
                        onChange(loans.map((l) => (l.id === loan.id ? { ...l, enabled: e.target.checked } : l)))
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{loan.label}</span>
                        <Badge tone="sky">
                          {t("planner.loanRateBadge", { rate: loan.monthlyRatePct.toFixed(2) })}
                        </Badge>
                        <Badge tone="zinc">{t("planner.loanTermBadge", { count: loan.termMonths })}</Badge>
                        {alreadyDrawn ? <Badge tone="amber">{t("planner.loanAlreadyDrawn")}</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {alreadyDrawn
                          ? t("planner.loanCarried")
                          : t("planner.loanReceived", { month: monthLabel(loan.receivedMonth, locale) })}
                        {" · "}
                        {t("planner.loanRuns", {
                          from: monthLabel(loan.firstPaymentMonth, locale),
                          to: monthLabel(s.lastPaymentMonth, locale),
                        })}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                        <span className="text-zinc-500">
                          {t("planner.loanTotalPaid")}{" "}
                          <span className="tnum font-medium text-zinc-700 dark:text-zinc-300">
                            {formatAmount(s.totalPaid, loan.currency, locale)}
                          </span>
                        </span>
                        <span className="text-zinc-500">
                          {t("planner.loanInterest")}{" "}
                          <span className="tnum font-medium text-red-600 dark:text-red-400">
                            {formatAmount(s.totalInterest, loan.currency, locale)}
                          </span>
                        </span>
                        <span className="text-zinc-500">
                          {t("planner.loanApr")}{" "}
                          <span className="tnum font-medium">{s.annualRatePct.toFixed(1)}%</span>
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum text-sm font-semibold text-red-600 dark:text-red-400">
                        −{formatAmount(s.installment, loan.currency, locale)}
                      </div>
                      <div className="text-[10px] text-zinc-400">{t("planner.loanPerMonth")}</div>
                    </div>
                    <Button variant="ghost" aria-label={t("common.edit")} onClick={() => setEditing(loan)}>
                      ✎
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t("common.delete")}
                      onClick={() => onChange(loans.filter((l) => l.id !== loan.id))}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <PlanLoanModal
        open={adding || editing != null}
        initial={editing}
        currency={displayCurrency}
        firstMonth={firstMonth}
        accounts={accounts}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={save}
      />
    </>
  );
}

function PlanLoanModal({
  open,
  initial,
  currency,
  firstMonth,
  accounts,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: PlanLoan | null;
  currency: Currency;
  firstMonth: string;
  accounts: { id: string; name: string; currency: Currency }[];
  onClose: () => void;
  onSave: (loan: PlanLoan) => void;
}) {
  const { t, locale } = useI18n();
  const [label, setLabel] = useState("");
  const [principal, setPrincipal] = useState("");
  const [loanCurrency, setLoanCurrency] = useState<Currency>("TRY");
  const [ratePct, setRatePct] = useState("2.89");
  const [term, setTerm] = useState("24");
  const [receivedMonth, setReceivedMonth] = useState(firstMonth);
  const [firstPaymentMonth, setFirstPaymentMonth] = useState(addMonthKey(firstMonth, 1));
  const [accountId, setAccountId] = useState("");
  const [key, setKey] = useState<string | null>(null);

  // same re-key trick the item modal uses: closing resets, so "Add" is blank
  const target = initial?.id ?? (open ? "new" : "closed");
  if (key !== target) {
    setKey(target);
    setLabel(initial?.label ?? "");
    setPrincipal(initial ? String(initial.principal) : "");
    setLoanCurrency(initial?.currency ?? (currency === "TRY" ? "TRY" : "TRY"));
    setRatePct(initial ? String(initial.monthlyRatePct) : "2.89");
    setTerm(initial ? String(initial.termMonths) : "24");
    setReceivedMonth(initial?.receivedMonth ?? firstMonth);
    setFirstPaymentMonth(initial?.firstPaymentMonth ?? addMonthKey(firstMonth, 1));
    setAccountId(initial?.accountId ?? "");
  }

  // live preview, so the cost of a rate change is visible before you save
  const draft: PlanLoan = {
    id: initial?.id ?? "draft",
    label,
    principal: Number(principal) || 0,
    currency: loanCurrency,
    monthlyRatePct: Number(ratePct) || 0,
    termMonths: Math.max(0, Math.floor(Number(term) || 0)),
    receivedMonth,
    firstPaymentMonth,
    accountId: accountId || null,
    enabled: true,
  };
  const preview = draft.principal > 0 && draft.termMonths > 0 ? planLoanSummary(draft) : null;

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("planner.addLoan")} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!(draft.principal > 0) || !(draft.termMonths > 0)) return;
          onSave({ ...draft, id: initial?.id ?? uid(), label: label.trim() || t("planner.untitledLoan"), enabled: initial?.enabled ?? true });
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("planner.loanNamePlaceholder")} />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("planner.loanPrincipal")}>
            <Input
              type="number"
              step="any"
              min="0"
              required
              inputMode="decimal"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="100000"
            />
          </Field>
          <Field label={t("common.currency")}>
            <Select value={loanCurrency} onChange={(e) => setLoanCurrency(e.target.value as Currency)}>
              {CURRENCIES.filter((c) => c !== "BTC" && c !== "XAU_G").map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("planner.loanRate")} hint={t("planner.loanRateHint")}>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="30"
              required
              inputMode="decimal"
              value={ratePct}
              onChange={(e) => setRatePct(e.target.value)}
            />
          </Field>
          <Field label={t("planner.loanTerm")}>
            <Input
              type="number"
              step="1"
              min="1"
              max="360"
              required
              inputMode="numeric"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </Field>
        </div>

        <LoanRatePicker
          currency={loanCurrency}
          amount={draft.principal}
          termMonths={draft.termMonths}
          onPick={(offer) => {
            setRatePct(offer.monthlyRatePct.toFixed(2));
            if (!label.trim()) setLabel(offer.product ? `${offer.bank} — ${offer.product}` : offer.bank);
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {/* two dates, not one: banks pay out well before the first payment
              falls due, and putting the cash in the wrong month is exactly the
              kind of error a planner is supposed to catch */}
          <Field label={t("planner.loanReceivedMonth")} hint={t("planner.loanReceivedHint")}>
            <Input type="month" required value={receivedMonth} onChange={(e) => setReceivedMonth(e.target.value)} />
          </Field>
          <Field label={t("planner.loanFirstPayment")} hint={t("planner.loanFirstPaymentHint")}>
            <Input
              type="month"
              required
              value={firstPaymentMonth}
              onChange={(e) => setFirstPaymentMonth(e.target.value)}
            />
          </Field>
        </div>

        <Field label={t("planner.loanAccount")} hint={t("planner.loanAccountHint")}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t("planner.landsInAuto")}</option>
            {accounts
              .filter((a) => a.currency === loanCurrency)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>

        {preview ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--edge-soft)] p-3 text-sm sm:grid-cols-4">
            <PreviewStat label={t("planner.loanPerMonth")} value={formatAmount(preview.installment, loanCurrency, locale)} />
            <PreviewStat label={t("planner.loanTotalPaid")} value={formatAmount(preview.totalPaid, loanCurrency, locale)} />
            <PreviewStat
              label={t("planner.loanInterest")}
              value={formatAmount(preview.totalInterest, loanCurrency, locale)}
              tone="neg"
            />
            <PreviewStat label={t("planner.loanApr")} value={`${preview.annualRatePct.toFixed(1)}%`} />
            <div className="col-span-2 text-xs text-zinc-500 sm:col-span-4">
              {t("planner.loanRuns", {
                from: monthLabel(firstPaymentMonth, locale),
                to: monthLabel(preview.lastPaymentMonth, locale),
              })}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: string; tone?: "neg" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`tnum font-semibold ${tone === "neg" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

type RateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; offers: LoanOffer[] }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

/**
 * Current bank rates, fetched on demand rather than on open — this is a
 * metered third-party call, and most of the time you already know the rate
 * you were quoted and are only here to change the term.
 *
 * Lira only: the providers quote the Turkish consumer-loan board, and offering
 * a TRY rate for a dollar loan would be worse than offering nothing.
 */
function LoanRatePicker({
  currency,
  amount,
  termMonths,
  onPick,
}: {
  currency: Currency;
  amount: number;
  termMonths: number;
  onPick: (offer: LoanOffer) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<RateState>({ status: "idle" });

  if (currency !== "TRY") return null;

  const load = async () => {
    setState({ status: "loading" });
    try {
      const params = new URLSearchParams();
      if (amount > 0) params.set("amount", String(Math.round(amount)));
      if (termMonths > 0) params.set("maturity", String(termMonths));
      const res = await fetch(`/api/loan-rates?${params}`);
      const data = await res.json();
      if (data.status === "ok") setState({ status: "ok", offers: data.offers as LoanOffer[] });
      else if (data.status === "unconfigured") setState({ status: "unconfigured" });
      else setState({ status: "error", message: String(data.message ?? "") });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "failed" });
    }
  };

  return (
    <div className="rounded-lg border border-[var(--edge)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("planner.loanLiveRates")}</div>
          <div className="text-xs text-zinc-500">{t("planner.loanLiveRatesHint")}</div>
        </div>
        <Button type="button" onClick={load} disabled={state.status === "loading"}>
          {state.status === "loading" ? t("common.loading") : t("planner.loanFetchRates")}
        </Button>
      </div>

      {state.status === "unconfigured" ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("planner.loanRatesUnconfigured")}</p>
      ) : null}
      {state.status === "error" ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t("planner.loanRatesFailed", { message: state.message })}
        </p>
      ) : null}
      {state.status === "ok" ? (
        <ul className="mt-2 max-h-48 divide-y divide-[var(--edge-soft)] overflow-y-auto">
          {state.offers.map((offer, i) => (
            <li key={`${offer.bank}-${i}`}>
              <button
                type="button"
                onClick={() => onPick(offer)}
                className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-[var(--edge-soft)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{offer.bank}</span>
                  {offer.product ? <span className="block truncate text-xs text-zinc-500">{offer.product}</span> : null}
                </span>
                <span className="tnum shrink-0 font-semibold">{offer.monthlyRatePct.toFixed(2)}%</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
