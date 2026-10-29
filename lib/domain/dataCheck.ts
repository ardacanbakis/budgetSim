import { Account, Transaction, VictvsSession } from "@/lib/data/types";
import { Currency } from "./currencies";
import { toMinor } from "./money";
import { addDays } from "./recurrence";

/**
 * Things in the ledger that make the numbers wrong, or just untidy, found by
 * reading it: nothing here changes anything. Each issue says what it is,
 * which rows it's about and, where one is safe, the fix a click can make;
 * the Data check page (Settings) shows them and lets you dismiss the rest.
 *
 * Every issue has a stable id built from the rows it's about, so a dismissal
 * sticks until those rows change.
 */

export type DataIssueKind =
  /** a charge that repeats one of a big purchase's installments (entered before as a recurring item, say) */
  | "duplicateInstallment"
  /** the same row twice: same account, date, amount, direction and description */
  | "exactDuplicate"
  /** marked done, but dated after today */
  | "completedInFuture"
  /** one side of a transfer done, the other still planned */
  | "halfDoneTransfer"
  /** both sides in one currency, different amounts */
  | "legsDontMatch"
  /** a transfer with only one side */
  | "oneSidedTransfer"
  /** a card with no account set to pay it from */
  | "cardWithoutPayer"
  /** a big purchase's installment still marked planned after its date */
  | "installmentStillPlanned"
  /** a VICTVS session unpaid for a long time */
  | "oldUnpaidSession"
  /** income that reads like borrowed money */
  | "borrowedAsIncome";

export type DataFix =
  | { kind: "delete"; txIds: string[] }
  /** complete these rows (each with its transfer's other leg) */
  | { kind: "complete"; txIds: string[] }
  /** move a row back to planned */
  | { kind: "reopen"; txId: string }
  | { kind: "setPayer"; cardId: string; payerId: string };

export interface DataIssue {
  id: string;
  kind: DataIssueKind;
  /** "fix": the numbers are wrong because of it; "tidy": they aren't, but it's untidy or worth a look */
  severity: "fix" | "tidy";
  /** the rows it's about, first the one to look at */
  txs: Transaction[];
  sessions?: VictvsSession[];
  account?: Account;
  /** the account a fix would set or that the issue points to */
  other?: Account;
  /** money involved, in `currency` */
  amount?: number;
  currency?: Currency;
  fix: DataFix | null;
}

// whole words, Turkish letters included (\b only knows ASCII)
const BORROWED = /(?<![\p{L}\p{N}])(avans|kredi|kredisi|loan|borç|borc|ödünç|odunc)(?![\p{L}\p{N}])/iu;
const UNPAID_SESSION_DAYS = 60;

export function checkData(params: {
  accounts: Account[];
  transactions: Transaction[];
  victvsSessions?: VictvsSession[];
  today: string;
}): DataIssue[] {
  const { accounts, transactions, victvsSessions = [], today } = params;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const currencyOf = (accountId: string): Currency => byId.get(accountId)?.currency ?? "TRY";
  const minor = (t: Transaction) => toMinor(t.amount, currencyOf(t.accountId));
  const issues: DataIssue[] = [];

  // --- the same installment twice: a purchase row and a plain charge like it
  const installments = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.purchaseId != null) installments.set(`${t.accountId}|${t.dueDate.slice(0, 7)}|${minor(t)}`, t);
  }
  const repeated = new Set<string>();
  for (const t of transactions) {
    if (t.purchaseId != null || t.transferGroupId != null || t.direction !== "expense") continue;
    const twin = installments.get(`${t.accountId}|${t.dueDate.slice(0, 7)}|${minor(t)}`);
    if (!twin) continue;
    repeated.add(t.id);
    issues.push({
      id: `duplicateInstallment:${t.id}`,
      kind: "duplicateInstallment",
      // history from before tracking moves nothing; still a copy
      severity: t.legacy ? "tidy" : "fix",
      txs: [t, twin],
      account: byId.get(t.accountId),
      amount: t.amount,
      currency: currencyOf(t.accountId),
      fix: { kind: "delete", txIds: [t.id] },
    });
  }

  // --- exact copies of a row (not transfers, not already caught above)
  const seen = new Map<string, Transaction>();
  for (const t of [...transactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (t.transferGroupId != null || repeated.has(t.id)) continue;
    const key = [t.accountId, t.dueDate, t.direction, minor(t), t.description.trim().toLocaleLowerCase("tr-TR")].join("|");
    const first = seen.get(key);
    if (!first) {
      seen.set(key, t);
      continue;
    }
    issues.push({
      id: `exactDuplicate:${t.id}`,
      kind: "exactDuplicate",
      severity: t.legacy ? "tidy" : "fix",
      txs: [t, first],
      account: byId.get(t.accountId),
      amount: t.amount,
      currency: currencyOf(t.accountId),
      fix: { kind: "delete", txIds: [t.id] },
    });
  }

  // --- done, but dated ahead: it already moved the balance
  for (const t of transactions) {
    if (t.status !== "completed" || t.legacy || t.dueDate <= today) continue;
    issues.push({
      id: `completedInFuture:${t.id}`,
      kind: "completedInFuture",
      severity: "fix",
      txs: [t],
      account: byId.get(t.accountId),
      amount: t.amount,
      currency: currencyOf(t.accountId),
      fix: { kind: "reopen", txId: t.id },
    });
  }

  // --- transfers, leg by leg
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.transferGroupId) continue;
    const legs = groups.get(t.transferGroupId);
    if (legs) legs.push(t);
    else groups.set(t.transferGroupId, [t]);
  }
  for (const [groupId, legs] of groups) {
    if (legs.length === 1) {
      const [leg] = legs;
      const account = byId.get(leg.accountId);
      // a closed account's old leftovers are history; nothing to act on
      if (!account || account.archived) continue;
      issues.push({
        id: `oneSidedTransfer:${groupId}`,
        kind: "oneSidedTransfer",
        severity: "tidy",
        txs: [leg],
        account,
        amount: leg.amount,
        currency: account.currency,
        fix: { kind: "delete", txIds: [leg.id] },
      });
      continue;
    }
    const out = legs.find((l) => l.direction === "expense");
    const into = legs.find((l) => l.direction === "income");
    if (!out || !into) continue;
    const planned = legs.filter((l) => l.status === "planned");
    if (planned.length > 0 && planned.length < legs.length) {
      issues.push({
        id: `halfDoneTransfer:${groupId}`,
        kind: "halfDoneTransfer",
        severity: "tidy",
        txs: [planned[0], ...legs.filter((l) => l !== planned[0])],
        account: byId.get(out.accountId),
        other: byId.get(into.accountId),
        amount: out.amount,
        currency: currencyOf(out.accountId),
        fix: { kind: "complete", txIds: [planned[0].id] },
      });
    }
    if (currencyOf(out.accountId) === currencyOf(into.accountId) && minor(out) !== minor(into)) {
      issues.push({
        id: `legsDontMatch:${groupId}:${minor(out)}:${minor(into)}`,
        kind: "legsDontMatch",
        severity: "tidy",
        txs: [out, into],
        account: byId.get(out.accountId),
        other: byId.get(into.accountId),
        amount: Math.abs(out.amount - into.amount),
        currency: currencyOf(out.accountId),
        fix: null,
      });
    }
  }

  // --- cards nobody pays: the plan has to guess where the money comes from
  for (const card of accounts) {
    if (card.kind !== "credit_card" || card.archived || card.paymentAccountId) continue;
    // the account its payments have come from most often
    const from = new Map<string, number>();
    for (const legs of groups.values()) {
      const landing = legs.find((l) => l.accountId === card.id && l.direction === "income");
      const paying = legs.find((l) => l.direction === "expense" && byId.get(l.accountId)?.kind !== "credit_card");
      if (landing && paying) from.set(paying.accountId, (from.get(paying.accountId) ?? 0) + 1);
    }
    const payer = [...from.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const payerAccount = payer ? byId.get(payer) : undefined;
    issues.push({
      id: `cardWithoutPayer:${card.id}`,
      kind: "cardWithoutPayer",
      severity: "fix",
      txs: [],
      account: card,
      other: payerAccount,
      fix: payerAccount && !payerAccount.archived ? { kind: "setPayer", cardId: card.id, payerId: payerAccount.id } : null,
    });
  }

  // --- installments that never got ticked (cosmetic: the card's payment decides)
  const stale = transactions
    .filter((t) => t.purchaseId != null && t.status === "planned" && t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const stalePerAccount = new Map<string, Transaction[]>();
  for (const t of stale) stalePerAccount.set(t.accountId, [...(stalePerAccount.get(t.accountId) ?? []), t]);
  for (const [accountId, rows] of stalePerAccount) {
    issues.push({
      id: `installmentStillPlanned:${rows.map((r) => r.id).join(",")}`,
      kind: "installmentStillPlanned",
      severity: "tidy",
      txs: rows,
      account: byId.get(accountId),
      amount: rows.reduce((s, r) => s + r.amount, 0),
      currency: currencyOf(accountId),
      fix: { kind: "complete", txIds: rows.map((r) => r.id) },
    });
  }

  // --- VICTVS sessions unpaid for months: paid and missed, or still owed?
  const cutoff = addDays(today, -UNPAID_SESSION_DAYS);
  const old = victvsSessions.filter((s) => s.status === "unpaid" && s.date < cutoff).sort((a, b) => a.date.localeCompare(b.date));
  if (old.length > 0) {
    issues.push({
      id: `oldUnpaidSession:${old.map((s) => s.id).join(",")}`,
      kind: "oldUnpaidSession",
      severity: "tidy",
      txs: [],
      sessions: old,
      amount: old.reduce((s, x) => s + x.amount, 0),
      currency: "USD",
      fix: null,
    });
  }

  // --- borrowed money booked as income: it's a debt, and it inflates income
  for (const t of transactions) {
    if (t.direction !== "income" || t.transferGroupId != null || t.loanId != null || t.legacy) continue;
    if (byId.get(t.accountId)?.kind === "credit_card") continue;
    if (!BORROWED.test(t.description)) continue;
    issues.push({
      id: `borrowedAsIncome:${t.id}`,
      kind: "borrowedAsIncome",
      severity: "fix",
      txs: [t],
      account: byId.get(t.accountId),
      amount: t.amount,
      currency: currencyOf(t.accountId),
      fix: null,
    });
  }

  const order: Record<DataIssue["severity"], number> = { fix: 0, tidy: 1 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** For the badge in the sidebar and the dashboard nudge: what still needs a look. */
export function openIssues(issues: readonly DataIssue[], dismissed: ReadonlySet<string>): DataIssue[] {
  return issues.filter((i) => !dismissed.has(i.id));
}
