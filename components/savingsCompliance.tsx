"use client";

import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { formatAmount } from "@/lib/domain/currencies";
import { SavingsFinanceInput, SavingsPlan, StepRatePct } from "@/lib/domain/savingsFinance";
import {
  maxCompliantStepRate,
  maxContractValue,
  minCompliantInstalment,
} from "@/lib/domain/savingsFinanceSolvers";
import { useI18n } from "@/lib/i18n";

/**
 * The four BDDK rules, and — when one breaks — the three ways out, each
 * costed. A violation that only tells you it's a violation leaves you guessing
 * which of five inputs to nudge; these write straight back into the form, so
 * the fix is one click and you can see immediately what it costs you.
 */
export function SavingsCompliancePanel({
  plan,
  onApply,
}: {
  plan: SavingsPlan;
  onApply: (patch: Partial<SavingsFinanceInput>) => void;
}) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatAmount(n, "TRY", locale);
  const c = plan.compliance;

  // only computed when something is actually broken — each of these builds a
  // few hundred plans, and there is no reason to pay for that on a valid form
  const fixes = c.ok
    ? null
    : {
        instalment: minCompliantInstalment(plan.input),
        stepRate: maxCompliantStepRate(plan.input),
        contract: maxContractValue({
          ...plan.input,
          monthlyBudget: plan.input.firstInstalment,
        })?.contractValue ?? null,
      };

  const rules = [
    {
      key: "deliveryThreshold",
      rule: c.deliveryThreshold,
      detail: plan.deliveryPeriod
        ? t("savings.ruleDeliveryOk", { period: plan.deliveryPeriod, date: plan.deliveryDate! })
        : t("savings.ruleDeliveryFail"),
    },
    {
      key: "oneThirdRule",
      rule: c.oneThirdRule,
      detail: t("savings.ruleThirdDetail", {
        spread: Number.isFinite(c.oneThirdRule.actual) ? c.oneThirdRule.actual.toFixed(4) : "∞",
        min: money(plan.minInstalment),
        max: money(plan.maxInstalment),
      }),
    },
    {
      key: "maxTerm",
      rule: c.maxTerm,
      detail: t("savings.ruleTermDetail", { actual: c.maxTerm.actual, limit: c.maxTerm.limit }),
    },
    {
      key: "contractCap",
      rule: c.contractCap,
      detail: t("savings.ruleCapDetail", { limit: money(c.contractCap.limit) }),
    },
  ] as const;

  return (
    <Card>
      <CardHeader
        title={t("savings.complianceTitle")}
        action={
          <Badge tone={c.ok ? "green" : "red"}>{c.ok ? t("savings.compliant") : t("savings.nonCompliant")}</Badge>
        }
      />
      <ul className="divide-y divide-[var(--edge-soft)]">
        {rules.map(({ key, rule, detail }) => (
          <li key={key} className="flex items-start gap-3 px-4 py-2.5">
            <span aria-hidden className={rule.ok ? "text-emerald-600" : "text-red-600"}>
              {rule.ok ? "✓" : "✕"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t(`savings.rule_${key}`)}</div>
              <div className="text-xs text-zinc-500">{detail}</div>
            </div>
          </li>
        ))}
      </ul>

      {c.highValue ? (
        <p className="border-t border-[var(--edge-soft)] px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t("savings.highValue")}
        </p>
      ) : null}

      {fixes ? (
        <div className="space-y-2 border-t border-[var(--edge-soft)] p-4">
          <p className="text-xs text-zinc-500">{t("savings.fixesHint")}</p>
          <div className="flex flex-wrap gap-2">
            {fixes.instalment != null && fixes.instalment !== plan.input.firstInstalment ? (
              <Button onClick={() => onApply({ firstInstalment: fixes.instalment! })}>
                {t("savings.fixInstalment", { amount: money(fixes.instalment) })}
              </Button>
            ) : null}
            {fixes.stepRate != null && fixes.stepRate !== plan.input.stepRatePct ? (
              <Button onClick={() => onApply({ stepRatePct: fixes.stepRate as StepRatePct })}>
                {t("savings.fixStepRate", { rate: fixes.stepRate })}
              </Button>
            ) : null}
            {fixes.contract != null && fixes.contract < plan.input.contractValue ? (
              <Button onClick={() => onApply({ contractValue: fixes.contract! })}>
                {t("savings.fixContract", { amount: money(fixes.contract) })}
              </Button>
            ) : null}
          </div>
          {fixes.instalment == null && fixes.stepRate == null && fixes.contract == null ? (
            <p className="text-xs text-red-600 dark:text-red-400">{t("savings.noFix")}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
