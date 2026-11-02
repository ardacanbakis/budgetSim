import { Account, ActivityEntry, CardEstimate, Transaction } from "@/lib/data/types";

/**
 * Undo for the change history: given one entry of the activity log, what it
 * takes to put things back the way they were, or why that can't be done.
 * Pure: the screens ask planUndo and hand the steps to the repo.
 *
 * - One change can be several entries: a transfer's two legs, written at the
 *   same moment with the same action (undoGroup). Undoing either undoes both.
 * - Undo only acts while things are still as that change left them. An item
 *   edited, completed or deleted since says "changed" (or "gone") instead of
 *   quietly overwriting what came after. That also means an entry already
 *   undone no longer offers it.
 * - A deletion is brought back from the full copy the log keeps of what it
 *   deleted (the "_row", "_account", ... fields, see lib/data/activityLog.ts).
 *   Deletions logged before those copies were kept can't be undone.
 * - Restoring a deleted account brings back its rows and expected statements,
 *   and points the cards that were paid from it, and the debts that used it,
 *   back at it.
 */

export interface LoanLink {
  id: string;
  deposit: boolean;
  pay: boolean;
}

export interface RestoreSet {
  accounts: Account[];
  transactions: Transaction[];
  cardEstimates: CardEstimate[];
  /** cards whose bill was paid from the restored account */
  payers: string[];
  loans: LoanLink[];
}

export type UndoStep =
  | { kind: "deleteTransaction"; id: string }
  | { kind: "updateTransaction"; id: string; patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">> }
  | { kind: "reopenTransaction"; id: string }
  | { kind: "completeTransaction"; id: string }
  | { kind: "setLegacy"; id: string; legacy: boolean }
  | { kind: "updateAccount"; id: string; patch: Record<string, unknown> }
  | { kind: "deleteAccount"; id: string }
  | { kind: "restore"; set: RestoreSet };

export type UndoBlock =
  /** not something undo knows how to reverse (a bulk import, a VICTVS payout, ...) */
  | "unsupported"
  /** it was changed again since; undo would overwrite that */
  | "changed"
  /** what it was about isn't there any more */
  | "gone"
  /** a deletion logged before the log kept full copies */
  | "noSnapshot"
  /** what it deleted is back already */
  | "exists";

export type UndoPlan = { ok: true; steps: UndoStep[] } | { ok: false; reason: UndoBlock };

export interface UndoState {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
}

/** The entries written together with `entry`: the same moment, action and kind of thing. */
export function undoGroup(entry: ActivityEntry, all: readonly ActivityEntry[]): ActivityEntry[] {
  const group = all.filter((e) => e.at === entry.at && e.action === entry.action && e.entityType === entry.entityType);
  return group.length > 0 ? group : [entry];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blocked = (reason: UndoBlock): UndoPlan => ({ ok: false, reason });
const snap = <T>(entry: ActivityEntry, key: string): T | undefined => entry.changes[key]?.[0] as T | undefined;

const TX_EDITABLE = ["amount", "dueDate", "description", "categoryId", "accountId"] as const;
const ACCOUNT_EDITABLE = ["name", "openingBalance", "holdings", "creditLimit", "paymentDay", "paymentAccountId"] as const;

export function planUndo(entry: ActivityEntry, all: readonly ActivityEntry[], state: UndoState): UndoPlan {
  const group = undoGroup(entry, all);
  if (entry.entityType === "transaction") return planTransaction(entry, group, state);
  if (entry.entityType === "account") return planAccount(entry, state);
  return blocked("unsupported");
}

function planTransaction(entry: ActivityEntry, group: ActivityEntry[], state: UndoState): UndoPlan {
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  const ids = [...new Set(group.map((e) => e.entityId))];

  switch (entry.action) {
    case "created":
    case "adjusted":
    case "undone": {
      if (entry.entityId === "bulk") return blocked("unsupported");
      if (entry.entityId.startsWith("transfer:")) {
        const tx = findCreatedTransfer(group, state.transactions);
        return tx ? { ok: true, steps: [{ kind: "deleteTransaction", id: tx.id }] } : blocked("gone");
      }
      // a transfer's legs go together: deleting one deletes both
      const tx = txById.get(entry.entityId);
      if (!tx) return blocked("gone");
      return { ok: true, steps: [{ kind: "deleteTransaction", id: tx.id }] };
    }
    case "deleted": {
      const rows = group.map((e) => snap<Transaction>(e, "_row"));
      if (rows.some((r) => r == null)) return blocked("noSnapshot");
      const full = rows as Transaction[];
      if (full.some((r) => txById.has(r.id))) return blocked("exists");
      const accountIds = new Set(state.accounts.map((a) => a.id));
      if (full.some((r) => !accountIds.has(r.accountId))) return blocked("gone");
      return { ok: true, steps: [{ kind: "restore", set: { accounts: [], transactions: full, cardEstimates: [], payers: [], loans: [] } }] };
    }
    case "edited": {
      const tx = txById.get(entry.entityId);
      if (!tx) return blocked("gone");
      const patch: Record<string, unknown> = {};
      for (const [field, [before, after]] of Object.entries(entry.changes)) {
        if (field === "dueDate" && same(before, after)) continue;
        if (!(TX_EDITABLE as readonly string[]).includes(field)) return blocked("unsupported");
        if (!same(tx[field as keyof Transaction], after)) return blocked("changed");
        patch[field] = before;
      }
      if (Object.keys(patch).length === 0) return blocked("unsupported");
      return { ok: true, steps: [{ kind: "updateTransaction", id: tx.id, patch }] };
    }
    case "completed":
    case "autoCompleted": {
      const txs = ids.map((id) => txById.get(id));
      if (txs.some((t) => t == null)) return blocked("gone");
      if (txs.some((t) => t!.status !== "completed")) return blocked("changed");
      const steps: UndoStep[] = [{ kind: "reopenTransaction", id: txs[0]!.id }];
      for (const e of group) {
        const legacy = e.changes.legacy;
        if (legacy && !same(legacy[0], legacy[1])) steps.push({ kind: "setLegacy", id: e.entityId, legacy: Boolean(legacy[0]) });
      }
      return { ok: true, steps };
    }
    case "reopened": {
      const txs = ids.map((id) => txById.get(id));
      if (txs.some((t) => t == null)) return blocked("gone");
      if (txs.some((t) => t!.status !== "planned")) return blocked("changed");
      return { ok: true, steps: [{ kind: "completeTransaction", id: txs[0]!.id }] };
    }
    case "legacy":
    case "unlegacy": {
      const steps: UndoStep[] = [];
      for (const e of group) {
        const tx = txById.get(e.entityId);
        if (!tx) return blocked("gone");
        const [before, after] = e.changes.legacy ?? [entry.action !== "legacy", entry.action === "legacy"];
        if (tx.legacy !== after) return blocked("changed");
        steps.push({ kind: "setLegacy", id: tx.id, legacy: Boolean(before) });
      }
      return { ok: true, steps };
    }
    default:
      return blocked("unsupported");
  }
}

/** A transfer "created" entry names no row: find it by its accounts, date and amounts, newest first. */
function findCreatedTransfer(group: ActivityEntry[], transactions: readonly Transaction[]): Transaction | null {
  const from = group.find((e) => Number(e.changes.amount?.[1]) < 0);
  const to = group.find((e) => Number(e.changes.amount?.[1]) > 0);
  if (!from?.accountId || !to?.accountId) return null;
  const date = String(from.changes.dueDate?.[1] ?? "");
  const legs = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.transferGroupId) continue;
    const list = legs.get(t.transferGroupId);
    if (list) list.push(t);
    else legs.set(t.transferGroupId, [t]);
  }
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const matches = [...legs.values()]
    .filter((pair) => {
      const out = pair.find((t) => t.direction === "expense" && t.accountId === from.accountId);
      const into = pair.find((t) => t.direction === "income" && t.accountId === to.accountId);
      return (
        out != null &&
        into != null &&
        out.dueDate === date &&
        close(out.amount, -Number(from.changes.amount![1])) &&
        close(into.amount, Number(to.changes.amount![1]))
      );
    })
    .map((pair) => pair[0])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0] ?? null;
}

function planAccount(entry: ActivityEntry, state: UndoState): UndoPlan {
  // an expected statement is logged against its card; it isn't the account's own edit
  if ("expected" in entry.changes) return blocked("unsupported");
  const account = state.accounts.find((a) => a.id === entry.entityId);

  switch (entry.action) {
    case "archived":
    case "restored": {
      if (!account) return blocked("gone");
      const [before, after] = entry.changes.archived ?? [entry.action === "restored", entry.action === "archived"];
      if (account.archived !== after) return blocked("changed");
      return { ok: true, steps: [{ kind: "updateAccount", id: account.id, patch: { archived: Boolean(before) } }] };
    }
    case "edited": {
      if (!account) return blocked("gone");
      const patch: Record<string, unknown> = {};
      for (const [field, [before, after]] of Object.entries(entry.changes)) {
        if (!(ACCOUNT_EDITABLE as readonly string[]).includes(field)) return blocked("unsupported");
        if (!same(account[field as keyof Account], after)) return blocked("changed");
        patch[field] = before;
      }
      if (Object.keys(patch).length === 0) return blocked("unsupported");
      return { ok: true, steps: [{ kind: "updateAccount", id: account.id, patch }] };
    }
    case "created": {
      if (!account) return blocked("gone");
      // an account that's been used since: deleting it would take its rows too
      if (state.transactions.some((t) => t.accountId === account.id)) return blocked("changed");
      return { ok: true, steps: [{ kind: "deleteAccount", id: account.id }] };
    }
    case "undone": {
      // brought back by an undo: undoing that deletes it again, its copy kept as before
      if (!account) return blocked("gone");
      return { ok: true, steps: [{ kind: "deleteAccount", id: account.id }] };
    }
    case "deleted": {
      const saved = snap<Account>(entry, "_account");
      if (!saved) return blocked("noSnapshot");
      if (account || state.accounts.some((a) => a.id === saved.id)) return blocked("exists");
      const rows = snap<Transaction[]>(entry, "_rows") ?? [];
      const present = new Set(state.transactions.map((t) => t.id));
      const accountIds = new Set(state.accounts.map((a) => a.id));
      return {
        ok: true,
        steps: [
          {
            kind: "restore",
            set: {
              accounts: [{ ...saved, paymentAccountId: saved.paymentAccountId && accountIds.has(saved.paymentAccountId) ? saved.paymentAccountId : null }],
              transactions: rows.filter((r) => !present.has(r.id)),
              cardEstimates: snap<CardEstimate[]>(entry, "_estimates") ?? [],
              payers: (snap<string[]>(entry, "_payers") ?? []).filter((id) => accountIds.has(id)),
              loans: snap<LoanLink[]>(entry, "_loans") ?? [],
            },
          },
        ],
      };
    }
    default:
      return blocked("unsupported");
  }
}
