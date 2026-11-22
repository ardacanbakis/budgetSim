import { Account, Loan, Purchase, Transaction, TxDirection } from "@/lib/data/types";
import { Currency } from "./currencies";
import { toMinor } from "./money";

/**
 * A fix file: a list of changes to your records, written ahead of time (by
 * hand, or by someone checking a backup) and applied from Settings → Data
 * check, where every step is shown before anything is written.
 *
 * Each step names the rows it touches by id and says what it expects to find
 * there. A step is one of three things against the records as they are now:
 * - "ready": what it expects is there, so it can be applied;
 * - "done": what it would do is already the case (applied before, or by hand),
 *   so it's skipped. Applying a file twice changes nothing the second time;
 * - "mismatch": the records moved on since the file was written. Then nothing
 *   in the file is applied: a fix written for other numbers would be wrong.
 *
 * Nothing here writes: lib/data/fixRunner.ts applies the steps.
 */

export interface FixFile {
  app: "renovator";
  kind: "fixes";
  version: 1;
  /** what the file is for, shown above the steps */
  title: string;
  steps: FixStep[];
}

/** What a row is expected to look like before a step touches it; only the fields given are checked. */
export interface TxExpect {
  accountId?: string;
  amount?: number;
  dueDate?: string;
  status?: Transaction["status"];
  legacy?: boolean;
  direction?: TxDirection;
}

export type TxEdit = Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>;

interface StepBase {
  /** why, in a sentence: shown with the step */
  note?: string;
}

export type FixStep = StepBase &
  (
    | { op: "editTransaction"; id: string; expect?: TxExpect; set: TxEdit }
    /** a transfer's other leg goes with it */
    | { op: "deleteTransaction"; id: string; expect?: TxExpect }
    | {
        op: "createTransfer";
        from: string;
        to: string;
        fromAmount: number;
        /** defaults to fromAmount (same currency) */
        toAmount?: number;
        date: string;
        description: string;
        /** history: both legs kept out of the balances */
        legacy?: boolean;
      }
    | {
        op: "createTransaction";
        accountId: string;
        direction: TxDirection;
        amount: number;
        date: string;
        description: string;
        categoryId?: string | null;
        legacy?: boolean;
      }
    /** planned rows marked done (each with its transfer's other leg) */
    | { op: "completeTransactions"; ids: string[] }
    | {
        op: "createPurchase";
        accountId: string;
        name: string;
        amount: number;
        installments: number;
        firstDue: string;
        purchaseDate: string;
        details?: string;
        categoryId?: string | null;
      }
    | {
        op: "createDebt";
        name: string;
        counterparty?: string | null;
        principal: number;
        date: string;
        /** where repayments leave from; the debt takes its currency */
        payAccountId: string;
        /** repaid through this big purchase's installments on a card */
        purchaseId?: string | null;
      }
    /** a Data check issue hidden on this device */
    | { op: "dismissIssue"; issueId: string }
  );

export type FixOp = FixStep["op"];

export type Mismatch =
  | { kind: "missingRow"; id: string }
  | { kind: "missingAccount"; id: string }
  | { kind: "missingPurchase"; id: string }
  | { kind: "field"; id: string; field: keyof TxExpect; expected: unknown; actual: unknown };

export type StepState = { status: "ready" } | { status: "done" } | { status: "mismatch"; problems: Mismatch[] };

export interface FixState {
  accounts: Account[];
  transactions: Transaction[];
  purchases: Purchase[];
  loans: Loan[];
  /** Data check issues dismissed on this device */
  dismissed: ReadonlySet<string>;
}

const OPS: readonly FixOp[] = [
  "editTransaction",
  "deleteTransaction",
  "createTransfer",
  "createTransaction",
  "completeTransactions",
  "createPurchase",
  "createDebt",
  "dismissIssue",
];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Why a step can't be read, or null when it can. */
function stepError(s: Record<string, unknown>): string | null {
  switch (s.op) {
    case "editTransaction":
      if (!isText(s.id)) return "id";
      if (s.set == null || typeof s.set !== "object" || Object.keys(s.set).length === 0) return "set";
      return null;
    case "deleteTransaction":
      return isText(s.id) ? null : "id";
    case "createTransfer":
      if (!isText(s.from) || !isText(s.to)) return "from/to";
      if (!isAmount(s.fromAmount) || (s.toAmount != null && !isAmount(s.toAmount))) return "amount";
      if (!isDate(s.date)) return "date";
      return typeof s.description === "string" ? null : "description";
    case "createTransaction":
      if (!isText(s.accountId)) return "accountId";
      if (s.direction !== "income" && s.direction !== "expense") return "direction";
      if (!isAmount(s.amount)) return "amount";
      if (!isDate(s.date)) return "date";
      return typeof s.description === "string" ? null : "description";
    case "completeTransactions":
      return Array.isArray(s.ids) && s.ids.length > 0 && s.ids.every(isText) ? null : "ids";
    case "createPurchase":
      if (!isText(s.accountId) || !isText(s.name)) return "accountId/name";
      if (!isAmount(s.amount)) return "amount";
      if (!Number.isInteger(s.installments) || (s.installments as number) < 1) return "installments";
      return isDate(s.firstDue) && isDate(s.purchaseDate) ? null : "date";
    case "createDebt":
      if (!isText(s.name) || !isText(s.payAccountId)) return "name/payAccountId";
      if (!isAmount(s.principal)) return "principal";
      return isDate(s.date) ? null : "date";
    case "dismissIssue":
      return isText(s.issueId) ? null : "issueId";
    default:
      return "op";
  }
}

/** Reads a fix file, or says why it isn't one. */
export function parseFixFile(data: unknown): { file: FixFile } | { error: string } {
  const d = data as Partial<FixFile> | null;
  if (d == null || typeof d !== "object" || d.app !== "renovator" || d.kind !== "fixes") return { error: "not a fix file" };
  if (d.version !== 1) return { error: `version ${String(d.version)}` };
  if (!Array.isArray(d.steps) || d.steps.length === 0) return { error: "no steps" };
  for (const [i, step] of d.steps.entries()) {
    const s = step as unknown as Record<string, unknown>;
    if (s == null || typeof s !== "object" || !OPS.includes(s.op as FixOp)) return { error: `step ${i + 1}: op` };
    const bad = stepError(s);
    if (bad) return { error: `step ${i + 1}: ${bad}` };
  }
  return { file: { app: "renovator", kind: "fixes", version: 1, title: typeof d.title === "string" ? d.title : "", steps: d.steps } };
}

/** Compares two amounts in an account's smallest unit, so 0.1 + 0.2 equals 0.3. */
function sameAmount(a: number, b: number, currency: Currency): boolean {
  return toMinor(a, currency) === toMinor(b, currency);
}

export function evaluateStep(step: FixStep, state: FixState): StepState {
  const accountById = new Map(state.accounts.map((a) => [a.id, a] as const));
  const txById = new Map(state.transactions.map((t) => [t.id, t] as const));
  const currencyOf = (accountId: string): Currency => accountById.get(accountId)?.currency ?? "TRY";
  const problems: Mismatch[] = [];
  const needAccount = (id: string) => {
    if (!accountById.has(id)) problems.push({ kind: "missingAccount", id });
  };
  const check = (tx: Transaction, expect: TxExpect | undefined) => {
    for (const [field, expected] of Object.entries(expect ?? {}) as [keyof TxExpect, unknown][]) {
      const actual = tx[field];
      const same =
        field === "amount" ? sameAmount(actual as number, expected as number, currencyOf(tx.accountId)) : (actual ?? false) === (expected ?? false);
      if (!same) problems.push({ kind: "field", id: tx.id, field, expected, actual });
    }
  };
  const verdict = (done: boolean): StepState => (problems.length ? { status: "mismatch", problems } : { status: done ? "done" : "ready" });

  switch (step.op) {
    case "editTransaction": {
      const tx = txById.get(step.id);
      if (!tx) return { status: "mismatch", problems: [{ kind: "missingRow", id: step.id }] };
      if (step.set.accountId) needAccount(step.set.accountId);
      const applied = (Object.entries(step.set) as [keyof TxEdit, unknown][]).every(([field, value]) =>
        field === "amount" ? sameAmount(tx.amount, value as number, currencyOf(tx.accountId)) : (tx[field] ?? null) === (value ?? null)
      );
      if (applied) return verdict(true);
      check(tx, step.expect);
      return verdict(false);
    }
    case "deleteTransaction": {
      const tx = txById.get(step.id);
      if (!tx) return { status: "done" };
      check(tx, step.expect);
      return verdict(false);
    }
    case "createTransfer": {
      needAccount(step.from);
      needAccount(step.to);
      const legs = findTransfer(step, state.transactions, currencyOf);
      return verdict(legs != null && (!step.legacy || legs.every((l) => l.legacy)));
    }
    case "createTransaction": {
      needAccount(step.accountId);
      const exists = state.transactions.some(
        (t) =>
          t.transferGroupId == null &&
          t.accountId === step.accountId &&
          t.dueDate === step.date &&
          t.direction === step.direction &&
          t.description === step.description &&
          sameAmount(t.amount, step.amount, currencyOf(step.accountId))
      );
      return verdict(exists);
    }
    case "completeTransactions": {
      for (const id of step.ids) if (!txById.has(id)) problems.push({ kind: "missingRow", id });
      return verdict(step.ids.every((id) => txById.get(id)?.status === "completed"));
    }
    case "createPurchase": {
      needAccount(step.accountId);
      return verdict(state.purchases.some((p) => p.accountId === step.accountId && p.name === step.name));
    }
    case "createDebt": {
      needAccount(step.payAccountId);
      if (step.purchaseId && !state.purchases.some((p) => p.id === step.purchaseId)) {
        problems.push({ kind: "missingPurchase", id: step.purchaseId });
      }
      return verdict(state.loans.some((l) => l.name === step.name));
    }
    case "dismissIssue":
      return { status: state.dismissed.has(step.issueId) ? "done" : "ready" };
  }
}

/** The two legs of a transfer a createTransfer step describes, if they're on the ledger already. */
export function findTransfer(
  step: Extract<FixStep, { op: "createTransfer" }>,
  transactions: readonly Transaction[],
  currencyOf: (accountId: string) => Currency
): [Transaction, Transaction] | null {
  const toAmount = step.toAmount ?? step.fromAmount;
  for (const out of transactions) {
    if (
      out.transferGroupId == null ||
      out.direction !== "expense" ||
      out.accountId !== step.from ||
      out.dueDate !== step.date ||
      out.description !== step.description ||
      !sameAmount(out.amount, step.fromAmount, currencyOf(step.from))
    ) {
      continue;
    }
    const into = transactions.find(
      (t) =>
        t.transferGroupId === out.transferGroupId &&
        t.direction === "income" &&
        t.accountId === step.to &&
        sameAmount(t.amount, toAmount, currencyOf(step.to))
    );
    if (into) return [out, into];
  }
  return null;
}

export interface FixPlan {
  states: StepState[];
  /** steps that would change something */
  ready: number;
  /** a file with any mismatch is applied not at all */
  blocked: boolean;
}

/** Every step against the records as they are now. */
export function planFixes(file: FixFile, state: FixState): FixPlan {
  const states = file.steps.map((s) => evaluateStep(s, state));
  return {
    states,
    ready: states.filter((s) => s.status === "ready").length,
    blocked: states.some((s) => s.status === "mismatch"),
  };
}
