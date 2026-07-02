import { FxSnapshot } from "@/lib/domain/fx";
import { computeMissingOccurrences, findAutoCompletable } from "@/lib/domain/materialize";
import { sumAmounts } from "@/lib/domain/money";
import {
  MarkPaidInput,
  NewAccount,
  NewLoan,
  NewPurchase,
  NewTemplate,
  NewTransaction,
  NewTransfer,
  NewVictvsSession,
  Repo,
} from "./repo";
import { buildPurchaseTransactionSpecs } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { buildDemoSeed, DemoStore } from "./demoSeed";
import { amortizationSchedule } from "@/lib/domain/loan";
import {
  Account,
  Budget,
  Category,
  Goal,
  Loan,
  Purchase,
  RecurringTemplate,
  Transaction,
  TxDirection,
  UserSettings,
  VictvsPayout,
  VictvsSession,
} from "./types";
import { Currency } from "@/lib/domain/currencies";

// bump the suffix whenever the DemoStore shape changes — old sandboxes reseed
const STORAGE_KEY = "renovator-demo-v3";

const uuid = () => crypto.randomUUID();

function load(): DemoStore {
  if (typeof window === "undefined") return buildDemoSeed();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as DemoStore;
    } catch {
      // corrupted → reseed
    }
  }
  const seed = buildDemoSeed();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return seed;
}

/**
 * Sandbox repo for "try without signing up": all data lives in this browser's
 * localStorage, seeded with a realistic dataset. Same interface, same domain
 * logic (materialization, auto-complete, payouts) as the Supabase repo.
 */
export class DemoRepo implements Repo {
  readonly mode = "demo" as const;
  private store: DemoStore;

  constructor() {
    this.store = load();
  }

  private save(): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    }
  }

  async listAccounts(): Promise<Account[]> {
    return [...this.store.accounts];
  }

  async createAccount(input: NewAccount): Promise<Account> {
    const account: Account = {
      id: uuid(),
      archived: false,
      createdAt: new Date().toISOString(),
      ...input,
      paymentAccountId: input.paymentAccountId ?? null,
    };
    this.store.accounts.push(account);
    this.save();
    return account;
  }

  async updateAccount(id: string, patch: Partial<NewAccount> & { archived?: boolean }): Promise<void> {
    const account = this.store.accounts.find((a) => a.id === id);
    if (account) Object.assign(account, patch);
    this.save();
  }

  async deleteAccount(id: string): Promise<void> {
    this.store.accounts = this.store.accounts.filter((a) => a.id !== id);
    this.store.transactions = this.store.transactions.filter((t) => t.accountId !== id);
    this.store.templates = this.store.templates.filter((t) => t.accountId !== id);
    for (const a of this.store.accounts) if (a.paymentAccountId === id) a.paymentAccountId = null;
    for (const p of this.store.purchases) if (p.accountId === id) p.accountId = null;
    this.save();
  }

  async listCategories(): Promise<Category[]> {
    return [...this.store.categories];
  }

  async createCategory(input: { name: string; direction: TxDirection; color: string }): Promise<Category> {
    const category: Category = { id: uuid(), ...input };
    this.store.categories.push(category);
    this.save();
    return category;
  }

  async deleteCategory(id: string): Promise<void> {
    this.store.categories = this.store.categories.filter((c) => c.id !== id);
    for (const t of this.store.transactions) if (t.categoryId === id) t.categoryId = null;
    for (const t of this.store.templates) if (t.categoryId === id) t.categoryId = null;
    for (const p of this.store.purchases) if (p.categoryId === id) p.categoryId = null;
    this.save();
  }

  async seedDefaultCategories(): Promise<void> {
    // demo store is seeded at construction
  }

  async listTransactions(): Promise<Transaction[]> {
    return [...this.store.transactions];
  }

  async createTransaction(input: NewTransaction): Promise<Transaction> {
    const tx: Transaction = {
      id: uuid(),
      accountId: input.accountId,
      direction: input.direction,
      categoryId: input.categoryId,
      amount: input.amount,
      status: input.status,
      dueDate: input.dueDate,
      completedAt: input.status === "completed" ? new Date().toISOString() : null,
      description: input.description,
      fxSnapshot: input.status === "completed" ? input.fxSnapshot : null,
      transferGroupId: null,
      transferMarketRate: null,
      recurringTemplateId: input.recurringTemplateId ?? null,
      loanId: input.loanId ?? null,
      victvsPayoutId: null,
      purchaseId: null,
      createdAt: new Date().toISOString(),
    };
    this.store.transactions.push(tx);
    this.save();
    return tx;
  }

  async updateTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>
  ): Promise<void> {
    const tx = this.store.transactions.find((t) => t.id === id);
    if (tx) Object.assign(tx, patch);
    this.save();
  }

  async completeTransaction(id: string, fxSnapshot: FxSnapshot, amount?: number): Promise<void> {
    const tx = this.store.transactions.find((t) => t.id === id);
    if (!tx) return;
    tx.status = "completed";
    tx.completedAt = new Date().toISOString();
    tx.fxSnapshot = fxSnapshot;
    if (amount != null) tx.amount = amount;
    this.save();
  }

  async reopenTransaction(id: string): Promise<void> {
    const tx = this.store.transactions.find((t) => t.id === id);
    if (!tx) return;
    tx.status = "planned";
    tx.completedAt = null;
    tx.fxSnapshot = null;
    this.save();
  }

  async deleteTransaction(id: string): Promise<void> {
    const tx = this.store.transactions.find((t) => t.id === id);
    // deleting one leg of a transfer removes both
    this.store.transactions = this.store.transactions.filter((t) =>
      tx?.transferGroupId ? t.transferGroupId !== tx.transferGroupId : t.id !== id
    );
    this.save();
  }

  async createTransfer(input: NewTransfer): Promise<void> {
    const groupId = uuid();
    const now = new Date().toISOString();
    const from = this.store.accounts.find((a) => a.id === input.fromAccountId);
    const to = this.store.accounts.find((a) => a.id === input.toAccountId);
    const base = {
      categoryId: null,
      status: "completed" as const,
      dueDate: input.date,
      completedAt: now,
      fxSnapshot: input.fxSnapshot,
      transferGroupId: groupId,
      transferMarketRate: input.marketRate,
      recurringTemplateId: null,
      loanId: null,
      victvsPayoutId: null,
      purchaseId: null,
      createdAt: now,
    };
    this.store.transactions.push(
      {
        ...base,
        id: uuid(),
        accountId: input.fromAccountId,
        direction: "expense",
        amount: input.fromAmount,
        description: input.description || `To ${to?.name ?? "account"}`,
      },
      {
        ...base,
        id: uuid(),
        accountId: input.toAccountId,
        direction: "income",
        amount: input.toAmount,
        description: input.description || `From ${from?.name ?? "account"}`,
      }
    );
    this.save();
  }

  async listTemplates(): Promise<RecurringTemplate[]> {
    return [...this.store.templates];
  }

  async createTemplate(input: NewTemplate): Promise<RecurringTemplate> {
    const template: RecurringTemplate = {
      id: uuid(),
      loanId: input.loanId ?? null,
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.store.templates.push(template);
    this.save();
    return template;
  }

  async updateTemplate(id: string, patch: Partial<NewTemplate>): Promise<void> {
    const template = this.store.templates.find((t) => t.id === id);
    if (template) Object.assign(template, patch);
    this.save();
  }

  async deleteTemplate(id: string, deletePlanned: boolean): Promise<void> {
    this.store.templates = this.store.templates.filter((t) => t.id !== id);
    if (deletePlanned) {
      this.store.transactions = this.store.transactions.filter(
        (t) => !(t.recurringTemplateId === id && t.status === "planned")
      );
    }
    this.save();
  }

  async materializeTemplates(monthsAhead: number): Promise<number> {
    const missing = computeMissingOccurrences(this.store.templates, this.store.transactions, monthsAhead);
    const now = new Date().toISOString();
    for (const { template, dueDate } of missing) {
      this.store.transactions.push({
        id: uuid(),
        accountId: template.accountId,
        direction: template.direction,
        categoryId: template.categoryId,
        amount: template.amount,
        status: "planned",
        dueDate,
        completedAt: null,
        description: template.name,
        fxSnapshot: null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: template.id,
        loanId: template.loanId,
        victvsPayoutId: null,
        purchaseId: null,
        createdAt: now,
      });
    }
    if (missing.length) this.save();
    return missing.length;
  }

  async autoCompleteDue(fxSnapshot: FxSnapshot): Promise<number> {
    const due = findAutoCompletable(this.store.templates, this.store.transactions);
    const now = new Date().toISOString();
    for (const tx of due) {
      tx.status = "completed";
      tx.completedAt = now;
      tx.fxSnapshot = fxSnapshot;
    }
    if (due.length) this.save();
    return due.length;
  }

  async listVictvsSessions(): Promise<VictvsSession[]> {
    return [...this.store.victvsSessions];
  }

  async listVictvsPayouts(): Promise<VictvsPayout[]> {
    return [...this.store.victvsPayouts];
  }

  async createVictvsSessions(inputs: NewVictvsSession[]): Promise<number> {
    const now = new Date().toISOString();
    for (const input of inputs) {
      this.store.victvsSessions.push({
        id: uuid(),
        date: input.date,
        sessionType: input.sessionType,
        amount: input.amount,
        status: "unpaid",
        payoutId: null,
        notes: input.notes ?? "",
        source: input.source,
        createdAt: now,
      });
    }
    this.save();
    return inputs.length;
  }

  async updateVictvsSession(
    id: string,
    patch: Partial<Pick<VictvsSession, "date" | "sessionType" | "amount" | "notes">>
  ): Promise<void> {
    const session = this.store.victvsSessions.find((s) => s.id === id);
    if (session) Object.assign(session, patch);
    this.save();
  }

  async deleteVictvsSession(id: string): Promise<void> {
    this.store.victvsSessions = this.store.victvsSessions.filter((s) => s.id !== id);
    this.save();
  }

  async markVictvsPaid(input: MarkPaidInput): Promise<void> {
    const now = new Date().toISOString();
    const payoutId = uuid();
    const txId = uuid();
    this.store.transactions.push({
      id: txId,
      accountId: input.accountId,
      direction: "income",
      categoryId: input.categoryId,
      amount: input.receivedAmount,
      status: "completed",
      dueDate: input.paymentDate,
      completedAt: now,
      description: `VICTVS payout (${input.sessionIds.length} sessions)`,
      fxSnapshot: input.fxSnapshot,
      transferGroupId: null,
      transferMarketRate: null,
      recurringTemplateId: null,
      loanId: null,
      victvsPayoutId: payoutId,
      purchaseId: null,
      createdAt: now,
    });
    const payout: VictvsPayout = {
      id: payoutId,
      paymentDate: input.paymentDate,
      accountId: input.accountId,
      total: input.totalUsd,
      transactionId: txId,
      sessionCount: input.sessionIds.length,
      createdAt: now,
    };
    this.store.victvsPayouts.push(payout);
    for (const session of this.store.victvsSessions) {
      if (input.sessionIds.includes(session.id)) {
        session.status = "paid";
        session.payoutId = payoutId;
      }
    }
    this.save();
  }

  async unmarkVictvsPayout(payoutId: string): Promise<void> {
    const payout = this.store.victvsPayouts.find((p) => p.id === payoutId);
    if (!payout) return;
    this.store.transactions = this.store.transactions.filter((t) => t.id !== payout.transactionId);
    for (const session of this.store.victvsSessions) {
      if (session.payoutId === payoutId) {
        session.status = "unpaid";
        session.payoutId = null;
      }
    }
    this.store.victvsPayouts = this.store.victvsPayouts.filter((p) => p.id !== payoutId);
    this.save();
  }

  async listBudgets(): Promise<Budget[]> {
    return [...this.store.budgets];
  }

  async setBudget(categoryId: string, monthlyLimit: number | null, currency: Currency): Promise<void> {
    this.store.budgets = this.store.budgets.filter((b) => b.categoryId !== categoryId);
    if (monthlyLimit != null && monthlyLimit > 0) {
      this.store.budgets.push({ id: uuid(), categoryId, monthlyLimit, currency });
    }
    this.save();
  }

  async listGoals(): Promise<Goal[]> {
    return [...this.store.goals];
  }

  async createGoal(input: { name: string; accountId: string; targetAmount: number; targetDate: string | null }): Promise<Goal> {
    const goal: Goal = { id: uuid(), createdAt: new Date().toISOString(), ...input };
    this.store.goals.push(goal);
    this.save();
    return goal;
  }

  async updateGoal(id: string, patch: Partial<{ name: string; targetAmount: number; targetDate: string | null }>): Promise<void> {
    const goal = this.store.goals.find((g) => g.id === id);
    if (goal) Object.assign(goal, patch);
    this.save();
  }

  async deleteGoal(id: string): Promise<void> {
    this.store.goals = this.store.goals.filter((g) => g.id !== id);
    this.save();
  }

  async getUserSettings(): Promise<UserSettings> {
    return { ...this.store.settings };
  }

  async saveUserSettings(patch: Partial<UserSettings>): Promise<void> {
    this.store.settings = { ...this.store.settings, ...patch };
    this.save();
  }

  async listPurchases(): Promise<Purchase[]> {
    return [...this.store.purchases];
  }

  private createPurchaseTransactions(purchase: Purchase, fxSnapshot: FxSnapshot | null): void {
    const account = purchase.accountId ? this.store.accounts.find((a) => a.id === purchase.accountId) : null;
    if (!account) return;
    const now = new Date().toISOString();
    for (const spec of buildPurchaseTransactionSpecs(purchase, account.currency, todayISO())) {
      this.store.transactions.push({
        id: uuid(),
        accountId: account.id,
        direction: "expense",
        categoryId: purchase.categoryId,
        amount: spec.amount,
        status: spec.status,
        dueDate: spec.dueDate,
        completedAt: spec.status === "completed" ? now : null,
        description: spec.description,
        fxSnapshot: spec.status === "completed" ? fxSnapshot : null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: null,
        loanId: null,
        victvsPayoutId: null,
        purchaseId: purchase.id,
        createdAt: now,
      });
    }
  }

  async createPurchase(input: NewPurchase, fxSnapshot: FxSnapshot | null): Promise<Purchase> {
    const purchase: Purchase = { id: uuid(), createdAt: new Date().toISOString(), ...input };
    this.store.purchases.push(purchase);
    if (purchase.reflected && purchase.accountId) this.createPurchaseTransactions(purchase, fxSnapshot);
    this.save();
    return purchase;
  }

  async updatePurchase(id: string, patch: Partial<Pick<Purchase, "name" | "details" | "categoryId">>): Promise<void> {
    const purchase = this.store.purchases.find((p) => p.id === id);
    if (purchase) Object.assign(purchase, patch);
    this.save();
  }

  async setPurchaseReflected(id: string, reflected: boolean, fxSnapshot: FxSnapshot | null): Promise<void> {
    const purchase = this.store.purchases.find((p) => p.id === id);
    if (!purchase || purchase.reflected === reflected) return;
    this.store.transactions = this.store.transactions.filter((t) => t.purchaseId !== id);
    purchase.reflected = reflected;
    if (reflected && purchase.accountId) this.createPurchaseTransactions(purchase, fxSnapshot);
    this.save();
  }

  async deletePurchase(id: string, deleteTransactions: boolean): Promise<void> {
    this.store.purchases = this.store.purchases.filter((p) => p.id !== id);
    if (deleteTransactions) {
      this.store.transactions = this.store.transactions.filter((t) => t.purchaseId !== id);
    } else {
      for (const t of this.store.transactions) if (t.purchaseId === id) t.purchaseId = null;
    }
    this.save();
  }

  async listLoans(): Promise<Loan[]> {
    return [...this.store.loans];
  }

  async createLoan(input: NewLoan): Promise<Loan> {
    const now = new Date().toISOString();
    const schedule = amortizationSchedule(
      input.principal,
      input.monthlyRatePct,
      input.termMonths,
      input.startDate,
      input.currency
    );
    const loanId = uuid();
    const template = await this.createTemplate({
      name: `${input.name} installment`,
      accountId: input.accountId,
      direction: "expense",
      categoryId: input.categoryId,
      amount: schedule.installment,
      frequency: "monthly",
      startDate: schedule.rows[0].date,
      endDate: schedule.rows[schedule.rows.length - 1].date,
      autoComplete: input.autoComplete,
      loanId,
    });
    const loan: Loan = {
      id: loanId,
      name: input.name,
      kind: input.kind,
      currency: input.currency,
      principal: input.principal,
      monthlyRatePct: input.monthlyRatePct,
      termMonths: input.termMonths,
      startDate: input.startDate,
      installment: schedule.installment,
      recurringTemplateId: template.id,
      createdAt: now,
    };
    this.store.loans.push(loan);
    this.save();
    return loan;
  }

  async deleteLoan(id: string): Promise<void> {
    const loan = this.store.loans.find((l) => l.id === id);
    this.store.loans = this.store.loans.filter((l) => l.id !== id);
    if (loan?.recurringTemplateId) await this.deleteTemplate(loan.recurringTemplateId, true);
    this.save();
  }

  async deleteAllData(): Promise<void> {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    this.store = load();
  }
}

/** Paid-total helper reused by UI (kept here to avoid a circular import). */
export function victvsUnpaidTotal(sessions: VictvsSession[]): number {
  return sumAmounts(
    "USD",
    sessions.filter((s) => s.status === "unpaid").map((s) => s.amount)
  );
}
