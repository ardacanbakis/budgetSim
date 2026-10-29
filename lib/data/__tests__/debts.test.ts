import { describe, expect, it } from "vitest";
import { computeBalances } from "@/lib/domain/balances";
import { buildCardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { loanProgress } from "@/lib/domain/debt";
import { FxSnapshot } from "@/lib/domain/fx";
import { addDays, addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { withActivityLog } from "../activityLog";
import { DemoRepo } from "../demoRepo";
import { Repo } from "../repo";

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-29T09:00:00.000Z" };

async function fresh(): Promise<{ repo: Repo; enpara: string; ziraat: string }> {
  const repo = withActivityLog(new DemoRepo());
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: snapshot.at,
    accounts: [],
    categories: [],
    transactions: [],
    templates: [],
    victvsSessions: [],
    victvsPayouts: [],
    loans: [],
    purchases: [],
    budgets: [],
    goals: [],
    snapshots: [],
  });
  const enpara = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 1000 });
  const ziraat = await repo.createAccount({ name: "Ziraat TRY", currency: "TRY", kind: "fiat", openingBalance: 0 });
  return { repo, enpara: enpara.id, ziraat: ziraat.id };
}

const today = todayISO();
const lastMonth = addMonthsClamped(today, -1);
const inTwoMonths = addMonthsClamped(today, 2);

const friend = (accountId: string) => ({
  name: "Ahmet",
  kind: "personal" as const,
  currency: "TRY" as const,
  principal: 12500,
  monthlyRatePct: 0,
  termMonths: 1,
  startDate: lastMonth,
  accountId,
  categoryId: null,
  autoComplete: false,
  scheduleKind: "lumpSum" as const,
  counterparty: "Ahmet",
  depositAccountId: accountId,
  fxSnapshot: snapshot,
});

describe("debts in the demo repo", () => {
  it("borrowed when I can: the money lands, isn't income, and a date plans the one payment for what's left", async () => {
    const { repo, enpara } = await fresh();
    const loan = await repo.createLoan(friend(enpara));
    let txs = await repo.listTransactions();
    const money = txs.filter((t) => t.loanId === loan.id);
    expect(money).toEqual([expect.objectContaining({ direction: "income", amount: 12500, status: "completed", loanPrincipal: true })]);
    const accounts = await repo.listAccounts();
    expect(computeBalances(accounts, txs).get(enpara)).toBe(13500);
    expect(isIncome(money[0], buildCardBook(accounts, txs))).toBe(false);
    expect(loanProgress(loan, txs).remaining).toBe(12500);

    // pay some back, then pick a date: the rest is planned on it
    await repo.createTransaction({ accountId: enpara, direction: "expense", categoryId: null, amount: 5000, status: "completed", dueDate: today, description: "Ahmet", fxSnapshot: snapshot, loanId: loan.id });
    await repo.updateLoan(loan.id, { payoffDate: inTwoMonths });
    txs = await repo.listTransactions();
    const planned = txs.filter((t) => t.loanId === loan.id && t.status === "planned");
    expect(planned).toEqual([expect.objectContaining({ direction: "expense", amount: 7500, dueDate: inTwoMonths, accountId: enpara })]);
    const stored = (await repo.listLoans()).find((l) => l.id === loan.id)!;
    expect(stored.payoffDate).toBe(inTwoMonths);
    expect(loanProgress(stored, txs).remaining).toBe(7500);

    // back to "when I can": nothing planned
    await repo.updateLoan(loan.id, { payoffDate: null });
    expect((await repo.listTransactions()).filter((t) => t.loanId === loan.id && t.status === "planned")).toHaveLength(0);
    // the edit is in the history
    const log = await repo.listActivity();
    expect(log.some((e) => e.entityType === "loan" && e.action === "edited" && "payoffDate" in e.changes)).toBe(true);
  });

  it("lent: the money leaves without being spending, and coming back isn't income", async () => {
    const { repo, enpara } = await fresh();
    const loan = await repo.createLoan({ ...friend(enpara), direction: "lent", principal: 3000, payoffDate: inTwoMonths });
    const txs = (await repo.listTransactions()).filter((t) => t.loanId === loan.id);
    const out = txs.find((t) => t.direction === "expense")!;
    const back = txs.find((t) => t.direction === "income")!;
    expect(out).toMatchObject({ amount: 3000, status: "completed", loanPrincipal: true });
    expect(back).toMatchObject({ amount: 3000, status: "planned", dueDate: inTwoMonths, loanPrincipal: true });
    const book = buildCardBook(await repo.listAccounts(), txs);
    expect(isSpending(out, book)).toBe(false);
    expect(isIncome(back, book)).toBe(false);
  });

  it("a later date plans the money's own row, and a new paying account moves what's planned", async () => {
    const { repo, enpara, ziraat } = await fresh();
    const loan = await repo.createLoan({ ...friend(enpara), startDate: addDays(today, 10), payoffDate: inTwoMonths });
    await repo.updateLoan(loan.id, { payAccountId: ziraat });
    const txs = (await repo.listTransactions()).filter((t) => t.loanId === loan.id);
    expect(txs.find((t) => t.direction === "income")).toMatchObject({ status: "planned", accountId: enpara });
    expect(txs.find((t) => t.direction === "expense")).toMatchObject({ status: "planned", accountId: ziraat });
  });

  it("Move to Debts: an income already on the ledger becomes the money borrowed, not another row", async () => {
    const { repo, enpara } = await fresh();
    const advance = await repo.createTransaction({ accountId: enpara, direction: "income", categoryId: null, amount: 12500, status: "completed", dueDate: lastMonth, description: "nakit avans", fxSnapshot: snapshot });
    const loan = await repo.createLoan({ ...friend(enpara), receivedTxId: advance.id });
    const txs = await repo.listTransactions();
    expect(txs.filter((t) => t.loanId === loan.id)).toEqual([expect.objectContaining({ id: advance.id, loanPrincipal: true })]);
    expect(computeBalances(await repo.listAccounts(), txs).get(enpara)).toBe(13500);
  });

  it("Move to Debts: a recurring item and its rows join the debt; an early payoff ends it; deleting keeps it when asked", async () => {
    const { repo, ziraat } = await fresh();
    const start = addMonthsClamped(today, -2);
    const tpl = await repo.createTemplate(
      { name: "QNB 25k", accountId: ziraat, direction: "expense", categoryId: null, amount: 1000, frequency: "monthly", startDate: start, endDate: addMonthsClamped(start, 11), autoComplete: false },
      { mode: "paid", fxSnapshot: snapshot }
    );
    const loan = await repo.createLoan({
      name: "QNB 25k",
      kind: "other",
      currency: "TRY",
      principal: 12000,
      monthlyRatePct: 0,
      termMonths: 12,
      startDate: addMonthsClamped(start, -1),
      accountId: ziraat,
      categoryId: null,
      autoComplete: false,
      scheduleKind: "zeroInterest",
      counterparty: "QNB",
      templateId: tpl.id,
    });
    let txs = await repo.listTransactions();
    const rows = txs.filter((t) => t.recurringTemplateId === tpl.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.loanId === loan.id)).toBe(true);
    expect((await repo.listTemplates()).find((t) => t.id === tpl.id)?.loanId).toBe(loan.id);
    expect((await repo.listLoans()).find((l) => l.id === loan.id)?.recurringTemplateId).toBe(tpl.id);

    // pay the rest off in two months: the item ends the day before, one row for what's left
    const payoff = addMonthsClamped(today, 2);
    await repo.updateLoan(loan.id, { payoffDate: payoff });
    expect((await repo.listTemplates()).find((t) => t.id === tpl.id)?.endDate).toBe(addDays(payoff, -1));
    txs = await repo.listTransactions();
    const after = txs.filter((t) => t.loanId === loan.id && t.status === "planned");
    expect(after.filter((t) => t.dueDate >= payoff)).toEqual([expect.objectContaining({ description: "QNB 25k payoff", dueDate: payoff })]);

    // delete the debt but keep its rows: the item stays, unlinked
    await repo.deleteLoan(loan.id, true);
    expect((await repo.listTemplates()).find((t) => t.id === tpl.id)?.loanId).toBeNull();
    txs = await repo.listTransactions();
    expect(txs.some((t) => t.loanId === loan.id)).toBe(false);
    expect(txs.filter((t) => t.recurringTemplateId === tpl.id).length).toBeGreaterThan(0);
  });

  it("deleting a debt removes what it planned; the money that came in stays, as plain income again", async () => {
    const { repo, enpara } = await fresh();
    const loan = await repo.createLoan({ ...friend(enpara), payoffDate: inTwoMonths });
    await repo.deleteLoan(loan.id);
    const txs = await repo.listTransactions();
    expect(txs.filter((t) => t.status === "planned")).toHaveLength(0);
    const money = txs.find((t) => t.amount === 12500)!;
    expect(money.loanId).toBeNull();
    expect(money.loanPrincipal).toBeUndefined();
  });
});
