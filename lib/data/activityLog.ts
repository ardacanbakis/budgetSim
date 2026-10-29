import { ACCOUNT_FIELDS, Changes, fieldChanges, TRANSACTION_FIELDS } from "@/lib/domain/activity";
import { Repo } from "./repo";
import { ActivityAction, ActivityEntity, ActivityEntry, Transaction } from "./types";

type NewEntry = Omit<ActivityEntry, "id">;

const TEMPLATE_FIELDS = ["name", "accountId", "direction", "categoryId", "amount", "frequency", "startDate", "endDate", "autoComplete"] as const;
const PURCHASE_FIELDS = ["name", "details", "categoryId", "reflected"] as const;

/**
 * The change history, written in one place for both repos: every write that
 * changes what you hold or owe goes through here, reads what it's about to
 * change, makes the change, and records which fields changed
 * (lib/domain/activity.ts). Reads pass straight through.
 *
 * Recording is best effort: the change itself has already happened, so a
 * history that can't be written (a database without migration 0018, a
 * dropped connection) never turns a successful save into an error.
 */
export function withActivityLog(inner: Repo): Repo {
  const now = () => new Date().toISOString();
  const entry = (
    entityType: ActivityEntity,
    entityId: string,
    accountId: string | null,
    action: ActivityAction,
    summary: string,
    changes: Changes = {}
  ): NewEntry => ({ at: now(), entityType, entityId, accountId, action, summary, changes });

  const record = async (entries: NewEntry[]) => {
    try {
      await inner.appendActivity(entries);
    } catch {
      // the change stands; only its history is missing
    }
  };

  const transactions = () => inner.listTransactions();
  /** a row and, for a transfer, its other leg */
  const withLegs = (all: Transaction[], id: string) => {
    const tx = all.find((t) => t.id === id);
    if (!tx) return [];
    return tx.transferGroupId ? all.filter((t) => t.transferGroupId === tx.transferGroupId) : [tx];
  };
  const txEntry = (t: Transaction, action: ActivityAction, changes: Changes) =>
    entry("transaction", t.id, t.accountId, action, t.description, { ...changes, dueDate: changes.dueDate ?? [t.dueDate, t.dueDate] });

  const logged: Partial<Repo> = {
    async createAccount(input) {
      const account = await inner.createAccount(input);
      await record([entry("account", account.id, account.id, "created", account.name, fieldChanges(null, account, ACCOUNT_FIELDS))]);
      return account;
    },
    async updateAccount(id, patch) {
      const before = (await inner.listAccounts()).find((a) => a.id === id);
      await inner.updateAccount(id, patch);
      if (!before) return;
      const changes = fieldChanges(before, { ...before, ...patch }, ACCOUNT_FIELDS);
      if (Object.keys(changes).length === 0) return;
      const action = patch.archived === true ? "archived" : patch.archived === false ? "restored" : "edited";
      await record([entry("account", id, id, action, before.name, changes)]);
    },
    async deleteAccount(id) {
      const before = (await inner.listAccounts()).find((a) => a.id === id);
      await inner.deleteAccount(id);
      if (before) await record([entry("account", id, null, "deleted", before.name, fieldChanges(before, null, ACCOUNT_FIELDS))]);
    },

    async createTransaction(input) {
      const tx = await inner.createTransaction(input);
      await record([txEntry(tx, tx.adjustment ? "adjusted" : "created", fieldChanges(null, tx, TRANSACTION_FIELDS))]);
      return tx;
    },
    async createTransactions(inputs) {
      const count = await inner.createTransactions(inputs);
      const byAccount = new Map<string, number>();
      for (const i of inputs) byAccount.set(i.accountId, (byAccount.get(i.accountId) ?? 0) + i.amount);
      await record(
        [...byAccount.entries()].map(([accountId, total]) =>
          entry("transaction", "bulk", accountId, "created", "", {
            count: [null, inputs.filter((i) => i.accountId === accountId).length],
            amount: [null, total],
          })
        )
      );
      return count;
    },
    async updateTransaction(id, patch) {
      const before = (await transactions()).find((t) => t.id === id);
      await inner.updateTransaction(id, patch);
      if (!before) return;
      const changes = fieldChanges(before, { ...before, ...patch }, TRANSACTION_FIELDS);
      if (Object.keys(changes).length > 0) await record([txEntry(before, "edited", changes)]);
    },
    async completeTransaction(id, fxSnapshot, amount, legacy) {
      const legs = withLegs(await transactions(), id);
      await inner.completeTransaction(id, fxSnapshot, amount, legacy);
      await record(
        legs
          .filter((t) => t.status !== "completed")
          .map((t) =>
            txEntry(t, "completed", {
              status: [t.status, "completed"],
              ...(amount != null && t.id === id && amount !== t.amount ? { amount: [t.amount, amount] } : {}),
              ...(legacy != null && legacy !== t.legacy ? { legacy: [t.legacy, legacy] } : {}),
            })
          )
      );
    },
    async reopenTransaction(id) {
      const legs = withLegs(await transactions(), id);
      await inner.reopenTransaction(id);
      await record(legs.filter((t) => t.status === "completed").map((t) => txEntry(t, "reopened", { status: ["completed", "planned"] })));
    },
    async setTransactionLegacy(id, legacy) {
      const legs = withLegs(await transactions(), id);
      await inner.setTransactionLegacy(id, legacy);
      await record(legs.filter((t) => t.legacy !== legacy).map((t) => txEntry(t, legacy ? "legacy" : "unlegacy", { legacy: [t.legacy, legacy] })));
    },
    async bulkCompleteAsLegacy(ids, fxSnapshot) {
      const all = await transactions();
      const touched = new Map<string, Transaction>();
      for (const id of ids) for (const t of withLegs(all, id)) if (t.status === "planned") touched.set(t.id, t);
      const count = await inner.bulkCompleteAsLegacy(ids, fxSnapshot);
      await record([...touched.values()].map((t) => txEntry(t, "completed", { status: ["planned", "completed"], legacy: [t.legacy, true] })));
      return count;
    },
    async deleteTransaction(id) {
      const legs = withLegs(await transactions(), id);
      await inner.deleteTransaction(id);
      await record(legs.map((t) => txEntry(t, "deleted", fieldChanges(t, null, TRANSACTION_FIELDS))));
    },
    async createTransfer(input) {
      await inner.createTransfer(input);
      const id = `transfer:${input.date}:${input.fromAccountId}:${input.toAccountId}`;
      await record([
        entry("transaction", id, input.fromAccountId, "created", input.description, { amount: [null, -input.fromAmount], dueDate: [null, input.date] }),
        entry("transaction", id, input.toAccountId, "created", input.description, { amount: [null, input.toAmount], dueDate: [null, input.date] }),
      ]);
    },
    async autoCompleteDue(fxSnapshot) {
      const before = await transactions();
      const count = await inner.autoCompleteDue(fxSnapshot);
      if (count > 0) {
        const after = new Map((await transactions()).map((t) => [t.id, t]));
        await record(
          before
            .filter((t) => t.status === "planned" && after.get(t.id)?.status === "completed")
            .map((t) => txEntry(t, "autoCompleted", { status: ["planned", "completed"] }))
        );
      }
      return count;
    },

    async createTemplate(input, backfill) {
      const tpl = await inner.createTemplate(input, backfill);
      await record([entry("template", tpl.id, tpl.accountId, "created", tpl.name, fieldChanges(null, tpl, TEMPLATE_FIELDS))]);
      return tpl;
    },
    async updateTemplate(id, patch) {
      const before = (await inner.listTemplates()).find((t) => t.id === id);
      await inner.updateTemplate(id, patch);
      if (!before) return;
      const changes = fieldChanges(before, { ...before, ...patch }, TEMPLATE_FIELDS);
      if (Object.keys(changes).length > 0) await record([entry("template", id, before.accountId, "edited", before.name, changes)]);
    },
    async deleteTemplate(id, deletePlanned) {
      const before = (await inner.listTemplates()).find((t) => t.id === id);
      const planned = (await transactions()).filter((t) => t.recurringTemplateId === id && t.status === "planned").length;
      await inner.deleteTemplate(id, deletePlanned);
      if (!before) return;
      await record([
        entry("template", id, before.accountId, "deleted", before.name, {
          ...fieldChanges(before, null, TEMPLATE_FIELDS),
          plannedRemoved: [planned, deletePlanned ? 0 : planned],
        }),
      ]);
    },

    async createPurchase(input, fxSnapshot) {
      const purchase = await inner.createPurchase(input, fxSnapshot);
      await record([
        entry("purchase", purchase.id, purchase.accountId, "created", purchase.name, {
          amount: [null, purchase.amount],
          installmentCount: [null, purchase.installmentCount],
          firstDue: [null, purchase.firstDue],
        }),
      ]);
      return purchase;
    },
    async updatePurchase(id, patch) {
      const before = (await inner.listPurchases()).find((p) => p.id === id);
      await inner.updatePurchase(id, patch);
      if (!before) return;
      const changes = fieldChanges(before, { ...before, ...patch }, PURCHASE_FIELDS);
      if (Object.keys(changes).length > 0) await record([entry("purchase", id, before.accountId, "edited", before.name, changes)]);
    },
    async setPurchaseReflected(id, reflected, fxSnapshot) {
      const before = (await inner.listPurchases()).find((p) => p.id === id);
      await inner.setPurchaseReflected(id, reflected, fxSnapshot);
      if (before && before.reflected !== reflected) {
        await record([entry("purchase", id, before.accountId, reflected ? "reflected" : "unreflected", before.name, { reflected: [before.reflected, reflected] })]);
      }
    },
    async deletePurchase(id, deleteTransactions) {
      const before = (await inner.listPurchases()).find((p) => p.id === id);
      await inner.deletePurchase(id, deleteTransactions);
      if (before) {
        await record([
          entry("purchase", id, before.accountId, "deleted", before.name, {
            amount: [before.amount, null],
            installmentCount: [before.installmentCount, null],
            transactionsDeleted: [null, deleteTransactions],
          }),
        ]);
      }
    },

    async createLoan(input) {
      const loan = await inner.createLoan(input);
      await record([entry("loan", loan.id, input.accountId, "created", loan.name, { principal: [null, loan.principal], termMonths: [null, loan.termMonths] })]);
      return loan;
    },
    async deleteLoan(id) {
      const before = (await inner.listLoans()).find((l) => l.id === id);
      await inner.deleteLoan(id);
      if (before) await record([entry("loan", id, null, "deleted", before.name, { principal: [before.principal, null] })]);
    },

    async markVictvsPaid(input) {
      await inner.markVictvsPaid(input);
      await record([
        entry("victvs", `payout:${input.paymentDate}`, input.accountId, "paid", "VICTVS", {
          sessions: [null, input.sessionIds.length],
          amount: [null, input.receivedAmount],
          usd: [null, input.totalUsd],
        }),
      ]);
    },
    async unmarkVictvsPayout(payoutId) {
      const before = (await inner.listVictvsPayouts()).find((p) => p.id === payoutId);
      await inner.unmarkVictvsPayout(payoutId);
      if (before) {
        await record([entry("victvs", payoutId, before.accountId, "unpaid", "VICTVS", { sessions: [before.sessionCount, 0], usd: [before.total, null] })]);
      }
    },

    async importAll(backup) {
      await inner.importAll(backup);
      await record([entry("backup", "restore", null, "restored", backup.exportedAt, { accounts: [null, backup.accounts.length], transactions: [null, backup.transactions.length] })]);
    },

    // a failed read of the history is an empty history, not a broken page
    async listActivity() {
      try {
        return await inner.listActivity();
      } catch {
        return [];
      }
    },
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(logged, prop)) return logged[prop as keyof Repo];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
