"use client";

import Link from "next/link";
import { ReactNode, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { PlanCard } from "@/components/plannerCard";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories } from "@/lib/data/queries";
import { NewLoan } from "@/lib/data/repo";
import { Loan, LoanKind } from "@/lib/data/types";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import {
  BSMV_CONSUMER_PCT,
  buildSchedule,
  effectiveAnnualPct,
  KKDF_CONSUMER_PCT,
  SCHEDULE_KINDS,
  ScheduleInput,
  ScheduleKind,
  scheduleForInstallment,
} from "@/lib/domain/loanSchedule";
import { LOAN_TAXES_KEY, useLocalToggle } from "@/lib/prefs";
import { todayISO } from "@/lib/domain/recurrence";
import { LoanRatePicker } from "@/components/loanRatePicker";
import { TrackedLoansCard } from "@/components/debtsPanel";
import { useI18n } from "@/lib/i18n";
import { loanHref } from "@/lib/ui/portfolioUrl";

/**
 * The loan simulator, the Plan page's Loan simulator tab (/planner?tab=loan):
 * any loan's instalment, interest, levies and schedule before you sign, and
 * "Track this loan" to file the one you took. Tracked loans themselves live
 * in the Portfolio's Debts view (/accounts?view=debts; /loans redirects
 * there); beside the simulator is the list of them, each a link there.
 * `tabs` is the page's tab strip, shown under its title.
 */
export function LoanSimulator({ tabs }: { tabs: ReactNode }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const [trackOpen, setTrackOpen] = useState(false);
  // the loan just tracked from here, so the page can say where it went
  const [justTracked, setJustTracked] = useState<Loan | null>(null);

  // simulator state
  const [principal, setPrincipal] = useState("1000000");
  const [rate, setRate] = useState("2.89");
  const [term, setTerm] = useState("120");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [kind, setKind] = useState<LoanKind>("house");
  const [startDate, setStartDate] = useState(todayISO());
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("annuity");
  // Turkish consumer credit carries both levies; commercial pays BSMV only.
  // They stay off and out of sight until asked for: a bank's quoted
  // installment already includes them, and that can be typed in instead.
  const taxes = useLocalToggle(LOAN_TAXES_KEY, false);
  const [kkdf, setKkdf] = useState(String(KKDF_CONSUMER_PCT));
  const [bsmv, setBsmv] = useState(String(BSMV_CONSUMER_PCT));
  const kkdfPct = taxes.value ? Number(kkdf) || 0 : 0;
  const bsmvPct = taxes.value ? Number(bsmv) || 0 : 0;
  const [customText, setCustomText] = useState("");
  // the installment on the bank's offer, when it isn't what the calculator says
  const [offerText, setOfferText] = useState("");

  const createLoan = useAppMutation((input: NewLoan) => repo.createLoan(input), [
    KEYS.loans,
    KEYS.templates,
    KEYS.transactions,
  ]);

  /** "12.500, 12.500, 40.000" — one payment per line or comma, as written. */
  const customInstalments = useMemo(
    () =>
      customText
        .split(/[\n,;]+/)
        .map((piece) => Number(piece.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")))
        .filter((n) => Number.isFinite(n) && n > 0),
    [customText]
  );

  // what the calculator makes of the inputs
  const calculatorInput = useMemo<ScheduleInput | null>(() => {
    const p = Number(principal);
    const r = Number(rate);
    const n = scheduleKind === "custom" ? customInstalments.length : Math.floor(Number(term));
    if (!(p > 0) || !(r >= 0) || !(n > 0) || n > 600) return null;
    return {
      kind: scheduleKind,
      principal: p,
      monthlyRatePct: r,
      termMonths: n,
      startDate,
      currency,
      kkdfPct,
      bsmvPct,
      customInstalments,
    };
  }, [principal, rate, term, startDate, currency, scheduleKind, kkdfPct, bsmvPct, customInstalments]);
  const calculated = useMemo(() => (calculatorInput ? buildSchedule(calculatorInput) : null), [calculatorInput]);

  // A bank's installment replaces the calculator's: the loan is simulated and
  // tracked at the rate that installment implies (lib/domain/loanSchedule.ts).
  const offer = Number(offerText);
  const usesOffer = scheduleKind === "annuity" && offerText.trim() !== "" && offer > 0;
  const offerInput = useMemo(
    () => (usesOffer && calculatorInput ? scheduleForInstallment(calculatorInput, offer) : null),
    [usesOffer, calculatorInput, offer]
  );
  const offerInvalid = usesOffer && calculatorInput != null && offerInput == null;
  const input = offerInput ?? calculatorInput;
  const sim = useMemo(() => (offerInput ? buildSchedule(offerInput) : calculated), [offerInput, calculated]);
  const effectiveApr = input ? effectiveAnnualPct(input) : 0;
  const fmtRate = (pct: number) => pct.toLocaleString(locale, { maximumFractionDigits: 4 });

  /** Turn whatever the schedule is now into a custom one, one line per payment, to edit any of them. */
  const editEachInstallment = () => {
    if (!sim || !input) return;
    setRate(String(Number(input.monthlyRatePct.toFixed(8))));
    setCustomText(sim.rows.map((row) => row.payment).join("\n"));
    setScheduleKind("custom");
    setOfferText("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]">
      <h1 className="text-xl font-bold">{t("nav.planner")}</h1>
      {tabs}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* simulator */}
        <PlanCard id="loan-simulator" title={t("loans.simulator")}>
          <div className="space-y-3">
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

            <LoanRatePicker
              currency={currency}
              amount={Number(principal) || 0}
              termMonths={Math.floor(Number(term)) || 0}
              onPick={(picked) => {
                setRate(picked.monthlyRatePct.toFixed(2));
                setOfferText("");
              }}
            />

            <Field label={t("loans.scheduleKind")} hint={t(`loans.kindHint_${scheduleKind}`)}>
              <Select value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value as ScheduleKind)}>
                {SCHEDULE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`loans.kind_${k}`)}
                  </option>
                ))}
              </Select>
            </Field>

            {scheduleKind === "custom" ? (
              <Field
                label={t("loans.customInstalments")}
                hint={t("loans.customHint", { count: customInstalments.length })}
              >
                <Textarea
                  rows={4}
                  value={customText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomText(e.target.value)}
                  placeholder={"12500\n12500\n40000"}
                />
              </Field>
            ) : null}

            {/* the levies are why a bank's quote never matches a plain
                annuity calculator; they are editable because commercial
                credit pays BSMV only, and the statutory rates move */}
            {scheduleKind !== "zeroInterest" ? (
              <>
                <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                  <input
                    type="checkbox"
                    checked={taxes.value}
                    onChange={(e) => taxes.setValue(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-teal-600"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t("loans.taxesToggle")}</span>
                    <span className="block text-xs text-zinc-500">{t("loans.taxesToggleHint")}</span>
                  </span>
                </label>
                {taxes.value ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("loans.kkdf")} hint={t("loans.kkdfHint")}>
                      <Input type="number" step="0.5" min="0" max="100" value={kkdf} onChange={(e) => setKkdf(e.target.value)} />
                    </Field>
                    <Field label={t("loans.bsmv")} hint={t("loans.bsmvHint")}>
                      <Input type="number" step="0.5" min="0" max="100" value={bsmv} onChange={(e) => setBsmv(e.target.value)} />
                    </Field>
                  </div>
                ) : null}
              </>
            ) : null}

            {scheduleKind === "annuity" ? (
              <Field
                label={t("loans.offerInstallment")}
                hint={
                  offerInvalid
                    ? t("loans.offerTooLow", {
                        amount: formatAmount(Number(principal), currency, locale),
                        count: calculatorInput?.termMonths ?? 0,
                      })
                    : offerInput
                      ? t("loans.offerImplied", { rate: fmtRate(offerInput.monthlyRatePct), quoted: fmtRate(Number(rate)) })
                      : t("loans.offerHint")
                }
              >
                <Input
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={offerText}
                  placeholder={calculated ? String(calculated.installment) : ""}
                  onChange={(e) => setOfferText(e.target.value)}
                  aria-invalid={offerInvalid || undefined}
                />
              </Field>
            ) : null}

            {sim ? (
              <>
                <div className="pocket-cols-2 grid grid-cols-3 gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60 pocket:[&_.text-lg]:text-base">
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
                  {sim.totalTaxes > 0 ? (
                    <div>
                      <div className="text-xs text-zinc-500">{t("loans.totalTaxes")}</div>
                      <div className="text-lg font-bold tabular-nums text-red-600">
                        {formatAmount(sim.totalTaxes, currency, locale)}
                      </div>
                    </div>
                  ) : null}
                  {effectiveApr > 0 ? (
                    <div>
                      <div className="text-xs text-zinc-500">{t("loans.effectiveApr")}</div>
                      <div className="text-lg font-bold tabular-nums">{effectiveApr.toFixed(1)}%</div>
                    </div>
                  ) : null}
                  {!sim.level ? (
                    <div>
                      <div className="text-xs text-zinc-500">{t("loans.varies")}</div>
                      <div className="text-sm font-medium tabular-nums">
                        {formatAmount(sim.rows.at(-1)!.payment, currency, locale)}
                      </div>
                    </div>
                  ) : null}
                </div>
                <Button variant="primary" className="w-full" disabled={offerInvalid} onClick={() => setTrackOpen(true)}>
                  {t("loans.startTracking")}
                </Button>
                <details>
                  <summary className="cursor-pointer text-sm text-zinc-500">{t("loans.schedule")}</summary>
                  {scheduleKind !== "custom" ? (
                    <Button variant="ghost" className="mt-2" onClick={editEachInstallment}>
                      {t("loans.editEachInstallment")}
                    </Button>
                  ) : null}
                  <div className="pocket-unscroll mt-2 max-h-64 overflow-y-auto">
                    <table className="stack-sm sticky-head w-full text-xs tabular-nums pocket:max-sm:[&_tr]:grid! pocket:max-sm:[&_tr]:grid-cols-2 pocket:max-sm:[&_tr]:gap-x-5 pocket:max-sm:[&_td]:flex-wrap pocket:max-sm:[&_td]:gap-y-0! pocket:max-sm:[&_td]:border-0! pocket:max-sm:[&_td]:py-1! pocket:max-sm:[&_td:not(:first-child)]:justify-end! pocket:max-sm:[&_td:not(:first-child)::before]:mr-auto pocket:max-sm:[&_td:first-child]:col-span-2 pocket:max-sm:[&_td:first-child]:justify-start! pocket:max-sm:[&_td:first-child]:font-semibold">
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
        </PlanCard>

        {/* what's tracked already: each opens in the Portfolio's Debts view */}
        <div className="space-y-4">
          {justTracked ? (
            <p role="status" className="rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:bg-teal-950 dark:text-teal-200">
              {t("pages.trackedNow", { name: justTracked.name })}{" "}
              <Link href={loanHref(justTracked.id)} className="font-medium underline">
                {t("pages.openInDebts")}
              </Link>
            </p>
          ) : null}
          <TrackedLoansCard />
        </div>
      </div>

      <TrackModal
        open={trackOpen}
        onClose={() => setTrackOpen(false)}
        defaults={{
          kind,
          currency,
          principal: Number(principal),
          // a bank's installment brings the rate it implies
          monthlyRatePct: input?.monthlyRatePct ?? Number(rate),
          termMonths: input?.termMonths ?? Math.floor(Number(term)),
          startDate,
          // the shape you simulated is the shape that gets tracked; dropping
          // it here would quietly file every loan as a plain annuity
          scheduleKind,
          kkdfPct,
          bsmvPct,
          customInstalments: scheduleKind === "custom" ? customInstalments : null,
        }}
        onConfirm={async (input) => {
          setJustTracked((await createLoan.mutateAsync(input)) as Loan);
          setTrackOpen(false);
        }}
      />
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
  defaults: Pick<
    NewLoan,
    | "kind"
    | "currency"
    | "principal"
    | "monthlyRatePct"
    | "termMonths"
    | "startDate"
    | "scheduleKind"
    | "kkdfPct"
    | "bsmvPct"
    | "customInstalments"
  >;
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
