import { Account } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { Plan, shortThreshold } from "./planner";
import { ProjectionResult } from "./projector";

/**
 * A scenario, everything that went into it, everything that came out, and a
 * set of arithmetic checks the numbers must satisfy. Meant to be read by a
 * person: if a figure on screen looks wrong, this file says where it came
 * from, and the checks flag the ones that can't be right.
 */

export interface ExportCheck {
  name: string;
  ok: boolean;
  /** "error" is arithmetic that can't be right; "advice" is a smell worth a look */
  severity: "error" | "advice";
  /** what was compared, when it fails */
  detail?: string;
}

export interface PlanExport {
  app: "budgetsim";
  kind: "planner-scenario";
  version: 1;
  exportedAt: string;
  scenario: { name: string; horizonMonths: number; displayCurrency: Currency };
  rates: { usdPer: UsdPerMap; note: string };
  plan: Plan;
  accounts: {
    id: string;
    name: string;
    currency: Currency;
    kind: string;
    startBalance: number;
    startValueInDisplay: number | null;
    drawable: boolean;
    fundingRank: number | null;
    routine: boolean;
  }[];
  months: {
    month: string;
    income: number;
    expense: number;
    net: number;
    endNetWorth: number;
    shortfall: number;
    uncovered: number;
    draws: { account: string; currency: Currency; amount: number; value: number; routine: boolean }[];
    sourceBalances: Record<string, number>;
    lines: { label: string; direction: string; amount: number; category: string }[];
  }[];
  checks: ExportCheck[];
}

/** Two numbers that ought to be equal, allowing for floating-point dust. */
const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/**
 * The arithmetic the projection must satisfy, run over its own output. These
 * are the properties that were quietly violated by earlier bugs, so they earn
 * their place: each one failed at some point on real data.
 */
export function runChecks(
  result: ProjectionResult,
  accountsById: Map<string, { name: string; currency?: Currency; startBalance?: number; routine?: boolean }>,
  threshold: number,
  /** turn an account's own units into display currency, for judging "small" */
  valueOf: (amount: number, currency: Currency | undefined) => number = (a) => a
): ExportCheck[] {
  const checks: ExportCheck[] = [];
  // a thousandth of what counts as a shortfall — ₺1 or so. Below this a
  // balance is rounding, not money, and saying otherwise is noise.
  const dust = Math.max(threshold / 1000, 1e-9);
  const fails: string[] = [];
  const totals = new Map<string, number>();
  for (const m of result.months) {
    for (const d of m.draws) totals.set(d.accountId, (totals.get(d.accountId) ?? 0) + d.amount);
  }

  // 1. a month's net is exactly what its own lines add up to
  for (const m of result.months) {
    if (!near(m.net, m.income - m.expense)) {
      fails.push(`${m.month}: net ${m.net} ≠ income ${m.income} − expense ${m.expense}`);
    }
  }
  checks.push({
    name: "net equals income minus expense",
    severity: "error",
    ok: fails.length === 0,
    detail: fails.slice(0, 5).join("; ") || undefined,
  });

  // 2. what a month came up short by is what it sold plus what it couldn't
  const cover: string[] = [];
  for (const m of result.months) {
    const sold = m.draws.reduce((s, d) => s + d.value, 0);
    if (m.uncovered > 0 && sold + m.uncovered < m.shortfall - 0.01) {
      cover.push(`${m.month}: sold ${sold} + uncovered ${m.uncovered} < shortfall ${m.shortfall}`);
    }
  }
  checks.push({
    name: "shortfall is covered by sales plus what's left unpaid",
    severity: "error",
    ok: cover.length === 0,
    detail: cover.slice(0, 5).join("; ") || undefined,
  });

  // 3. Nothing was sold out of an account that had nothing in it. An account
  //    can end a month slightly overdrawn by its own bills with nothing left
  //    to cover it — that's honest. Being overdrawn *and* sold from is not.
  const negative: string[] = [];
  for (const m of result.months) {
    const drawnFrom = new Set(m.draws.map((d) => d.accountId));
    for (const [id, balance] of Object.entries(m.sourceBalances)) {
      if (!drawnFrom.has(id)) continue;
      if (valueOf(balance, accountsById.get(id)?.currency) < -dust) {
        negative.push(`${m.month}: ${accountsById.get(id)?.name ?? id} sold down to ${balance}`);
      }
    }
  }
  checks.push({
    name: "no funding source is sold below zero",
    severity: "error",
    ok: negative.length === 0,
    detail: negative.slice(0, 5).join("; ") || undefined,
  });

  // 4. once a month can't be paid for, there was genuinely nothing left to sell
  const stillHolding: string[] = [];
  for (const m of result.months) {
    if (m.uncovered <= threshold) continue;
    const left = Object.entries(m.sourceBalances).filter(
      ([id, b]) => valueOf(b, accountsById.get(id)?.currency) > dust
    );
    if (left.length > 0) {
      stillHolding.push(
        `${m.month}: ${m.uncovered} unpaid while holding ${left
          .map(([id, b]) => `${accountsById.get(id)?.name ?? id}=${b}`)
          .join(", ")}`
      );
    }
  }
  checks.push({
    name: "nothing is left unsold while a month goes unpaid",
    severity: "error",
    ok: stillHolding.length === 0,
    detail: stillHolding.slice(0, 5).join("; ") || undefined,
  });

  // 5. Net worth never climbs through a month that spent more than it took in
  //    and couldn't pay for the difference. A month that runs a surplus while
  //    still carrying an old overdraft is digging itself out, and should climb.
  const climbs: string[] = [];
  for (let i = 1; i < result.months.length; i++) {
    const prev = result.months[i - 1];
    const m = result.months[i];
    if (m.shortfall > threshold && m.uncovered > threshold && m.endNetWorth > prev.endNetWorth + 0.01) {
      climbs.push(`${m.month}: ${prev.endNetWorth} → ${m.endNetWorth} while ${m.uncovered} went unpaid`);
    }
  }
  checks.push({
    name: "net worth doesn't rise through a short month that went unpaid",
    severity: "error",
    ok: climbs.length === 0,
    detail: climbs.slice(0, 5).join("; ") || undefined,
  });

  // 6. An account that gives up more than it ever held is a conduit, not a
  //    store: income is landing in it and being spent straight back out. That
  //    is fine, but calling it "sold" is misleading, so it should be routine.
  const conduits: string[] = [];
  for (const [id, sold] of totals) {
    const account = accountsById.get(id);
    if (account?.routine) continue;
    const start = account?.startBalance ?? 0;
    if (sold > start * 1.05 + Math.abs(dust)) {
      conduits.push(
        `${account?.name ?? id}: sold ${sold} against a starting balance of ${start} — income lands here, so mark it routine`
      );
    }
  }
  checks.push({
    name: "nothing is sold for more than it ever held without being marked routine",
    severity: "advice",
    ok: conduits.length === 0,
    detail: conduits.slice(0, 5).join("; ") || undefined,
  });

  return checks;
}

export function buildPlanExport(params: {
  name: string;
  plan: Plan;
  result: ProjectionResult;
  accounts: Account[];
  startBalances: Map<string, number>;
  usdPer: UsdPerMap;
  display: Currency;
  months: number;
  fundingOrder: string[];
}): PlanExport {
  const { name, plan, result, accounts, startBalances, usdPer, display, months, fundingOrder } = params;
  const routine = new Set(plan.funding?.routine ?? []);
  const byId = new Map(
    accounts.map((a) => [
      a.id,
      { ...a, startBalance: startBalances.get(a.id) ?? 0, routine: routine.has(a.id) },
    ])
  );

  return {
    app: "budgetsim",
    kind: "planner-scenario",
    version: 1,
    exportedAt: new Date().toISOString(),
    scenario: { name, horizonMonths: months, displayCurrency: display },
    rates: {
      usdPer,
      note: "USD value of one unit of each currency, at the moment of export",
    },
    plan: {
      ...plan,
      items: plan.items.map((i) => ({
        ...i,
        landsIn: i.accountId ? (byId.get(i.accountId)?.name ?? i.accountId) : "auto",
      })),
    } as Plan,
    accounts: accounts.map((a) => {
      const start = startBalances.get(a.id) ?? 0;
      const rank = fundingOrder.indexOf(a.id);
      return {
        id: a.id,
        name: a.name,
        currency: a.currency,
        kind: a.kind,
        startBalance: start,
        startValueInDisplay: convert(start, a.currency, display, usdPer),
        drawable: rank >= 0,
        fundingRank: rank >= 0 ? rank + 1 : null,
        routine: routine.has(a.id),
      };
    }),
    months: result.months.map((m) => ({
      month: m.month,
      income: m.income,
      expense: m.expense,
      net: m.net,
      endNetWorth: m.endNetWorth,
      shortfall: m.shortfall,
      uncovered: m.uncovered,
      draws: m.draws.map((d) => ({
        account: byId.get(d.accountId)?.name ?? d.accountId,
        currency: d.currency,
        amount: d.amount,
        value: d.value,
        routine: d.routine,
      })),
      sourceBalances: Object.fromEntries(
        Object.entries(m.sourceBalances).map(([id, v]) => [byId.get(id)?.name ?? id, v])
      ),
      lines: m.lines.map((l) => ({
        label: l.label,
        direction: l.direction,
        amount: l.amount,
        category: l.categoryId,
      })),
    })),
    checks: runChecks(result, byId, shortThreshold(display, usdPer), (amount, currency) =>
      currency ? (convert(amount, currency, display, usdPer) ?? amount) : amount
    ),
  };
}
