import type { SupabaseClient } from "@supabase/supabase-js";
import { FxSnapshot } from "@/lib/domain/fx";
import { buildSchedule } from "@/lib/domain/loanSchedule";
import {
  computeMissingOccurrences,
  findAutoCompletable,
  MATERIALIZE_MONTHS_AHEAD,
  planBackfill,
} from "@/lib/domain/materialize";
import {
  BackupFile,
  MarkPaidInput,
  NewAccount,
  NewLoan,
  NewPurchase,
  NewTemplate,
  NewTransaction,
  NewTransfer,
  NewVictvsSession,
  Repo,
  TemplateBackfill,
} from "./repo";
import {
  Account,
  Budget,
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
import { buildPurchaseTransactionSpecs } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { readHoldings } from "@/lib/domain/gold";
import { toDbError } from "./errors";
import { selectAll } from "./paginate";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const accountFromRow = (r: Row): Account => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  kind: r.kind,
  openingBalance: Number(r.opening_balance),
  archived: r.archived,
  paymentAccountId: r.payment_account_id ?? null,
  paymentDay: r.payment_day ?? null,
  creditLimit: r.credit_limit == null ? null : Number(r.credit_limit),
  holdings: readHoldings(r.holdings),
  createdAt: r.created_at,
});

const purchaseFromRow = (r: Row): Purchase => ({
  id: r.id,
  name: r.name,
  accountId: r.account_id,
  amount: Number(r.amount),
  purchaseDate: r.purchase_date,
  installmentCount: r.installment_count,
  firstDue: r.first_due,
  details: r.details,
  reflected: r.reflected,
  categoryId: r.category_id,
  createdAt: r.created_at,
});

const categoryFromRow = (r: Row): Category => ({
  id: r.id,
  name: r.name,
  direction: r.direction,
  color: r.color,
});

const txFromRow = (r: Row): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  direction: r.direction,
  categoryId: r.category_id,
  amount: Number(r.amount),
  status: r.status,
  dueDate: r.due_date,
  completedAt: r.completed_at,
  description: r.description,
  fxSnapshot: r.fx_snapshot,
  transferGroupId: r.transfer_group_id,
  transferMarketRate: r.transfer_market_rate == null ? null : Number(r.transfer_market_rate),
  recurringTemplateId: r.recurring_template_id,
  loanId: r.loan_id,
  victvsPayoutId: r.victvs_payout_id,
  purchaseId: r.purchase_id ?? null,
  legacy: r.legacy ?? false,
  createdAt: r.created_at,
});

const templateFromRow = (r: Row): RecurringTemplate => ({
  id: r.id,
  name: r.name,
  accountId: r.account_id,
  direction: r.direction,
  categoryId: r.category_id,
  amount: Number(r.amount),
  frequency: r.frequency,
  startDate: r.start_date,
  endDate: r.end_date,
  autoComplete: r.auto_complete,
  loanId: r.loan_id,
  createdAt: r.created_at,
});

const sessionFromRow = (r: Row): VictvsSession => ({
  id: r.id,
  date: r.date,
  sessionType: r.session_type,
  sessionNo: r.session_no ?? "",
  amount: Number(r.amount),
  status: r.status,
  payoutId: r.payout_id,
  notes: r.notes,
  source: r.source,
  createdAt: r.created_at,
});

const payoutFromRow = (r: Row): VictvsPayout => ({
  id: r.id,
  paymentDate: r.payment_date,
  accountId: r.account_id,
  total: Number(r.total),
  transactionId: r.transaction_id,
  sessionCount: r.session_count,
  createdAt: r.created_at,
});

const loanFromRow = (r: Row): Loan => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  currency: r.currency,
  principal: Number(r.principal),
  monthlyRatePct: Number(r.monthly_rate_pct),
  termMonths: r.term_months,
  startDate: r.start_date,
  installment: Number(r.installment),
  // rows written before schedules existed are untaxed annuities, which is
  // exactly what they were
  scheduleKind: (r.schedule_kind ?? "annuity") as Loan["scheduleKind"],
  kkdfPct: Number(r.kkdf_pct ?? 0),
  bsmvPct: Number(r.bsmv_pct ?? 0),
  customInstalments: Array.isArray(r.custom_instalments) ? (r.custom_instalments as number[]) : null,
  recurringTemplateId: r.recurring_template_id,
  createdAt: r.created_at,
});

const planFromRow = (r: Row): PlanRecord => ({
  id: r.id,
  name: r.name,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function throwIf(error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) throw toDbError(error);
}

/**
 * Postgres-backed repo. RLS scopes every query to the signed-in user;
 * user_id is set explicitly on inserts. Balances are never written — they
 * are derived server-side (account_balances view / computeBalances).
 */
export class SupabaseRepo implements Repo {
  readonly mode = "supabase" as const;

  constructor(
    private db: SupabaseClient,
    private userId: string
  ) {}

  /**
   * Every row of `table` the signed-in user can see, however many: `order`
   * sorts it, and id breaks ties so pages never overlap (see selectAll).
   */
  private all(table: string, order: (q: any) => any = (q) => q): Promise<Row[]> {
    return selectAll<Row & { id: string }>(table, (from, to, withCount) =>
      order(this.db.from(table).select("*", withCount ? { count: "exact" } : undefined))
        .order("id")
        .range(from, to)
    );
  }

  async listAccounts(): Promise<Account[]> {
    return (await this.all("accounts", (q) => q.order("created_at"))).map(accountFromRow);
  }

  async createAccount(input: NewAccount): Promise<Account> {
    const { data, error } = await this.db
      .from("accounts")
      .insert({
        user_id: this.userId,
        name: input.name,
        currency: input.currency,
        kind: input.kind,
        opening_balance: input.openingBalance,
        payment_account_id: input.paymentAccountId ?? null,
        payment_day: input.paymentDay ?? null,
        credit_limit: input.creditLimit ?? null,
        // only sent when there is something to hold, so a database without
        // migration 0015 can still create every other kind of account
        ...(input.holdings?.length ? { holdings: input.holdings } : {}),
      })
      .select()
      .single();
    throwIf(error);
    return accountFromRow(data!);
  }

  async updateAccount(id: string, patch: Partial<NewAccount> & { archived?: boolean }): Promise<void> {
    const row: Row = {};
    if (patch.name != null) row.name = patch.name;
    if (patch.currency != null) row.currency = patch.currency;
    if (patch.kind != null) row.kind = patch.kind;
    if (patch.openingBalance != null) row.opening_balance = patch.openingBalance;
    if (patch.archived != null) row.archived = patch.archived;
    if (patch.paymentAccountId !== undefined) row.payment_account_id = patch.paymentAccountId;
    if (patch.paymentDay !== undefined) row.payment_day = patch.paymentDay;
    if (patch.creditLimit !== undefined) row.credit_limit = patch.creditLimit;
    if (patch.holdings !== undefined) row.holdings = patch.holdings?.length ? patch.holdings : null;
    const { error } = await this.db.from("accounts").update(row).eq("id", id);
    throwIf(error);
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.db.from("accounts").delete().eq("id", id);
    throwIf(error);
  }

  async listCategories(): Promise<Category[]> {
    return (await this.all("categories", (q) => q.order("created_at"))).map(categoryFromRow);
  }

  async createCategory(input: { name: string; direction: TxDirection; color: string }): Promise<Category> {
    const { data, error } = await this.db
      .from("categories")
      .insert({ user_id: this.userId, ...input })
      .select()
      .single();
    throwIf(error);
    return categoryFromRow(data!);
  }

  async deleteCategory(id: string): Promise<void> {
    const { error } = await this.db.from("categories").delete().eq("id", id);
    throwIf(error);
  }

  async seedDefaultCategories(): Promise<void> {
    const { error } = await this.db.rpc("seed_default_categories");
    throwIf(error);
  }

  async listPlans(): Promise<PlanRecord[]> {
    return (await this.all("plans", (q) => q.order("updated_at", { ascending: false }))).map(planFromRow);
  }

  async createPlan(name: string, body: unknown): Promise<PlanRecord> {
    const { data, error } = await this.db
      .from("plans")
      .insert({ user_id: this.userId, name, body })
      .select()
      .single();
    throwIf(error);
    return planFromRow(data!);
  }

  async updatePlan(id: string, patch: { name?: string; body?: unknown }): Promise<void> {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.name != null) row.name = patch.name;
    if (patch.body !== undefined) row.body = patch.body;
    const { error } = await this.db.from("plans").update(row).eq("id", id);
    throwIf(error);
  }

  async deletePlan(id: string): Promise<void> {
    const { error } = await this.db.from("plans").delete().eq("id", id);
    throwIf(error);
  }

  async listSavingsPlans(): Promise<PlanRecord[]> {
    return (await this.all("savings_plans", (q) => q.order("updated_at", { ascending: false }))).map(planFromRow);
  }

  async createSavingsPlan(name: string, body: unknown): Promise<PlanRecord> {
    const { data, error } = await this.db
      .from("savings_plans")
      .insert({ user_id: this.userId, name, body })
      .select()
      .single();
    throwIf(error);
    return planFromRow(data!);
  }

  async updateSavingsPlan(id: string, patch: { name?: string; body?: unknown }): Promise<void> {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.name != null) row.name = patch.name;
    if (patch.body !== undefined) row.body = patch.body;
    const { error } = await this.db.from("savings_plans").update(row).eq("id", id);
    throwIf(error);
  }

  async deleteSavingsPlan(id: string): Promise<void> {
    const { error } = await this.db.from("savings_plans").delete().eq("id", id);
    throwIf(error);
  }

  async listTransactions(): Promise<Transaction[]> {
    return (await this.all("transactions", (q) => q.order("due_date", { ascending: false }))).map(txFromRow);
  }

  private txInsertRow(input: NewTransaction): Row {
    return {
      user_id: this.userId,
      account_id: input.accountId,
      direction: input.direction,
      category_id: input.categoryId,
      amount: input.amount,
      status: input.status,
      due_date: input.dueDate,
      completed_at: input.status === "completed" ? new Date().toISOString() : null,
      description: input.description,
      fx_snapshot: input.status === "completed" ? input.fxSnapshot : null,
      recurring_template_id: input.recurringTemplateId ?? null,
      loan_id: input.loanId ?? null,
      legacy: input.legacy ?? false,
    };
  }

  async createTransaction(input: NewTransaction): Promise<Transaction> {
    const { data, error } = await this.db
      .from("transactions")
      .insert(this.txInsertRow(input))
      .select()
      .single();
    throwIf(error);
    return txFromRow(data!);
  }

  async createTransactions(inputs: NewTransaction[]): Promise<number> {
    if (!inputs.length) return 0;
    const { error } = await this.db.from("transactions").insert(inputs.map((i) => this.txInsertRow(i)));
    throwIf(error);
    return inputs.length;
  }

  async updateTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>
  ): Promise<void> {
    const row: Row = {};
    if (patch.amount != null) row.amount = patch.amount;
    if (patch.dueDate != null) row.due_date = patch.dueDate;
    if (patch.description != null) row.description = patch.description;
    if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
    if (patch.accountId != null) row.account_id = patch.accountId;
    const { error } = await this.db.from("transactions").update(row).eq("id", id);
    throwIf(error);
  }

  /**
   * Updates a row, and the other leg of its transfer if it's one. Completing a
   * scheduled transfer from the ledger used to settle only the leg you tapped,
   * so the money left one account and never arrived in the other.
   */
  private async updateWithLegs(id: string, row: Row): Promise<void> {
    const { data, error: readError } = await this.db.from("transactions").select("transfer_group_id").eq("id", id).single();
    throwIf(readError);
    const update = this.db.from("transactions").update(row);
    const { error } = await (data?.transfer_group_id ? update.eq("transfer_group_id", data.transfer_group_id) : update.eq("id", id));
    throwIf(error);
  }

  async completeTransaction(id: string, fxSnapshot: FxSnapshot, amount?: number, legacy?: boolean): Promise<void> {
    const row: Row = {
      status: "completed",
      completed_at: new Date().toISOString(),
      fx_snapshot: fxSnapshot,
    };
    if (legacy != null) row.legacy = legacy;
    // a changed amount belongs to the leg it was changed on
    if (amount != null) {
      const { error } = await this.db.from("transactions").update({ amount }).eq("id", id);
      throwIf(error);
    }
    await this.updateWithLegs(id, row);
  }

  async reopenTransaction(id: string): Promise<void> {
    await this.updateWithLegs(id, { status: "planned", completed_at: null, fx_snapshot: null, legacy: false });
  }

  async setTransactionLegacy(id: string, legacy: boolean): Promise<void> {
    const { error } = await this.db.from("transactions").update({ legacy }).eq("id", id);
    throwIf(error);
  }

  async bulkCompleteAsLegacy(ids: string[], fxSnapshot: FxSnapshot): Promise<number> {
    if (!ids.length) return 0;
    const { error } = await this.db
      .from("transactions")
      .update({ status: "completed", completed_at: new Date().toISOString(), fx_snapshot: fxSnapshot, legacy: true })
      .in("id", ids)
      .eq("status", "planned");
    throwIf(error);
    return ids.length;
  }

  async deleteTransaction(id: string): Promise<void> {
    const { data, error } = await this.db
      .from("transactions")
      .select("transfer_group_id")
      .eq("id", id)
      .single();
    throwIf(error);
    if (data?.transfer_group_id) {
      const { error: e } = await this.db
        .from("transactions")
        .delete()
        .eq("transfer_group_id", data.transfer_group_id);
      throwIf(e);
    } else {
      const { error: e } = await this.db.from("transactions").delete().eq("id", id);
      throwIf(e);
    }
  }

  async createTransfer(input: NewTransfer): Promise<void> {
    const groupId = crypto.randomUUID();
    const now = new Date().toISOString();
    // a transfer you've scheduled hasn't left your account yet — it lands as
    // planned and moves the balances on the day you said it would
    const settled = input.date <= todayISO();
    const base = {
      user_id: this.userId,
      category_id: null,
      status: settled ? "completed" : "planned",
      due_date: input.date,
      completed_at: settled ? now : null,
      fx_snapshot: settled ? input.fxSnapshot : null,
      transfer_group_id: groupId,
      transfer_market_rate: input.marketRate,
    };
    const { error } = await this.db.from("transactions").insert([
      { ...base, account_id: input.fromAccountId, direction: "expense", amount: input.fromAmount, description: input.description },
      { ...base, account_id: input.toAccountId, direction: "income", amount: input.toAmount, description: input.description },
    ]);
    throwIf(error);
  }

  async listTemplates(): Promise<RecurringTemplate[]> {
    return (await this.all("recurring_templates", (q) => q.order("created_at"))).map(templateFromRow);
  }

  private templateInsertRow(input: NewTemplate): Row {
    return {
      user_id: this.userId,
      name: input.name,
      account_id: input.accountId,
      direction: input.direction,
      category_id: input.categoryId,
      amount: input.amount,
      frequency: input.frequency,
      start_date: input.startDate,
      end_date: input.endDate,
      auto_complete: input.autoComplete,
      loan_id: input.loanId ?? null,
    };
  }

  async createTemplate(input: NewTemplate, backfill?: TemplateBackfill): Promise<RecurringTemplate> {
    const plan = backfill ? planBackfill(input, backfill.mode, todayISO()) : null;
    const { data, error } = await this.db
      .from("recurring_templates")
      .insert(this.templateInsertRow({ ...input, startDate: plan?.startDate ?? input.startDate }))
      .select()
      .single();
    throwIf(error);
    const template = templateFromRow(data!);
    if (plan?.rows.length) {
      const now = new Date().toISOString();
      const rows = plan.rows.map((row) => {
        const completed = row.status === "completed";
        return {
          ...this.occurrenceInsertRow(template, row.dueDate),
          status: row.status,
          completed_at: completed ? now : null,
          fx_snapshot: completed ? backfill!.fxSnapshot : null,
          legacy: row.legacy,
        };
      });
      // an upsert, not an insert: another tab opening the app in between may
      // already have materialized some of these dates as planned rows, and
      // the choice made here should win over them
      const { error: rowsError } = await this.db
        .from("transactions")
        .upsert(rows, { onConflict: "user_id,recurring_template_id,due_date" });
      throwIf(rowsError);
    }
    return template;
  }

  /** A template's planned row for one date, as materialization creates it. */
  private occurrenceInsertRow(template: RecurringTemplate, dueDate: string): Row {
    return {
      user_id: this.userId,
      account_id: template.accountId,
      direction: template.direction,
      category_id: template.categoryId,
      amount: template.amount,
      status: "planned",
      due_date: dueDate,
      description: template.name,
      recurring_template_id: template.id,
      loan_id: template.loanId,
    };
  }

  async updateTemplate(id: string, patch: Partial<NewTemplate>): Promise<void> {
    const row: Row = {};
    if (patch.name != null) row.name = patch.name;
    if (patch.accountId != null) row.account_id = patch.accountId;
    if (patch.direction != null) row.direction = patch.direction;
    if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
    if (patch.amount != null) row.amount = patch.amount;
    if (patch.frequency != null) row.frequency = patch.frequency;
    if (patch.startDate != null) row.start_date = patch.startDate;
    if (patch.endDate !== undefined) row.end_date = patch.endDate;
    if (patch.autoComplete != null) row.auto_complete = patch.autoComplete;
    const { data, error } = await this.db.from("recurring_templates").update(row).eq("id", id).select().single();
    throwIf(error);
    const endDate = templateFromRow(data!).endDate;

    // rowsReplacedByEdit as a query: planned rows from today on, and any
    // after the end date
    const today = todayISO();
    const planned = this.db.from("transactions").delete().eq("recurring_template_id", id).eq("status", "planned");
    const { error: deleteError } = await (endDate
      ? planned.or(`due_date.gte.${today},due_date.gt.${endDate}`)
      : planned.gte("due_date", today));
    throwIf(deleteError);
    await this.materializeTemplates(MATERIALIZE_MONTHS_AHEAD);
  }

  async deleteTemplate(id: string, deletePlanned: boolean): Promise<void> {
    if (deletePlanned) {
      const { error } = await this.db
        .from("transactions")
        .delete()
        .eq("recurring_template_id", id)
        .eq("status", "planned");
      throwIf(error);
    }
    const { error } = await this.db.from("recurring_templates").delete().eq("id", id);
    throwIf(error);
  }

  async materializeTemplates(monthsAhead: number): Promise<number> {
    const [templates, transactions] = await Promise.all([this.listTemplates(), this.listTransactions()]);
    const missing = computeMissingOccurrences(templates, transactions, monthsAhead);
    if (!missing.length) return 0;
    const rows = missing.map(({ template, dueDate }) => this.occurrenceInsertRow(template, dueDate));
    // ignoreDuplicates + the template_due unique index make concurrent runs
    // (second tab, double bootstrap) race-safe: the loser inserts nothing
    const { error } = await this.db
      .from("transactions")
      .upsert(rows, { onConflict: "user_id,recurring_template_id,due_date", ignoreDuplicates: true });
    throwIf(error);
    return missing.length;
  }

  async autoCompleteDue(fxSnapshot: FxSnapshot): Promise<number> {
    const [templates, transactions] = await Promise.all([this.listTemplates(), this.listTransactions()]);
    const due = findAutoCompletable(templates, transactions);
    if (!due.length) return 0;
    // only rows still planned: between reading the ledger and this update,
    // another device may have completed one, and its completed_at and rates
    // should stand rather than be overwritten with ours
    const { data, error } = await this.db
      .from("transactions")
      .update({ status: "completed", completed_at: new Date().toISOString(), fx_snapshot: fxSnapshot })
      .in(
        "id",
        due.map((t) => t.id)
      )
      .eq("status", "planned")
      .select("id");
    throwIf(error);
    return data?.length ?? 0;
  }

  async listVictvsSessions(): Promise<VictvsSession[]> {
    return (await this.all("victvs_sessions", (q) => q.order("date", { ascending: false }))).map(sessionFromRow);
  }

  async listVictvsPayouts(): Promise<VictvsPayout[]> {
    return (await this.all("victvs_payouts", (q) => q.order("payment_date", { ascending: false }))).map(payoutFromRow);
  }

  async createVictvsSessions(inputs: NewVictvsSession[]): Promise<number> {
    if (!inputs.length) return 0;
    const rows = inputs.map((s) => ({
      user_id: this.userId,
      date: s.date,
      session_type: s.sessionType,
      session_no: s.sessionNo ?? "",
      amount: s.amount,
      status: s.status ?? "unpaid",
      notes: s.notes ?? "",
      source: s.source,
    }));
    const { error } = await this.db.from("victvs_sessions").insert(rows);
    throwIf(error);
    return inputs.length;
  }

  async updateVictvsSession(
    id: string,
    patch: Partial<Pick<VictvsSession, "date" | "sessionType" | "amount" | "notes">>
  ): Promise<void> {
    const row: Row = {};
    if (patch.date != null) row.date = patch.date;
    if (patch.sessionType != null) row.session_type = patch.sessionType;
    if (patch.amount != null) row.amount = patch.amount;
    if (patch.notes != null) row.notes = patch.notes;
    const { error } = await this.db.from("victvs_sessions").update(row).eq("id", id);
    throwIf(error);
  }

  async deleteVictvsSession(id: string): Promise<void> {
    const { error } = await this.db.from("victvs_sessions").delete().eq("id", id);
    throwIf(error);
  }

  async markVictvsPaid(input: MarkPaidInput): Promise<void> {
    const { data: payout, error: payoutError } = await this.db
      .from("victvs_payouts")
      .insert({
        user_id: this.userId,
        payment_date: input.paymentDate,
        account_id: input.accountId,
        total: input.totalUsd,
        session_count: input.sessionIds.length,
      })
      .select()
      .single();
    throwIf(payoutError);
    const { data: tx, error: txError } = await this.db
      .from("transactions")
      .insert({
        user_id: this.userId,
        account_id: input.accountId,
        direction: "income",
        category_id: input.categoryId,
        amount: input.receivedAmount,
        status: "completed",
        due_date: input.paymentDate,
        completed_at: new Date().toISOString(),
        description: `VICTVS payout (${input.sessionIds.length} sessions)`,
        fx_snapshot: input.fxSnapshot,
        victvs_payout_id: payout!.id,
        legacy: input.legacy ?? false,
      })
      .select()
      .single();
    throwIf(txError);
    const { error: linkError } = await this.db
      .from("victvs_payouts")
      .update({ transaction_id: tx!.id })
      .eq("id", payout!.id);
    throwIf(linkError);
    const { error: sessionsError } = await this.db
      .from("victvs_sessions")
      .update({ status: "paid", payout_id: payout!.id })
      .in("id", input.sessionIds);
    throwIf(sessionsError);
  }

  async markVictvsUnpaid(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const { error } = await this.db
      .from("victvs_sessions")
      .update({ status: "unpaid", payout_id: null })
      .in("id", sessionIds);
    throwIf(error);
  }

  async unmarkVictvsPayout(payoutId: string): Promise<void> {
    const { data: payout, error } = await this.db
      .from("victvs_payouts")
      .select("*")
      .eq("id", payoutId)
      .single();
    throwIf(error);
    const { error: sessionsError } = await this.db
      .from("victvs_sessions")
      .update({ status: "unpaid", payout_id: null })
      .eq("payout_id", payoutId);
    throwIf(sessionsError);
    if (payout?.transaction_id) {
      const { error: txError } = await this.db.from("transactions").delete().eq("id", payout.transaction_id);
      throwIf(txError);
    }
    const { error: deleteError } = await this.db.from("victvs_payouts").delete().eq("id", payoutId);
    throwIf(deleteError);
  }

  async listBudgets(): Promise<Budget[]> {
    return (await this.all("budgets")).map((r: Row) => ({
      id: r.id,
      categoryId: r.category_id,
      monthlyLimit: Number(r.monthly_limit),
      currency: r.currency,
    }));
  }

  async setBudget(categoryId: string, monthlyLimit: number | null, currency: Currency): Promise<void> {
    if (monthlyLimit == null || monthlyLimit <= 0) {
      const { error } = await this.db.from("budgets").delete().eq("category_id", categoryId);
      throwIf(error);
      return;
    }
    const { error } = await this.db
      .from("budgets")
      .upsert(
        { user_id: this.userId, category_id: categoryId, monthly_limit: monthlyLimit, currency },
        { onConflict: "user_id,category_id" }
      );
    throwIf(error);
  }

  async listGoals(): Promise<Goal[]> {
    return (await this.all("goals", (q) => q.order("created_at"))).map((r: Row) => ({
      id: r.id,
      name: r.name,
      accountId: r.account_id,
      targetAmount: Number(r.target_amount),
      targetDate: r.target_date,
      createdAt: r.created_at,
    }));
  }

  async createGoal(input: { name: string; accountId: string; targetAmount: number; targetDate: string | null }): Promise<Goal> {
    const { data, error } = await this.db
      .from("goals")
      .insert({
        user_id: this.userId,
        name: input.name,
        account_id: input.accountId,
        target_amount: input.targetAmount,
        target_date: input.targetDate,
      })
      .select()
      .single();
    throwIf(error);
    return {
      id: data!.id,
      name: data!.name,
      accountId: data!.account_id,
      targetAmount: Number(data!.target_amount),
      targetDate: data!.target_date,
      createdAt: data!.created_at,
    };
  }

  async updateGoal(id: string, patch: Partial<{ name: string; targetAmount: number; targetDate: string | null }>): Promise<void> {
    const row: Row = {};
    if (patch.name != null) row.name = patch.name;
    if (patch.targetAmount != null) row.target_amount = patch.targetAmount;
    if (patch.targetDate !== undefined) row.target_date = patch.targetDate;
    const { error } = await this.db.from("goals").update(row).eq("id", id);
    throwIf(error);
  }

  async deleteGoal(id: string): Promise<void> {
    const { error } = await this.db.from("goals").delete().eq("id", id);
    throwIf(error);
  }

  async getUserSettings(): Promise<UserSettings> {
    const { data, error } = await this.db.from("user_settings").select("*").maybeSingle();
    throwIf(error);
    if (!data) {
      return { dashboardLayout: null, theme: "system", compact: false, victvsAccountId: null, victvsDefaults: null, navOrder: null, dateFormat: null, showQuickAdd: null, showRateTicker: null };
    }
    return {
      dashboardLayout: data.dashboard_layout,
      theme: data.theme,
      compact: data.compact,
      victvsAccountId: data.victvs_account_id ?? null,
      victvsDefaults: data.victvs_defaults ?? null,
      navOrder: data.nav_order ?? null,
      dateFormat: data.date_format ?? null,
      showQuickAdd: data.show_quick_add ?? null,
      showRateTicker: data.show_rate_ticker ?? null,
    };
  }

  async saveUserSettings(patch: Partial<UserSettings>): Promise<void> {
    const row: Row = { user_id: this.userId, updated_at: new Date().toISOString() };
    if (patch.dashboardLayout !== undefined) row.dashboard_layout = patch.dashboardLayout;
    if (patch.theme != null) row.theme = patch.theme;
    if (patch.compact != null) row.compact = patch.compact;
    if (patch.victvsAccountId !== undefined) row.victvs_account_id = patch.victvsAccountId;
    if (patch.victvsDefaults !== undefined) row.victvs_defaults = patch.victvsDefaults;
    if (patch.navOrder !== undefined) row.nav_order = patch.navOrder;
    if (patch.dateFormat !== undefined) row.date_format = patch.dateFormat;
    if (patch.showQuickAdd !== undefined) row.show_quick_add = patch.showQuickAdd;
    if (patch.showRateTicker !== undefined) row.show_rate_ticker = patch.showRateTicker;
    const { error } = await this.db.from("user_settings").upsert(row, { onConflict: "user_id" });
    throwIf(error);
  }

  async listSnapshots(): Promise<NetWorthSnapshot[]> {
    return (await this.all("net_worth_snapshots", (q) => q.order("snapshot_date"))).map((r: Row) => ({
      id: r.id,
      snapshotDate: r.snapshot_date,
      balances: r.balances,
      usdPer: r.usd_per,
      totalUsd: Number(r.total_usd),
    }));
  }

  async takeSnapshot(input: Omit<NetWorthSnapshot, "id">): Promise<void> {
    const { error } = await this.db.from("net_worth_snapshots").upsert(
      {
        user_id: this.userId,
        snapshot_date: input.snapshotDate,
        balances: input.balances,
        usd_per: input.usdPer,
        total_usd: input.totalUsd,
      },
      { onConflict: "user_id,snapshot_date" }
    );
    throwIf(error);
  }

  async listPurchases(): Promise<Purchase[]> {
    return (await this.all("purchases", (q) => q.order("purchase_date", { ascending: false }))).map(purchaseFromRow);
  }

  private async insertPurchaseTransactions(purchase: Purchase, fxSnapshot: FxSnapshot | null): Promise<void> {
    if (!purchase.accountId) return;
    const { data: accountRow, error } = await this.db
      .from("accounts")
      .select("currency")
      .eq("id", purchase.accountId)
      .single();
    throwIf(error);
    const now = new Date().toISOString();
    const rows = buildPurchaseTransactionSpecs(purchase, accountRow!.currency, todayISO()).map((spec) => ({
      user_id: this.userId,
      account_id: purchase.accountId,
      direction: "expense",
      category_id: purchase.categoryId,
      amount: spec.amount,
      status: spec.status,
      due_date: spec.dueDate,
      completed_at: spec.status === "completed" ? now : null,
      description: spec.description,
      fx_snapshot: spec.status === "completed" ? fxSnapshot : null,
      purchase_id: purchase.id,
      legacy: spec.legacy,
    }));
    const { error: insertError } = await this.db.from("transactions").insert(rows);
    throwIf(insertError);
  }

  async createPurchase(input: NewPurchase, fxSnapshot: FxSnapshot | null): Promise<Purchase> {
    const { data, error } = await this.db
      .from("purchases")
      .insert({
        user_id: this.userId,
        name: input.name,
        account_id: input.accountId,
        amount: input.amount,
        purchase_date: input.purchaseDate,
        installment_count: input.installmentCount,
        first_due: input.firstDue,
        details: input.details,
        reflected: input.reflected,
        category_id: input.categoryId,
      })
      .select()
      .single();
    throwIf(error);
    const purchase = purchaseFromRow(data!);
    if (purchase.reflected) await this.insertPurchaseTransactions(purchase, fxSnapshot);
    return purchase;
  }

  async updatePurchase(id: string, patch: Partial<Pick<Purchase, "name" | "details" | "categoryId">>): Promise<void> {
    const row: Row = {};
    if (patch.name != null) row.name = patch.name;
    if (patch.details != null) row.details = patch.details;
    if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
    const { error } = await this.db.from("purchases").update(row).eq("id", id);
    throwIf(error);
  }

  async setPurchaseReflected(id: string, reflected: boolean, fxSnapshot: FxSnapshot | null): Promise<void> {
    const { data, error } = await this.db.from("purchases").select("*").eq("id", id).single();
    throwIf(error);
    const purchase = purchaseFromRow(data!);
    if (purchase.reflected === reflected) return;
    const { error: deleteError } = await this.db.from("transactions").delete().eq("purchase_id", id);
    throwIf(deleteError);
    const { error: updateError } = await this.db.from("purchases").update({ reflected }).eq("id", id);
    throwIf(updateError);
    if (reflected) await this.insertPurchaseTransactions({ ...purchase, reflected }, fxSnapshot);
  }

  async deletePurchase(id: string, deleteTransactions: boolean): Promise<void> {
    if (!deleteTransactions) {
      const { error } = await this.db.from("transactions").update({ purchase_id: null }).eq("purchase_id", id);
      throwIf(error);
    }
    // FK is on delete cascade — remaining linked transactions go with the purchase
    const { error } = await this.db.from("purchases").delete().eq("id", id);
    throwIf(error);
  }

  async listLoans(): Promise<Loan[]> {
    return (await this.all("loans", (q) => q.order("created_at"))).map(loanFromRow);
  }

  async createLoan(input: NewLoan): Promise<Loan> {
    const schedule = buildSchedule({
      kind: input.scheduleKind ?? "annuity",
      principal: input.principal,
      monthlyRatePct: input.monthlyRatePct,
      termMonths: input.termMonths,
      startDate: input.startDate,
      currency: input.currency,
      kkdfPct: input.kkdfPct ?? 0,
      bsmvPct: input.bsmvPct ?? 0,
      customInstalments: input.customInstalments ?? undefined,
    });
    if (schedule.rows.length === 0) throw new Error("loan schedule is empty");

    const { data: loanRow, error: loanError } = await this.db
      .from("loans")
      .insert({
        user_id: this.userId,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        principal: input.principal,
        monthly_rate_pct: input.monthlyRatePct,
        term_months: input.termMonths,
        start_date: input.startDate,
        installment: schedule.installment,
        schedule_kind: input.scheduleKind ?? "annuity",
        kkdf_pct: input.kkdfPct ?? 0,
        bsmv_pct: input.bsmvPct ?? 0,
        custom_instalments: input.customInstalments ?? null,
      })
      .select()
      .single();
    throwIf(loanError);
    const loanId = loanRow!.id as string;

    /*
     * A level schedule is one repeating payment, so a recurring template says
     * it in a single row and keeps saying it past any materialization window.
     *
     * A schedule whose payments differ cannot be said that way at all — an
     * equal-principal loan falls by a little every month — so those are posted
     * as dated rows, one per installment. Both end up as ordinary planned
     * transactions, which is what makes a loan show up in next April whichever
     * shape it has.
     */
    if (schedule.level) {
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
      const { error: linkError } = await this.db
        .from("loans")
        .update({ recurring_template_id: template.id })
        .eq("id", loanId);
      throwIf(linkError);
      return { ...loanFromRow(loanRow!), recurringTemplateId: template.id };
    }

    const { error: rowsError } = await this.db.from("transactions").insert(
      schedule.rows.map((row) => ({
        user_id: this.userId,
        account_id: input.accountId,
        direction: "expense",
        category_id: input.categoryId,
        amount: row.payment,
        status: "planned",
        due_date: row.date,
        description: `${input.name} ${row.n}/${schedule.rows.length}`,
        loan_id: loanId,
      }))
    );
    throwIf(rowsError);
    return loanFromRow(loanRow!);
  }

  async deleteLoan(id: string): Promise<void> {
    const { data: loan } = await this.db.from("loans").select("recurring_template_id").eq("id", id).single();
    if (loan?.recurring_template_id) await this.deleteTemplate(loan.recurring_template_id, true);
    // dated rows for a varying schedule: only the unpaid ones go, so a
    // deleted loan does not rewrite what already left the account
    const { error: txError } = await this.db
      .from("transactions")
      .delete()
      .eq("loan_id", id)
      .eq("status", "planned");
    throwIf(txError);
    const { error } = await this.db.from("loans").delete().eq("id", id);
    throwIf(error);
  }

  async deleteAllData(): Promise<void> {
    // FK cascades wipe dependents when accounts go; clear the rest explicitly.
    for (const table of ["transactions", "purchases", "budgets", "goals", "net_worth_snapshots", "victvs_sessions", "victvs_payouts", "loans", "recurring_templates", "accounts", "categories", "user_settings"]) {
      const { error } = await this.db.from(table).delete().eq("user_id", this.userId);
      throwIf(error);
    }
  }

  async exportAll(): Promise<BackupFile> {
    const [accounts, categories, transactions, templates, victvsSessions, victvsPayouts, loans, purchases, budgets, goals, snapshots] =
      await Promise.all([
        this.listAccounts(),
        this.listCategories(),
        this.listTransactions(),
        this.listTemplates(),
        this.listVictvsSessions(),
        this.listVictvsPayouts(),
        this.listLoans(),
        this.listPurchases(),
        this.listBudgets(),
        this.listGoals(),
        this.listSnapshots(),
      ]);
    return {
      app: "renovator",
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts,
      categories,
      transactions,
      templates,
      victvsSessions,
      victvsPayouts,
      loans,
      purchases,
      budgets,
      goals,
      snapshots,
    };
  }

  /** replaces all data; inserts follow FK dependency order with two-pass patches for circular refs */
  async importAll(backup: BackupFile): Promise<void> {
    await this.deleteAllData();
    const u = this.userId;
    const insert = async (table: string, rows: Row[]) => {
      if (!rows.length) return;
      const { error } = await this.db.from(table).insert(rows);
      throwIf(error);
    };

    // accounts first without self-referencing payment_account_id, patched after
    await insert(
      "accounts",
      backup.accounts.map((a) => ({
        id: a.id, user_id: u, name: a.name, currency: a.currency, kind: a.kind,
        opening_balance: a.openingBalance, archived: a.archived, created_at: a.createdAt,
        ...(a.holdings?.length ? { holdings: a.holdings } : {}),
      }))
    );
    for (const a of backup.accounts) {
      if (a.paymentAccountId || a.paymentDay != null) {
        const { error } = await this.db
          .from("accounts")
          .update({ payment_account_id: a.paymentAccountId, payment_day: a.paymentDay ?? null })
          .eq("id", a.id);
        throwIf(error);
      }
    }
    await insert("categories", backup.categories.map((c) => ({ id: c.id, user_id: u, name: c.name, direction: c.direction, color: c.color })));
    await insert("purchases", backup.purchases.map((p) => ({
      id: p.id, user_id: u, name: p.name, account_id: p.accountId, amount: p.amount,
      purchase_date: p.purchaseDate, installment_count: p.installmentCount, first_due: p.firstDue,
      details: p.details, reflected: p.reflected, category_id: p.categoryId, created_at: p.createdAt,
    })));
    // loans ↔ templates are circular: loans go in without the template link, patched after
    await insert("loans", backup.loans.map((l) => ({
      id: l.id, user_id: u, name: l.name, kind: l.kind, currency: l.currency, principal: l.principal,
      monthly_rate_pct: l.monthlyRatePct, term_months: l.termMonths, start_date: l.startDate,
      installment: l.installment, created_at: l.createdAt,
    })));
    await insert("recurring_templates", backup.templates.map((tpl) => ({
      id: tpl.id, user_id: u, name: tpl.name, account_id: tpl.accountId, direction: tpl.direction,
      category_id: tpl.categoryId, amount: tpl.amount, frequency: tpl.frequency, start_date: tpl.startDate,
      end_date: tpl.endDate, auto_complete: tpl.autoComplete, loan_id: tpl.loanId, created_at: tpl.createdAt,
    })));
    for (const l of backup.loans) {
      if (l.recurringTemplateId) {
        const { error } = await this.db.from("loans").update({ recurring_template_id: l.recurringTemplateId }).eq("id", l.id);
        throwIf(error);
      }
    }
    // payouts ↔ transactions are circular: payouts go in without the tx link, patched after
    await insert("victvs_payouts", backup.victvsPayouts.map((p) => ({
      id: p.id, user_id: u, payment_date: p.paymentDate, account_id: p.accountId, total: p.total,
      session_count: p.sessionCount, created_at: p.createdAt,
    })));
    await insert("transactions", backup.transactions.map((t) => ({
      id: t.id, user_id: u, account_id: t.accountId, direction: t.direction, category_id: t.categoryId,
      amount: t.amount, status: t.status, due_date: t.dueDate, completed_at: t.completedAt,
      description: t.description, fx_snapshot: t.fxSnapshot, transfer_group_id: t.transferGroupId,
      transfer_market_rate: t.transferMarketRate, recurring_template_id: t.recurringTemplateId,
      loan_id: t.loanId, victvs_payout_id: t.victvsPayoutId, purchase_id: t.purchaseId, legacy: t.legacy ?? false, created_at: t.createdAt,
    })));
    for (const p of backup.victvsPayouts) {
      if (p.transactionId) {
        const { error } = await this.db.from("victvs_payouts").update({ transaction_id: p.transactionId }).eq("id", p.id);
        throwIf(error);
      }
    }
    await insert("victvs_sessions", backup.victvsSessions.map((s) => ({
      id: s.id, user_id: u, date: s.date, session_type: s.sessionType, amount: s.amount, status: s.status,
      payout_id: s.payoutId, notes: s.notes, source: s.source, created_at: s.createdAt,
    })));
    await insert("budgets", backup.budgets.map((b) => ({ id: b.id, user_id: u, category_id: b.categoryId, monthly_limit: b.monthlyLimit, currency: b.currency })));
    await insert("goals", backup.goals.map((g) => ({ id: g.id, user_id: u, name: g.name, account_id: g.accountId, target_amount: g.targetAmount, target_date: g.targetDate, created_at: g.createdAt })));
    await insert("net_worth_snapshots", backup.snapshots.map((s) => ({ id: s.id, user_id: u, snapshot_date: s.snapshotDate, balances: s.balances, usd_per: s.usdPer, total_usd: s.totalUsd })));
  }
}
