import { FixFile, FixState, FixStep, evaluateStep, findTransfer, planFixes } from "@/lib/domain/fixFile";
import { FxSnapshot } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { Repo } from "./repo";

/**
 * Applies a fix file (lib/domain/fixFile.ts) through the repo, one step at a
 * time, so each change is the same write the app's own forms make and lands
 * in the history like one.
 *
 * Before each step the records are read again and the step checked again:
 * one already done is skipped, and one that no longer matches stops the run
 * there. A run that stops halfway can simply be started again.
 */

export interface FixContext {
  /** rates frozen onto rows completed by a step */
  fxSnapshot: FxSnapshot;
  /** Data check dismissals are kept on the device, not in the repo */
  dismissed: () => ReadonlySet<string>;
  dismiss: (issueId: string) => void;
}

export interface FixRunResult {
  applied: number;
  skipped: number;
}

async function readState(repo: Repo, ctx: FixContext): Promise<FixState> {
  const [accounts, transactions, purchases, loans] = await Promise.all([
    repo.listAccounts(),
    repo.listTransactions(),
    repo.listPurchases(),
    repo.listLoans(),
  ]);
  return { accounts, transactions, purchases, loans, dismissed: ctx.dismissed() };
}

export class FixMismatchError extends Error {
  constructor(readonly step: number) {
    super(`step ${step + 1} no longer matches the records`);
  }
}

export async function applyFixFile(
  repo: Repo,
  file: FixFile,
  ctx: FixContext,
  onStep?: (index: number) => void
): Promise<FixRunResult> {
  // nothing at all when any step is already off: a half-applied fix is worse than none
  if (planFixes(file, await readState(repo, ctx)).blocked) throw new FixMismatchError(-1);
  let applied = 0;
  let skipped = 0;
  for (const [index, step] of file.steps.entries()) {
    onStep?.(index);
    const state = await readState(repo, ctx);
    const verdict = evaluateStep(step, state);
    if (verdict.status === "mismatch") throw new FixMismatchError(index);
    if (verdict.status === "done") {
      skipped++;
      continue;
    }
    await applyStep(repo, step, state, ctx);
    applied++;
  }
  return { applied, skipped };
}

async function applyStep(repo: Repo, step: FixStep, state: FixState, ctx: FixContext): Promise<void> {
  const currencyOf = (id: string) => state.accounts.find((a) => a.id === id)?.currency ?? "TRY";
  const settled = (date: string) => date <= todayISO();
  switch (step.op) {
    case "editTransaction":
      await repo.updateTransaction(step.id, step.set);
      return;
    case "deleteTransaction":
      await repo.deleteTransaction(step.id);
      return;
    case "createTransfer": {
      // already there but not yet history: only the flag is missing
      let legs = findTransfer(step, state.transactions, currencyOf);
      if (!legs) {
        await repo.createTransfer({
          fromAccountId: step.from,
          toAccountId: step.to,
          fromAmount: step.fromAmount,
          toAmount: step.toAmount ?? step.fromAmount,
          date: step.date,
          description: step.description,
          marketRate: null,
          fxSnapshot: ctx.fxSnapshot,
        });
        legs = findTransfer(step, await repo.listTransactions(), currencyOf);
      }
      // both legs together (setTransactionLegacy follows the transfer)
      if (step.legacy && legs) await repo.setTransactionLegacy(legs[0].id, true);
      return;
    }
    case "createTransaction": {
      const done = settled(step.date);
      await repo.createTransaction({
        accountId: step.accountId,
        direction: step.direction,
        categoryId: step.categoryId ?? null,
        amount: step.amount,
        status: done ? "completed" : "planned",
        dueDate: step.date,
        description: step.description,
        fxSnapshot: done ? ctx.fxSnapshot : null,
        legacy: step.legacy ?? false,
      });
      return;
    }
    case "completeTransactions": {
      const byId = new Map(state.transactions.map((t) => [t.id, t] as const));
      for (const id of step.ids) {
        // a transfer's other leg completes with it, so check again as we go
        if (byId.get(id)?.status !== "planned") continue;
        await repo.completeTransaction(id, ctx.fxSnapshot);
        const legs = byId.get(id)?.transferGroupId;
        if (legs) for (const t of state.transactions) if (t.transferGroupId === legs) byId.set(t.id, { ...t, status: "completed" });
      }
      return;
    }
    case "createPurchase":
      await repo.createPurchase(
        {
          name: step.name,
          accountId: step.accountId,
          amount: step.amount,
          purchaseDate: step.purchaseDate,
          installmentCount: step.installments,
          firstDue: step.firstDue,
          details: step.details ?? "",
          reflected: true,
          categoryId: step.categoryId ?? null,
        },
        ctx.fxSnapshot
      );
      return;
    case "createDebt": {
      const via = step.purchaseId ?? null;
      // as the debt form makes one: repaid through a card's installments, or in one payment
      await repo.createLoan({
        name: step.name,
        kind: "other",
        currency: currencyOf(step.payAccountId),
        principal: step.principal,
        monthlyRatePct: 0,
        termMonths: 1,
        startDate: step.date,
        accountId: step.payAccountId,
        categoryId: null,
        autoComplete: false,
        scheduleKind: "lumpSum",
        kkdfPct: 0,
        bsmvPct: 0,
        direction: "owe",
        counterparty: step.counterparty ?? null,
        depositAccountId: null,
        purchaseId: via,
        payoffDate: null,
        fxSnapshot: ctx.fxSnapshot,
      });
      return;
    }
    case "dismissIssue":
      ctx.dismiss(step.issueId);
      return;
  }
}
