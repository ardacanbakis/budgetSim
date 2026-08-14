"use client";

import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { PlanRecord } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { buildSavingsPlan, normalizeSavingsBody, SavingsPlan } from "@/lib/domain/savingsFinance";
import { ExtraFlow } from "@/lib/domain/projector";
import { monthsBetween } from "@/lib/domain/planner";
import { useI18n } from "@/lib/i18n";

/**
 * Turn a saved savings-finance scenario into hypothetical flows for the
 * projector: the cash due on signing day, then every month's instalment plus
 * whatever organization fee falls that month.
 *
 * Ephemeral by design. Nothing here writes a transaction, materializes a
 * template, or touches the database — toggling a plan off leaves the
 * projection exactly as it was, because the overlay only ever existed as an
 * argument to a pure function.
 */
export function savingsOverlayFlows(plan: SavingsPlan, months: number, firstMonth: string): ExtraFlow[] {
  const flows: ExtraFlow[] = [];
  const signingOffset = monthsBetween(firstMonth, plan.input.startDate.slice(0, 7));

  const signing = plan.cashAtSigning;
  if (signing > 0 && signingOffset >= 0 && signingOffset < months) {
    flows.push({
      monthOffset: signingOffset,
      direction: "expense",
      amount: signing,
      currency: "TRY",
      accountId: null,
      categoryId: "",
      label: "",
    });
  }

  for (const row of plan.rows) {
    const offset = monthsBetween(firstMonth, row.date.slice(0, 7));
    if (offset < 0 || offset >= months) continue;
    flows.push({
      monthOffset: offset,
      direction: "expense",
      amount: row.cashOut,
      currency: "TRY",
      accountId: null,
      categoryId: "",
      label: "",
    });
  }
  return flows;
}

/**
 * The planner's one hook into savings finance: a list of saved scenarios with
 * a switch each. The toggle state lives in the planner's own React state and
 * is deliberately not persisted — this is "what would this do to my year",
 * not a commitment.
 */
export function SavingsOverlayCard({
  plans,
  enabled,
  onToggle,
  today,
}: {
  plans: PlanRecord[];
  enabled: string[];
  onToggle: (id: string) => void;
  today: string;
}) {
  const { t, locale } = useI18n();

  return (
    <Card>
      <CardHeader
        title={t("savings.overlayTitle")}
        action={
          <Link href="/savings" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
            {t("savings.overlayOpen")}
          </Link>
        }
      />
      {plans.length === 0 ? (
        <div className="p-4">
          <EmptyState action={
            <Link href="/savings" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
              {t("savings.overlayOpen")}
            </Link>
          }>
            {t("savings.overlayEmpty")}
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--edge-soft)]">
          {plans.map((record) => {
            const built = buildSavingsPlan(normalizeSavingsBody(record.body, today).input);
            const on = enabled.includes(record.id);
            return (
              <li key={record.id} className={`flex items-center gap-3 px-4 py-2.5 ${on ? "" : "opacity-60"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={on}
                  aria-label={record.name}
                  onChange={() => onToggle(record.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{record.name}</span>
                    {built.deliveryDate ? (
                      <Badge tone="green">{built.deliveryDate}</Badge>
                    ) : (
                      <Badge tone="red">{t("savings.overlayNoDelivery")}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {t("savings.overlayLine", {
                      first: formatAmount(built.rows[0]?.instalment ?? 0, "TRY", locale),
                      months: built.termMonths,
                    })}
                  </div>
                </div>
                <span className="tnum shrink-0 text-sm font-semibold text-red-600 dark:text-red-400">
                  −{formatAmount(built.cashAtSigning, "TRY", locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-[var(--edge-soft)] px-4 py-2 text-xs text-zinc-500">
        {t("savings.overlayEphemeral")}
      </p>
    </Card>
  );
}
