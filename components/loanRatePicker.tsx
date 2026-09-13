"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Currency } from "@/lib/domain/currencies";
import { LoanOffer } from "@/lib/domain/loanRates";
import { useI18n } from "@/lib/i18n";

type RateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; offers: LoanOffer[]; source: string; kind: "average" | "offers"; asOf: string | null }
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
export function LoanRatePicker({
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
      if (data.status === "ok") {
        setState({
          status: "ok",
          offers: data.offers as LoanOffer[],
          source: String(data.source ?? ""),
          kind: data.kind === "offers" ? "offers" : "average",
          asOf: data.asOf ?? null,
        });
      }
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
        <>
        <p className="mt-2 text-xs text-zinc-500">
          {state.kind === "average" ? t("loans.ratesAverage") : t("loans.ratesOffers")}
          {state.asOf ? ` · ${state.asOf}` : ""}
        </p>
        <ul className="mt-1 max-h-48 divide-y divide-[var(--edge-soft)] overflow-y-auto">
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
        </>
      ) : null}
    </div>
  );
}
