import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { UsdPerMap } from "./fx";
import { projectCashflow, ProjectionResult } from "./projector";
import { addMonthsClamped } from "./recurrence";

export type Scenario =
  | { type: "loseIncome"; categoryId: string }
  | { type: "tryDevaluation"; pct: number }
  | { type: "oneOffExpense"; amount: number; monthOffset: number };

export interface ProjectionInputs {
  accounts: Account[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  usdPer: UsdPerMap;
  display: Currency;
  fromDate: string;
  months: number;
}

/**
 * What-if overlays for the projector. Each scenario transforms the inputs
 * (or post-adjusts the months) and re-runs the same pure projection, so the
 * overlay differs from the base line only by the assumption itself.
 */
export function projectWithScenario(inputs: ProjectionInputs, scenario: Scenario): ProjectionResult {
  let { transactions, templates, usdPer } = inputs;

  if (scenario.type === "loseIncome") {
    transactions = transactions.filter(
      (t) => !(t.status === "planned" && t.direction === "income" && t.categoryId === scenario.categoryId)
    );
    templates = templates.filter(
      (t) => !(t.direction === "income" && t.categoryId === scenario.categoryId)
    );
  }

  if (scenario.type === "tryDevaluation") {
    const tryRate = usdPer.TRY;
    if (tryRate != null) {
      usdPer = { ...usdPer, TRY: tryRate * (1 - scenario.pct / 100) };
    }
  }

  const result = projectCashflow({ ...inputs, transactions, templates, usdPer });

  if (scenario.type === "oneOffExpense") {
    const hitMonth = addMonthsClamped(inputs.fromDate, scenario.monthOffset).slice(0, 7);
    let applied = false;
    const months = result.months.map((m) => {
      const hit = m.month === hitMonth;
      if (hit) applied = true;
      return {
        ...m,
        expense: hit ? m.expense + scenario.amount : m.expense,
        net: hit ? m.net - scenario.amount : m.net,
        endNetWorth: applied ? m.endNetWorth - scenario.amount : m.endNetWorth,
      };
    });
    return { ...result, months };
  }

  return result;
}
