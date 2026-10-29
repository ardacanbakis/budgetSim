import { FxSnapshot } from "@/lib/domain/fx";
import {
  computeMissingOccurrences,
  findAutoCompletable,
  MATERIALIZE_MONTHS_AHEAD,
  planBackfill,
  rowsReplacedByEdit,
} from "@/lib/domain/materialize";
import { sumAmounts } from "@/lib/domain/money";
import {
  BackupFile,
  LoanPatch,
  MarkPaidInput,
  NewAccount,
  NewLoan,
  NewPurchase,
  NewTemplate,
  NewTransaction,
  NewTransfer,
  NewVictvsSession,
  VictvsSessionPatch,
  Repo,
  TemplateBackfill,
} from "./repo";
import { buildPurchaseTransactionSpecs } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { buildDemoSeed, DemoStore } from "./demoSeed";
import { debtRows, repaymentDirection, replanRepayments, scheduleOf, withDebtDefaults } from "@/lib/domain/debt";
import {
  Account,
  ActivityEntry,
  Budget,
  CardEstimate,
  Category,
  Goal,
  Loan,
  NetWorthSnapshot,
  PlanRecord,
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
const STORAGE_KEY = "renovator-demo-v5";

const uuid = () => crypto.randomUUID();

/**
 * Reads hand out copies, the way a network response would. Returning the
 * store's own objects let in-place updates (auto-complete, template edits)
 * reach into data already sitting in the query cache: the refetch then looked
 * identical to it, so screens that hadn't re-rendered for another reason
 * kept showing the old values.
 */
const copy = <T>(value: T): T => structuredClone(value);

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
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch (err) {
      // What didn't persist didn't happen: go back to what's stored, the way
      // a failed database write leaves the database as it was. Keeping the
      // change in memory made a retry find it "already done" and save nothing.
      this.store = load();
      throw err;
    }
  }

  async listAccounts(): Promise<Account[]> {
    return copy(this.store.accounts);
  }

  async createAccount(input: NewAccount): Promise<Account> {
    const account: Account = {
      id: uuid(),
      archived: false,
      createdAt: new Date().toISOString(),
      ...input,
      paymentAccountId: input.paymentAccountId ?? null,
      paymentDay: input.paymentDay ?? null,
      creditLimit: input.creditLimit ?? null,
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
    this.store.cardEstimates = (this.store.cardEstimates ?? []).filter((e) => e.accountId !== id);
    this.save();
  }

  async listCategories(): Promise<Category[]> {
    return copy(this.store.categories);
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

  async listPlans(): Promise<PlanRecord[]> {
    return copy([...(this.store.plans ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }

  async createPlan(name: string, body: unknown): Promise<PlanRecord> {
    const now = new Date().toISOString();
    const plan: PlanRecord = { id: uuid(), name, body, createdAt: now, updatedAt: now };
    this.store.plans = [...(this.store.plans ?? []), plan];
    this.save();
    return plan;
  }

  async updatePlan(id: string, patch: { name?: string; body?: unknown }): Promise<void> {
    const plan = (this.store.plans ?? []).find((p) => p.id === id);
    if (plan) {
      if (patch.name != null) plan.name = patch.name;
      if (patch.body !== undefined) plan.body = patch.body;
      plan.updatedAt = new Date().toISOString();
    }
    this.save();
  }

  async deletePlan(id: string): Promise<void> {
    this.store.plans = (this.store.plans ?? []).filter((p) => p.id !== id);
    this.save();
  }

  async listSavingsPlans(): Promise<PlanRecord[]> {
    return copy([...(this.store.savingsPlans ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }

  async createSavingsPlan(name: string, body: unknown): Promise<PlanRecord> {
    const now = new Date().toISOString();
    const plan: PlanRecord = { id: uuid(), name, body, createdAt: now, updatedAt: now };
    this.store.savingsPlans = [...(this.store.savingsPlans ?? []), plan];
    this.save();
    return plan;
  }

  async updateSavingsPlan(id: string, patch: { name?: string; body?: unknown }): Promise<void> {
    const plan = (this.store.savingsPlans ?? []).find((p) => p.id === id);
    if (plan) {
      if (patch.name != null) plan.name = patch.name;
      if (patch.body !== undefined) plan.body = patch.body;
      plan.updatedAt = new Date().toISOString();
    }
    this.save();
  }

  async deleteSavingsPlan(id: string): Promise<void> {
    this.store.savingsPlans = (this.store.savingsPlans ?? []).filter((p) => p.id !== id);
    this.save();
  }

  async listTransactions(): Promise<Transaction[]> {
    return copy(this.store.transactions);
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
      legacy: input.legacy ?? false,
      ...(input.adjustment ? { adjustment: true } : {}),
      ...(input.loanPrincipal ? { loanPrincipal: true } : {}),
      createdAt: new Date().toISOString(),
    };
    this.store.transactions.push(tx);
    this.save();
    return tx;
  }

  async createTransactions(inputs: NewTransaction[]): Promise<number> {
    for (const input of inputs) await this.createTransaction(input);
    return inputs.length;
  }

  async updateTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>
  ): Promise<void> {
    const tx = this.store.transactions.find((t) => t.id === id);
    if (tx) Object.assign(tx, patch);
    this.save();
  }

  /** the row, and the other leg of its transfer if it's one: the two move together */
  private withLegs(id: string): Transaction[] {
    const tx = this.store.transactions.find((t) => t.id === id);
    if (!tx) return [];
    return tx.transferGroupId ? this.store.transactions.filter((t) => t.transferGroupId === tx.transferGroupId) : [tx];
  }

  async completeTransaction(id: string, fxSnapshot: FxSnapshot, amount?: number, legacy?: boolean): Promise<void> {
    const now = new Date().toISOString();
    for (const tx of this.withLegs(id)) {
      // the other leg, already done, keeps when it was done and at what rates
      if (tx.id !== id && tx.status === "completed") continue;
      tx.status = "completed";
      tx.completedAt = now;
      tx.fxSnapshot = fxSnapshot;
      if (amount != null && tx.id === id) tx.amount = amount;
      if (legacy != null) tx.legacy = legacy;
    }
    this.save();
  }

  async reopenTransaction(id: string): Promise<void> {
    for (const tx of this.withLegs(id)) {
      tx.status = "planned";
      tx.completedAt = null;
      tx.fxSnapshot = null;
      tx.legacy = false;
    }
    this.save();
  }

  async setTransactionLegacy(id: string, legacy: boolean): Promise<void> {
    const legs = this.withLegs(id);
    if (!legs.length) return;
    for (const tx of legs) tx.legacy = legacy;
    this.save();
  }

  async bulkCompleteAsLegacy(ids: string[], fxSnapshot: FxSnapshot): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    // lists show one leg of a transfer: complete the other one with it
    const groups = new Set(
      this.store.transactions.filter((t) => ids.includes(t.id) && t.transferGroupId).map((t) => t.transferGroupId!)
    );
    for (const tx of this.store.transactions) {
      if ((ids.includes(tx.id) || (tx.transferGroupId != null && groups.has(tx.transferGroupId))) && tx.status === "planned") {
        tx.status = "completed";
        tx.completedAt = now;
        tx.fxSnapshot = fxSnapshot;
        tx.legacy = true;
        count += 1;
      }
    }
    if (count) this.save();
    return count;
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
    // a transfer you've scheduled hasn't left your account yet
    const settled = input.date <= todayISO();
    const base = {
      categoryId: null,
      status: (settled ? "completed" : "planned") as "completed" | "planned",
      dueDate: input.date,
      completedAt: settled ? now : null,
      fxSnapshot: settled ? input.fxSnapshot : null,
      transferGroupId: groupId,
      transferMarketRate: input.marketRate,
      recurringTemplateId: null,
      loanId: null,
      victvsPayoutId: null,
      purchaseId: null,
      legacy: false,
      ...(input.convertsId ? { convertsId: input.convertsId } : {}),
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
    return copy(this.store.templates);
  }

  async createTemplate(input: NewTemplate, backfill?: TemplateBackfill): Promise<RecurringTemplate> {
    const plan = backfill ? planBackfill(input, backfill.mode, todayISO()) : null;
    const template: RecurringTemplate = {
      id: uuid(),
      loanId: input.loanId ?? null,
      createdAt: new Date().toISOString(),
      ...input,
      startDate: plan?.startDate ?? input.startDate,
    };
    this.store.templates.push(template);
    for (const row of plan?.rows ?? []) {
      const completed = row.status === "completed";
      this.store.transactions.push({
        ...this.occurrence(template, row.dueDate, template.createdAt),
        status: row.status,
        completedAt: completed ? template.createdAt : null,
        fxSnapshot: completed ? backfill!.fxSnapshot : null,
        legacy: row.legacy,
      });
    }
    this.save();
    return template;
  }

  /** A template's planned row for one date, as materialization creates it. */
  private occurrence(template: RecurringTemplate, dueDate: string, now: string): Transaction {
    return {
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
      legacy: false,
      createdAt: now,
    };
  }

  async updateTemplate(id: string, patch: Partial<NewTemplate>): Promise<void> {
    const template = this.store.templates.find((t) => t.id === id);
    if (!template) return;
    Object.assign(template, patch);
    // joining a series changes nothing it plans
    if (Object.keys(patch).every((k) => k === "series")) return this.save();
    const replaced = new Set(rowsReplacedByEdit(id, template.endDate, this.store.transactions).map((t) => t.id));
    this.store.transactions = this.store.transactions.filter((t) => !replaced.has(t.id));
    this.save();
    await this.materializeTemplates(MATERIALIZE_MONTHS_AHEAD);
  }

  async deleteTemplate(id: string, deletePlanned: boolean): Promise<void> {
    this.store.templates = this.store.templates.filter((t) => t.id !== id);
    if (deletePlanned) {
      this.store.transactions = this.store.transactions.filter(
        (t) => !(t.recurringTemplateId === id && t.status === "planned")
      );
    }
    // the rows it keeps lose the link, as Supabase's "on delete set null" does
    for (const t of this.store.transactions) if (t.recurringTemplateId === id) t.recurringTemplateId = null;
    this.save();
  }

  async materializeTemplates(monthsAhead: number): Promise<number> {
    const missing = computeMissingOccurrences(this.store.templates, this.store.transactions, monthsAhead);
    const now = new Date().toISOString();
    for (const { template, dueDate } of missing) this.store.transactions.push(this.occurrence(template, dueDate, now));
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
    return copy(this.store.victvsSessions);
  }

  async listVictvsPayouts(): Promise<VictvsPayout[]> {
    return copy(this.store.victvsPayouts);
  }

  async createVictvsSessions(inputs: NewVictvsSession[]): Promise<number> {
    const now = new Date().toISOString();
    for (const input of inputs) {
      this.store.victvsSessions.push({
        id: uuid(),
        date: input.date,
        sessionType: input.sessionType,
        sessionNo: input.sessionNo ?? "",
        amount: input.amount,
        status: input.status ?? "unpaid",
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
    patch: VictvsSessionPatch
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
      legacy: input.legacy ?? false,
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

  async markVictvsUnpaid(sessionIds: string[]): Promise<void> {
    for (const session of this.store.victvsSessions) {
      if (sessionIds.includes(session.id)) {
        session.status = "unpaid";
        session.payoutId = null;
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
    return copy(this.store.budgets);
  }

  async setBudget(categoryId: string, monthlyLimit: number | null, currency: Currency): Promise<void> {
    this.store.budgets = this.store.budgets.filter((b) => b.categoryId !== categoryId);
    if (monthlyLimit != null && monthlyLimit > 0) {
      this.store.budgets.push({ id: uuid(), categoryId, monthlyLimit, currency });
    }
    this.save();
  }

  async listGoals(): Promise<Goal[]> {
    return copy(this.store.goals);
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
    // older sandboxes may miss newer fields — normalize
    const defaults: UserSettings = {
      dashboardLayout: null,
      theme: "system",
      compact: false,
      victvsAccountId: null,
      victvsDefaults: null,
      navOrder: null,
      dateFormat: null,
      showQuickAdd: null,
      showRateTicker: null,
      victvsForecast: null,
    };
    return copy({ ...defaults, ...(this.store.settings as Partial<UserSettings>) });
  }

  async saveUserSettings(patch: Partial<UserSettings>): Promise<void> {
    this.store.settings = { ...this.store.settings, ...patch };
    this.save();
  }

  async listCardEstimates(): Promise<CardEstimate[]> {
    return copy(this.store.cardEstimates ?? []);
  }

  async addCardEstimate(input: Omit<CardEstimate, "id" | "createdAt">): Promise<CardEstimate> {
    const estimate: CardEstimate = { id: uuid(), ...input, createdAt: new Date().toISOString() };
    this.store.cardEstimates = [...(this.store.cardEstimates ?? []), estimate];
    this.save();
    return copy(estimate);
  }

  async deleteCardEstimate(id: string): Promise<void> {
    this.store.cardEstimates = (this.store.cardEstimates ?? []).filter((e) => e.id !== id);
    this.save();
  }

  async listSnapshots(): Promise<NetWorthSnapshot[]> {
    return copy(this.store.snapshots);
  }

  async takeSnapshot(input: Omit<NetWorthSnapshot, "id">): Promise<void> {
    this.store.snapshots = this.store.snapshots.filter((s) => s.snapshotDate !== input.snapshotDate);
    this.store.snapshots.push({ id: uuid(), ...input });
    this.store.snapshots.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
    this.save();
  }

  async listPurchases(): Promise<Purchase[]> {
    return copy(this.store.purchases);
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
        legacy: spec.legacy,
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
    // a debt it repaid is unlinked, as Supabase's "on delete set null" does
    for (const l of this.store.loans) if (l.purchaseId === id) l.purchaseId = null;
    this.save();
  }

  async listLoans(): Promise<Loan[]> {
    return copy(this.store.loans.map(withDebtDefaults));
  }

  async createLoan(input: NewLoan): Promise<Loan> {
    const scheduleKind = input.scheduleKind ?? "annuity";
    const loan: Loan = withDebtDefaults({
      id: uuid(),
      name: input.name,
      kind: input.kind,
      currency: input.currency,
      principal: input.principal,
      monthlyRatePct: input.monthlyRatePct,
      termMonths: input.termMonths,
      startDate: input.startDate,
      installment: 0,
      scheduleKind,
      kkdfPct: input.kkdfPct ?? 0,
      bsmvPct: input.bsmvPct ?? 0,
      customInstalments: input.customInstalments ?? null,
      recurringTemplateId: null,
      direction: input.direction ?? "owe",
      counterparty: input.counterparty ?? null,
      depositAccountId: input.depositAccountId ?? null,
      payAccountId: input.accountId,
      payoffDate: input.payoffDate ?? null,
      purchaseId: input.purchaseId ?? null,
      createdAt: new Date().toISOString(),
    });
    const schedule = scheduleOf(loan);
    // "when I can" has no schedule yet; a recurring item brings its own
    if (schedule.rows.length === 0 && scheduleKind !== "lumpSum" && !input.templateId) throw new Error("loan schedule is empty");
    loan.installment = schedule.installment;
    const back = repaymentDirection(loan);
    const lent = loan.direction === "lent";

    const template = input.templateId ? this.store.templates.find((t) => t.id === input.templateId) : undefined;
    if (template) {
      // the recurring item already plans the repayments: it and its rows join the debt as they are
      template.loanId = loan.id;
      loan.recurringTemplateId = template.id;
      for (const t of this.store.transactions) if (t.recurringTemplateId === template.id) t.loanId = loan.id;
    } else if (scheduleKind !== "lumpSum" && schedule.level) {
      // level payments become one repeating template; varying ones become dated
      // rows, because no single template can say "a bit less every month"
      const created = await this.createTemplate({
        name: `${input.name} installment`,
        accountId: input.accountId,
        direction: back,
        categoryId: lent ? null : input.categoryId,
        amount: schedule.installment,
        frequency: "monthly",
        startDate: schedule.rows[0].date,
        endDate: schedule.rows[schedule.rows.length - 1].date,
        autoComplete: input.autoComplete,
        loanId: loan.id,
      });
      loan.recurringTemplateId = created.id;
    } else if (scheduleKind !== "lumpSum") {
      for (const row of schedule.rows) {
        await this.createTransaction({
          accountId: input.accountId,
          direction: back,
          categoryId: lent ? null : input.categoryId,
          amount: row.payment,
          status: "planned",
          dueDate: row.date,
          description: `${input.name} ${row.n}/${schedule.rows.length}`,
          loanId: loan.id,
          fxSnapshot: null,
          ...(lent ? { loanPrincipal: true } : {}),
        });
      }
    }

    // the money itself: a row already on the ledger, or a new one on the deposit account
    const received = input.receivedTxId ? this.store.transactions.find((t) => t.id === input.receivedTxId) : undefined;
    if (received) {
      received.loanId = loan.id;
      received.loanPrincipal = true;
    } else if (input.depositAccountId) {
      const happened = input.startDate <= todayISO();
      await this.createTransaction({
        accountId: input.depositAccountId,
        direction: lent ? "expense" : "income",
        categoryId: null,
        amount: input.principal,
        status: happened ? "completed" : "planned",
        dueDate: input.startDate,
        description: input.name,
        fxSnapshot: happened ? (input.fxSnapshot ?? null) : null,
        loanId: loan.id,
        loanPrincipal: true,
      });
    }

    this.store.loans.push(loan);
    this.save();
    // one payment on a date: planned like any re-plan
    if (scheduleKind === "lumpSum") await this.replanLoan(loan);
    return copy(loan);
  }

  async updateLoan(id: string, patch: LoanPatch): Promise<void> {
    const loan = this.store.loans.find((l) => l.id === id);
    if (!loan) return;
    const current = withDebtDefaults(loan);
    const next: Loan = { ...current };
    for (const key of Object.keys(patch) as (keyof LoanPatch)[]) {
      if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
    }
    const back = repaymentDirection(next);
    // the paying account carries what's still planned, the recurring item included
    if (next.payAccountId && next.payAccountId !== current.payAccountId) {
      for (const t of this.store.transactions) {
        if (t.loanId === id && t.status === "planned" && t.direction === back) t.accountId = next.payAccountId;
      }
      const template = this.store.templates.find((t) => t.id === next.recurringTemplateId);
      if (template) template.accountId = next.payAccountId;
    }
    // the money's own row follows its account
    if (next.depositAccountId && next.depositAccountId !== current.depositAccountId) {
      for (const t of this.store.transactions) if (t.loanId === id && t.direction !== back) t.accountId = next.depositAccountId;
    }
    Object.assign(loan, next);
    this.save();
    if ("payoffDate" in patch || "purchaseId" in patch) await this.replanLoan(next);
  }

  /** Applies replanRepayments: what's planned from here on, the recurring item's end with it. */
  private async replanLoan(loan: Loan): Promise<void> {
    const plan = replanRepayments(loan, this.store.transactions, todayISO());
    const template = this.store.templates.find((t) => t.id === loan.recurringTemplateId);
    const { repayments } = debtRows(loan, this.store.transactions);
    // a new row pays from where the debt is paid, filed where its repayments are
    const payFrom = loan.payAccountId ?? template?.accountId ?? repayments[0]?.accountId ?? null;
    const categoryId = repayments.find((t) => t.categoryId)?.categoryId ?? template?.categoryId ?? null;
    const remove = new Set(plan.remove);
    this.store.transactions = this.store.transactions.filter((t) => !remove.has(t.id));
    this.save();
    if (template && plan.templateEnd !== undefined && plan.templateEnd !== template.endDate) {
      await this.updateTemplate(template.id, { endDate: plan.templateEnd });
    }
    if (!payFrom) return;
    for (const row of plan.add) {
      await this.createTransaction({
        accountId: payFrom,
        direction: repaymentDirection(loan),
        categoryId: loan.direction === "lent" ? null : categoryId,
        amount: row.amount,
        status: "planned",
        dueDate: row.dueDate,
        description: row.description,
        loanId: loan.id,
        fxSnapshot: null,
        ...(loan.direction === "lent" ? { loanPrincipal: true } : {}),
      });
    }
  }

  async deleteLoan(id: string, keepRows = false): Promise<void> {
    const loan = this.store.loans.find((l) => l.id === id);
    this.store.loans = this.store.loans.filter((l) => l.id !== id);
    const template = this.store.templates.find((t) => t.id === loan?.recurringTemplateId);
    if (keepRows) {
      if (template) template.loanId = null;
    } else {
      if (template) await this.deleteTemplate(template.id, true);
      // unpaid rows only: a deleted loan must not rewrite what already left
      this.store.transactions = this.store.transactions.filter((tx) => !(tx.loanId === id && tx.status === "planned"));
    }
    // what stays loses the link, as Supabase's "on delete set null" does, and
    // with it the debt's say over whether it's income
    for (const t of this.store.transactions) {
      if (t.loanId !== id) continue;
      t.loanId = null;
      delete t.loanPrincipal;
    }
    this.save();
  }

  async listActivity(): Promise<ActivityEntry[]> {
    return copy([...(this.store.activity ?? [])].reverse());
  }

  async appendActivity(entries: Omit<ActivityEntry, "id">[]): Promise<void> {
    if (entries.length === 0) return;
    // a sandbox in localStorage: the latest thousand are plenty
    this.store.activity = [...(this.store.activity ?? []), ...entries.map((e) => ({ ...e, id: uuid() }))].slice(-1000);
    this.save();
  }

  async deleteAllData(): Promise<void> {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    this.store = load();
  }

  async exportAll(): Promise<BackupFile> {
    return {
      app: "renovator",
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: this.store.accounts,
      categories: this.store.categories,
      transactions: this.store.transactions,
      templates: this.store.templates,
      victvsSessions: this.store.victvsSessions,
      victvsPayouts: this.store.victvsPayouts,
      loans: this.store.loans,
      purchases: this.store.purchases,
      budgets: this.store.budgets,
      goals: this.store.goals,
      snapshots: this.store.snapshots,
      activity: this.store.activity ?? [],
      cardEstimates: this.store.cardEstimates ?? [],
    };
  }

  async importAll(backup: BackupFile): Promise<void> {
    this.store = {
      accounts: backup.accounts ?? [],
      categories: backup.categories ?? [],
      transactions: backup.transactions ?? [],
      templates: backup.templates ?? [],
      victvsSessions: backup.victvsSessions ?? [],
      victvsPayouts: backup.victvsPayouts ?? [],
      loans: backup.loans ?? [],
      purchases: backup.purchases ?? [],
      budgets: backup.budgets ?? [],
      goals: backup.goals ?? [],
      snapshots: backup.snapshots ?? [],
      settings: this.store.settings,
      // the backup lists it newest first, as listActivity does; kept oldest first here
      activity: [...(backup.activity ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
      cardEstimates: backup.cardEstimates ?? [],
    };
    this.save();
  }
}

/** Paid-total helper reused by UI (kept here to avoid a circular import). */
export function victvsUnpaidTotal(sessions: VictvsSession[]): number {
  return sumAmounts(
    "USD",
    sessions.filter((s) => s.status === "unpaid").map((s) => s.amount)
  );
}
