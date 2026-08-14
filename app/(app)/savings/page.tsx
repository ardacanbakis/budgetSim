"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SavingsChart } from "@/components/savingsChart";
import { SavingsCompliancePanel } from "@/components/savingsCompliance";
import { NumberControl, SavingsSchedule, StepRatePicker } from "@/components/savingsControls";
import { Badge, Button, Card, CardHeader, Field, Figure, Input, Select, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { PlanRecord } from "@/lib/data/types";
import { KEYS, useAppMutation, useSavingsPlans } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import {
  AssetType,
  buildSavingsPlan,
  DEFAULT_SAVINGS_INPUT,
  normalizeSavingsBody,
  SavingsFinanceInput,
  StepRatePct,
} from "@/lib/domain/savingsFinance";
import { applyPreset, presetById, SAVINGS_PRESETS } from "@/lib/domain/savingsFinancePresets";
import {
  instalmentForTargetDelivery,
  latestStartForDelivery,
  maxContractValue,
} from "@/lib/domain/savingsFinanceSolvers";
import { useI18n } from "@/lib/i18n";

type Mode = "priceToBudget" | "budgetToPrice" | "targetDate";

const MODES: Mode[] = ["priceToBudget", "budgetToPrice", "targetDate"];

/**
 * Tasarruf finansman — the Turkish interest-free "evim sistemi".
 *
 * Its own page rather than a tab on the planner, because none of the planner's
 * machinery applies: no interest, no currencies, no FX, and a delivery rule
 * that has nothing to do with cashflow. The only thing it shares with the
 * planner is an optional overlay, and that runs in one direction.
 *
 * Everything on screen is derived from the inputs on every render. Nothing
 * about a schedule is stored, so a change to the rounding rule or a BDDK
 * threshold can never leave a stale plan sitting in the database.
 */
export default function SavingsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const router = useRouter();
  const params = useSearchParams();
  const saved = useSavingsPlans();

  const today = todayISO();
  const [mode, setMode] = useState<Mode>("priceToBudget");
  const [presetId, setPresetId] = useState(SAVINGS_PRESETS[0].id);
  const [input, setInput] = useState<SavingsFinanceInput>({ ...DEFAULT_SAVINGS_INPUT, startDate: today });
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [budget, setBudget] = useState(125_000);
  const [lockDownAsRatio, setLockDownAsRatio] = useState(false);
  const [targetDate, setTargetDate] = useState("");
  const [loadedFromLink, setLoadedFromLink] = useState(false);

  const money = (n: number) => formatAmount(n, "TRY", locale);
  const preset = presetById(presetId);

  const createPlan = useAppMutation(
    (body: { name: string; input: SavingsFinanceInput; presetId: string }) =>
      repo.createSavingsPlan(body.name, { input: body.input, presetId: body.presetId }),
    [KEYS.savingsPlans]
  );
  const updatePlan = useAppMutation(
    (body: { id: string; input: SavingsFinanceInput; presetId: string }) =>
      repo.updateSavingsPlan(body.id, { body: { input: body.input, presetId: body.presetId } }),
    [KEYS.savingsPlans]
  );
  const removePlan = useAppMutation((id: string) => repo.deleteSavingsPlan(id), [KEYS.savingsPlans]);

  // ?plan=<id> opens a saved scenario, so a link is enough to share one
  const linkedId = params.get("plan");
  useEffect(() => {
    if (loadedFromLink || !linkedId || !saved.data) return;
    const record = saved.data.find((p) => p.id === linkedId);
    // deferred: state initializes from the fetched row after first paint
    queueMicrotask(() => {
      setLoadedFromLink(true);
      if (!record) return;
      const body = normalizeSavingsBody(record.body, today);
      setInput(body.input);
      setPresetId(body.presetId);
      setName(record.name);
      setOpenId(record.id);
    });
  }, [linkedId, saved.data, loadedFromLink, today]);

  const plan = useMemo(() => buildSavingsPlan(input), [input]);

  const patch = (next: Partial<SavingsFinanceInput>) => setInput((prev) => ({ ...prev, ...next }));

  // down payment and its ratio are one number wearing two hats; editing either
  // moves the other so they can never disagree on screen
  const downRatioPct = input.contractValue > 0 ? (input.downPayment / input.contractValue) * 100 : 0;
  const setDownRatio = (pct: number) =>
    patch({ downPayment: Math.round((input.contractValue * pct) / 100) });

  // --- mode: budget to price
  const affordable = useMemo(() => {
    if (mode !== "budgetToPrice") return null;
    return maxContractValue({
      ...input,
      monthlyBudget: budget,
      lockDownPaymentAsRatio: lockDownAsRatio,
      downPaymentRatioPct: downRatioPct,
    });
  }, [mode, input, budget, lockDownAsRatio, downRatioPct]);

  // --- mode: from a target delivery date
  const targeted = useMemo(() => {
    if (mode !== "targetDate" || !targetDate) return null;
    return instalmentForTargetDelivery(input, targetDate);
  }, [mode, input, targetDate]);
  const latestStart = targetDate ? latestStartForDelivery(targetDate) : null;
  const latestStartPassed = latestStart != null && latestStart < today;

  // --- what waiting costs
  const delays = useMemo(
    () =>
      [1, 2, 3].map((months) => {
        const startDate = shiftMonths(input.startDate, months);
        const delayed = buildSavingsPlan({ ...input, startDate });
        return { months, startDate, plan: delayed };
      }),
    [input]
  );

  if (saved.isLoading) return <Spinner />;

  const openSaved = (id: string) => {
    const record = saved.data?.find((p) => p.id === id);
    if (!record) return;
    const body = normalizeSavingsBody(record.body, today);
    setInput(body.input);
    setPresetId(body.presetId);
    setName(record.name);
    setOpenId(record.id);
    router.replace(`/savings?plan=${record.id}`);
  };

  const save = async () => {
    const label = name.trim() || t("savings.untitled");
    if (openId) {
      await updatePlan.mutateAsync({ id: openId, input, presetId });
    } else {
      const created = (await createPlan.mutateAsync({ name: label, input, presetId })) as PlanRecord;
      setOpenId(created.id);
      setName(label);
      router.replace(`/savings?plan=${created.id}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("savings.title")}</h1>
          <p className="max-w-2xl text-sm text-zinc-500">{t("savings.subtitle")}</p>
        </div>
        <Badge tone="zinc">TRY</Badge>
      </div>

      {/* saved scenarios + naming */}
      <Card>
        <div className="flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-48 flex-1">
            <Field label={t("savings.planName")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("savings.untitled")} />
            </Field>
          </div>
          {(saved.data ?? []).length > 0 ? (
            <div className="min-w-44">
              <Field label={t("savings.openSaved")}>
                <Select value={openId ?? ""} onChange={(e) => (e.target.value ? openSaved(e.target.value) : null)}>
                  <option value="">{t("savings.newPlan")}</option>
                  {(saved.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
          <Button variant="primary" onClick={save} disabled={createPlan.isPending || updatePlan.isPending}>
            {openId ? t("common.save") : t("savings.saveNew")}
          </Button>
          {openId ? (
            <>
              <Button
                onClick={() => {
                  setOpenId(null);
                  setName("");
                  router.replace("/savings");
                }}
              >
                {t("savings.newPlan")}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm(t("common.confirmDelete"))) return;
                  await removePlan.mutateAsync(openId);
                  setOpenId(null);
                  setName("");
                  router.replace("/savings");
                }}
              >
                {t("common.delete")}
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {/* mode switch */}
      <div className="-mx-1 overflow-x-auto px-1 py-1">
        <div role="tablist" className="flex w-max min-w-full gap-1 rounded-xl bg-[var(--edge-soft)] p-1">
          {MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                mode === m ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t(`savings.mode_${m}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* inputs */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={t("savings.inputsTitle")} />
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("savings.provider")}>
                  <Select
                    value={presetId}
                    onChange={(e) => {
                      setPresetId(e.target.value);
                      setInput((prev) => applyPreset(prev, e.target.value));
                    }}
                  >
                    {SAVINGS_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("savings.assetType")}>
                  <Select
                    value={input.assetType}
                    onChange={(e) => patch({ assetType: e.target.value as AssetType })}
                  >
                    <option value="housing">{t("savings.housing")}</option>
                    <option value="vehicle">{t("savings.vehicle")}</option>
                  </Select>
                </Field>
              </div>

              {mode === "budgetToPrice" ? (
                <NumberControl
                  label={t("savings.monthlyBudget")}
                  value={budget}
                  onChange={setBudget}
                  min={5_000}
                  max={1_000_000}
                  step={1_000}
                  quickPicks={[50_000, 75_000, 100_000, 125_000, 150_000, 200_000]}
                  format={money}
                />
              ) : (
                <NumberControl
                  label={t("savings.contractValue")}
                  value={input.contractValue}
                  onChange={(contractValue) => patch({ contractValue })}
                  min={250_000}
                  max={62_500_000}
                  step={50_000}
                  quickPicks={[2_000_000, 3_000_000, 5_000_000, 7_500_000, 10_000_000]}
                  format={money}
                />
              )}

              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-600"
                    checked={lockDownAsRatio}
                    onChange={(e) => setLockDownAsRatio(e.target.checked)}
                  />
                  {t("savings.lockDownRatio")}
                </label>
                {lockDownAsRatio ? (
                  <NumberControl
                    label={t("savings.downPaymentPct")}
                    hint={money(input.downPayment)}
                    value={Math.round(downRatioPct * 10) / 10}
                    onChange={setDownRatio}
                    min={0}
                    max={80}
                    step={0.5}
                    quickPicks={[0, 10, 20, 25, 30, 40]}
                    format={(n) => `${n}%`}
                    suffix="%"
                  />
                ) : (
                  <NumberControl
                    label={t("savings.downPayment")}
                    hint={`${downRatioPct.toFixed(1)}%`}
                    value={input.downPayment}
                    onChange={(downPayment) => patch({ downPayment })}
                    min={0}
                    max={Math.max(0, input.contractValue)}
                    step={25_000}
                    quickPicks={[0, 500_000, 1_000_000, 1_500_000, 2_000_000]}
                    format={money}
                  />
                )}
              </div>

              {mode === "priceToBudget" ? (
                <NumberControl
                  label={t("savings.firstInstalment")}
                  value={input.firstInstalment}
                  onChange={(firstInstalment) => patch({ firstInstalment })}
                  min={1_000}
                  max={1_000_000}
                  step={1_000}
                  quickPicks={[75_000, 100_000, 125_000, 150_000, 175_000, 200_000]}
                  format={money}
                />
              ) : null}

              {mode === "targetDate" ? (
                <Field
                  label={t("savings.targetDate")}
                  hint={
                    latestStart
                      ? t("savings.latestStart", { date: latestStart })
                      : t("savings.targetDateHint")
                  }
                  error={latestStartPassed ? t("savings.latestStartPassed", { date: latestStart! }) : undefined}
                >
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className={latestStartPassed ? "border-red-500 focus:border-red-500 focus:ring-red-500" : undefined}
                  />
                </Field>
              ) : null}

              <StepRatePicker
                label={t("savings.stepRate")}
                value={input.stepRatePct}
                options={preset.stepRates}
                onChange={(stepRatePct) => patch({ stepRatePct: stepRatePct as StepRatePct })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("savings.startDate")}>
                  <Input
                    type="date"
                    value={input.startDate}
                    onChange={(e) => patch({ startDate: e.target.value })}
                  />
                </Field>
                <Field label={t("savings.stepMonths")}>
                  <Input
                    type="number"
                    min="1"
                    max="24"
                    value={input.stepMonths}
                    onChange={(e) => patch({ stepMonths: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <details className="rounded-lg border border-[var(--edge)] p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("savings.advanced")}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label={t("savings.orgFeePct")} hint={money(plan.orgFee)}>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={input.orgFeePct}
                      onChange={(e) => patch({ orgFeePct: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={t("savings.orgFeeUpfrontPct")} hint={money(plan.orgFeeUpfront)}>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={input.orgFeeUpfrontPct}
                      onChange={(e) => patch({ orgFeeUpfrontPct: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={t("savings.orgFeeInstalments")}>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={input.orgFeeInstalments}
                      onChange={(e) => patch({ orgFeeInstalments: Number(e.target.value) })}
                    />
                  </Field>
                  <div />
                  {/* the BDDK gates are law, not preference — but they change,
                      and an old quote has to reproduce under the regime it was
                      signed under, so they live on the plan */}
                  <Field label={t("savings.deliveryRatioPct")} hint={t("savings.bddkHint")}>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={input.deliveryRatioPct}
                      onChange={(e) => patch({ deliveryRatioPct: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={t("savings.minDeliveryDays")} hint={t("savings.bddkHint")}>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={input.minDeliveryDays}
                      onChange={(e) => patch({ minDeliveryDays: Number(e.target.value) })}
                    />
                  </Field>
                </div>
              </details>
            </div>
          </Card>

          <SavingsCompliancePanel plan={plan} onApply={patch} />
        </div>

        {/* results */}
        <div className="min-w-0 space-y-4">
          {mode === "budgetToPrice" ? (
            <Card>
              <CardHeader title={t("savings.affordTitle")} />
              <div className="p-4">
                {affordable ? (
                  <>
                    <Figure size="lg">{money(affordable.contractValue)}</Figure>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("savings.affordHint", {
                        budget: money(budget),
                        period: affordable.plan.deliveryPeriod ?? 0,
                      })}
                    </p>
                    <Button
                      className="mt-3"
                      onClick={() =>
                        patch({
                          contractValue: affordable.contractValue,
                          downPayment: affordable.plan.input.downPayment,
                          firstInstalment: budget,
                        })
                      }
                    >
                      {t("savings.useThisPrice")}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">{t("savings.affordNone")}</p>
                )}
              </div>
            </Card>
          ) : null}

          {mode === "targetDate" ? (
            <Card>
              <CardHeader title={t("savings.targetTitle")} />
              <div className="p-4">
                {!targetDate ? (
                  <p className="text-sm text-zinc-500">{t("savings.targetPrompt")}</p>
                ) : targeted && "error" in targeted ? (
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t(`savings.targetError_${targeted.error}`)}
                  </p>
                ) : targeted ? (
                  <>
                    <Figure size="lg">{money(targeted.firstInstalment)}</Figure>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("savings.targetHint", {
                        period: targeted.period,
                        date: targeted.plan.deliveryDate!,
                      })}
                    </p>
                    <Button className="mt-3" onClick={() => patch({ firstInstalment: targeted.firstInstalment })}>
                      {t("savings.useThisInstalment")}
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t("savings.summaryTitle")} />
            <div className="grid grid-cols-2 gap-px bg-[var(--edge-soft)] sm:grid-cols-4">
              <Stat label={t("savings.statDelivery")} value={plan.deliveryDate ?? "—"} />
              <Stat
                label={t("savings.statDeliveryRatio")}
                value={plan.deliveryRatio != null ? `${(plan.deliveryRatio * 100).toFixed(2)}%` : "—"}
              />
              <Stat label={t("savings.statTerm")} value={String(plan.termMonths)} />
              <Stat label={t("savings.statSpread")} value={`${plan.spreadRatio.toFixed(4)}x`} />
              <Stat label={t("savings.statCashAtSigning")} value={money(plan.cashAtSigning)} />
              <Stat
                label={t("savings.statCashUntilDelivery")}
                value={plan.cashUntilDelivery != null ? money(plan.cashUntilDelivery) : "—"}
              />
              <Stat label={t("savings.statOrgFee")} value={money(plan.orgFee)} />
              <Stat label={t("savings.statTotalCost")} value={money(plan.totalCost)} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t("savings.chartTitle")} />
            <div className="p-2 sm:p-4">
              <SavingsChart plan={plan} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t("savings.delayTitle")} />
            <ul className="divide-y divide-[var(--edge-soft)]">
              {delays.map(({ months, startDate, plan: delayed }) => (
                <li key={months} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-zinc-500">{t("savings.delayMonths", { count: months })}</span>
                  <span className="tnum">{startDate}</span>
                  <span className="tnum">{delayed.deliveryDate ?? "—"}</span>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-3 text-xs text-zinc-500">{t("savings.delayHint")}</p>
          </Card>

          <Card>
            <CardHeader
              title={t("savings.scheduleTitle")}
              action={<span className="text-xs text-zinc-500">{t("savings.rowCount", { count: plan.termMonths })}</span>}
            />
            <SavingsSchedule plan={plan} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-2.5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tnum text-sm font-semibold">{value}</div>
    </div>
  );
}

/** yyyy-mm-dd plus n months, clamping the day. */
function shiftMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
