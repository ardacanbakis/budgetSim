import type { SupabaseClient } from "@supabase/supabase-js";
import { FxSnapshot } from "@/lib/domain/fx";
import { debtRows, repaymentDirection, replanRepayments, scheduleOf, withDebtDefaults } from "@/lib/domain/debt";
import {
  computeMissingOccurrences,
  findAutoCompletable,
  MATERIALIZE_MONTHS_AHEAD,
  planBackfill,
} from "@/lib/domain/materialize";
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
import { buildPurchaseTransactionSpecs } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { readHoldings } from "@/lib/domain/gold";
import { DbError, describeError, toDbError } from "./errors";
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
  // absent before migration 0016
  adjustment: r.adjustment === true,
  // absent before migration 0019
  ...(r.loan_principal === true ? { loanPrincipal: true } : {}),
  // absent before migration 0021
  ...(r.converts_id ? { convertsId: r.converts_id } : {}),
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
  // absent before migration 0020
  series: r.series ?? null,
  // absent before migration 0021
  convertToAccountId: r.convert_to_account_id ?? null,
  convertFrom: r.convert_from ?? null,
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

const loanFromRow = (r: Row): Loan => withDebtDefaults({
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
  // absent before migration 0019: a debt you owe, nothing else known
  direction: r.direction,
  counterparty: r.counterparty,
  depositAccountId: r.deposit_account_id,
  payAccountId: r.pay_account_id,
  payoffDate: r.payoff_date,
  // absent before migration 0023
  purchaseId: r.purchase_id ?? null,
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
      // sent only when set, so a database without 0016 still saves every
      // other entry; only recording an adjustment needs the migration
      ...(input.adjustment ? { adjustment: true } : {}),
      // likewise 0019, for the money of a debt
      ...(input.loanPrincipal ? { loan_principal: true } : {}),
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
    const { data, error: readError } = await this.db.from("transactions").select("transfer_group_id").eq("id", id).single();
    throwIf(readError);
    const { error } = await this.db.from("transactions").update(row).eq("id", id);
    throwIf(error);
    // the other leg only while it's still planned: one already done keeps
    // when it was done and at what rates
    if (data?.transfer_group_id) {
      const { error: legError } = await this.db
        .from("transactions")
        .update(row)
        .eq("transfer_group_id", data.transfer_group_id)
        .neq("id", id)
        .eq("status", "planned");
      throwIf(legError);
    }
  }

  async reopenTransaction(id: string): Promise<void> {
    await this.updateWithLegs(id, { status: "planned", completed_at: null, fx_snapshot: null, legacy: false });
  }

  async setTransactionLegacy(id: string, legacy: boolean): Promise<void> {
    // both legs of a transfer, or a card payment's card side is left behind
    await this.updateWithLegs(id, { legacy });
  }

  async bulkCompleteAsLegacy(ids: string[], fxSnapshot: FxSnapshot): Promise<number> {
    if (!ids.length) return 0;
    const row = { status: "completed", completed_at: new Date().toISOString(), fx_snapshot: fxSnapshot, legacy: true };
    const { error } = await this.db.from("transactions").update(row).in("id", ids).eq("status", "planned");
    throwIf(error);
    // the other leg of any transfer among them: lists show one leg only (a card
    // payment's card side is hidden), and completing just that one left the
    // other planned forever
    const { data, error: legsError } = await this.db.from("transactions").select("transfer_group_id").in("id", ids);
    throwIf(legsError);
    const groups = [...new Set((data ?? []).map((r) => r.transfer_group_id as string | null).filter((g): g is string => g != null))];
    if (groups.length) {
      const { error: e } = await this.db.from("transactions").update(row).in("transfer_group_id", groups).eq("status", "planned");
      throwIf(e);
    }
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
      // sent only when set: only a converted payday needs migration 0021
      ...(input.convertsId ? { converts_id: input.convertsId } : {}),
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
      // sent only when set: only a raise or Combine needs migration 0020
      ...(input.series ? { series: input.series } : {}),
      // likewise 0021, for an income converted into another account
      ...(input.convertToAccountId ? { convert_to_account_id: input.convertToAccountId, convert_from: input.convertFrom ?? null } : {}),
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
    if (patch.series !== undefined) row.series = patch.series;
    if (patch.convertToAccountId !== undefined) row.convert_to_account_id = patch.convertToAccountId;
    if (patch.convertFrom !== undefined) row.convert_from = patch.convertFrom;
    const { data, error } = await this.db.from("recurring_templates").update(row).eq("id", id).select().single();
    throwIf(error);
    // joining a series changes nothing it plans
    if (Object.keys(patch).every((k) => k === "series")) return;
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
    patch: VictvsSessionPatch
  ): Promise<void> {
    const row: Row = {};
    if (patch.date != null) row.date = patch.date;
    if (patch.sessionType != null) row.session_type = patch.sessionType;
    if (patch.sessionNo != null) row.session_no = patch.sessionNo;
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
      return { dashboardLayout: null, theme: "system", compact: false, victvsAccountId: null, victvsDefaults: null, navOrder: null, dateFormat: null, showQuickAdd: null, showRateTicker: null, victvsForecast: null };
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
      // absent before migration 0017: no figures of your own
      victvsForecast: data.victvs_forecast ?? null,
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
    // sent only when it changes, so every other setting keeps saving on a
    // database without 0017; a forecast edit there says which file to run
    if (patch.victvsForecast !== undefined) row.victvs_forecast = patch.victvsForecast;
    const { error } = await this.db.from("user_settings").upsert(row, { onConflict: "user_id" });
    if (error && patch.victvsForecast !== undefined && describeError(toDbError(error)).kind === "needsMigration") {
      throw new DbError(error.message, error.code || null, error.details || null, error.hint || null, "0017_victvs_forecast.sql");
    }
    throwIf(error);
  }

  async listCardEstimates(): Promise<CardEstimate[]> {
    const { data, error } = await this.db.from("card_estimates").select("*").order("created_at");
    // migration 0022 not run yet: no expectations, and nothing else depends on them
    if (error) return [];
    return (data ?? []).map((r: Row) => ({
      id: r.id,
      accountId: r.account_id,
      month: r.month,
      amount: Number(r.amount),
      notedOn: r.noted_on,
      createdAt: r.created_at,
    }));
  }

  async addCardEstimate(input: Omit<CardEstimate, "id" | "createdAt">): Promise<CardEstimate> {
    const { data, error } = await this.db
      .from("card_estimates")
      .insert({ user_id: this.userId, account_id: input.accountId, month: input.month, amount: input.amount, noted_on: input.notedOn })
      .select()
      .single();
    throwIf(error);
    return { id: data!.id, accountId: data!.account_id, month: data!.month, amount: Number(data!.amount), notedOn: data!.noted_on, createdAt: data!.created_at };
  }

  async deleteCardEstimate(id: string): Promise<void> {
    const { error } = await this.db.from("card_estimates").delete().eq("id", id);
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
    const scheduleKind = input.scheduleKind ?? "annuity";
    const direction = input.direction ?? "owe";
    const lent = direction === "lent";
    const draft = withDebtDefaults({
      id: "",
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
      direction,
      payoffDate: input.payoffDate ?? null,
      createdAt: "",
    });
    const schedule = scheduleOf(draft);
    // "when I can" has no schedule yet; a recurring item brings its own
    if (schedule.rows.length === 0 && scheduleKind !== "lumpSum" && !input.templateId) throw new Error("loan schedule is empty");
    const back = repaymentDirection(draft);

    // A debt made on the Debts form needs migration 0019's columns; a loan
    // tracked from the simulator sends none of them, so it still saves on a
    // database that hasn't run it.
    const debtForm =
      lent || scheduleKind === "lumpSum" || input.counterparty != null || input.depositAccountId != null ||
      input.receivedTxId != null || input.templateId != null || input.payoffDate != null;
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
        schedule_kind: scheduleKind,
        kkdf_pct: input.kkdfPct ?? 0,
        bsmv_pct: input.bsmvPct ?? 0,
        custom_instalments: input.customInstalments ?? null,
        ...(debtForm
          ? {
              direction,
              counterparty: input.counterparty ?? null,
              deposit_account_id: input.depositAccountId ?? null,
              pay_account_id: input.accountId,
              payoff_date: input.payoffDate ?? null,
            }
          : {}),
        // only when linked: a database without 0023 still saves every other debt
        ...(input.purchaseId ? { purchase_id: input.purchaseId } : {}),
      })
      .select()
      .single();
    throwIf(loanError);
    const loanId = loanRow!.id as string;
    let templateId: string | null = null;

    /*
     * A level schedule is one repeating payment, so a recurring template says
     * it in a single row and keeps saying it past any materialization window.
     *
     * A schedule whose payments differ cannot be said that way at all — an
     * equal-principal loan falls by a little every month — so those are posted
     * as dated rows, one per installment. Both end up as ordinary planned
     * transactions, which is what makes a loan show up in next April whichever
     * shape it has. A recurring item that already plans the repayments ("Move
     * to Debts") joins the debt as it is, rows and all.
     */
    if (input.templateId) {
      templateId = input.templateId;
      const { error: tplError } = await this.db.from("recurring_templates").update({ loan_id: loanId }).eq("id", templateId);
      throwIf(tplError);
      const { error: rowsError } = await this.db.from("transactions").update({ loan_id: loanId }).eq("recurring_template_id", templateId);
      throwIf(rowsError);
    } else if (scheduleKind !== "lumpSum" && schedule.level) {
      const template = await this.createTemplate({
        name: `${input.name} installment`,
        accountId: input.accountId,
        direction: back,
        categoryId: lent ? null : input.categoryId,
        amount: schedule.installment,
        frequency: "monthly",
        startDate: schedule.rows[0].date,
        endDate: schedule.rows[schedule.rows.length - 1].date,
        autoComplete: input.autoComplete,
        loanId,
      });
      templateId = template.id;
    } else if (scheduleKind !== "lumpSum") {
      const { error: rowsError } = await this.db.from("transactions").insert(
        schedule.rows.map((row) =>
          this.txInsertRow({
            accountId: input.accountId,
            direction: back,
            categoryId: lent ? null : input.categoryId,
            amount: row.payment,
            status: "planned",
            dueDate: row.date,
            description: `${input.name} ${row.n}/${schedule.rows.length}`,
            loanId,
            fxSnapshot: null,
            loanPrincipal: lent,
          })
        )
      );
      throwIf(rowsError);
    }
    if (templateId) {
      const { error: linkError } = await this.db.from("loans").update({ recurring_template_id: templateId }).eq("id", loanId);
      throwIf(linkError);
    }

    // the money itself: a row already on the ledger, or a new one on the deposit account
    if (input.receivedTxId) {
      const { error } = await this.db.from("transactions").update({ loan_id: loanId, loan_principal: true }).eq("id", input.receivedTxId);
      throwIf(error);
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
        loanId,
        loanPrincipal: true,
      });
    }

    const loan = { ...loanFromRow(loanRow!), recurringTemplateId: templateId };
    // one payment on a date: planned like any re-plan
    if (scheduleKind === "lumpSum") await this.replanLoan(loan);
    return loan;
  }

  async updateLoan(id: string, patch: LoanPatch): Promise<void> {
    const current = (await this.listLoans()).find((l) => l.id === id);
    if (!current) return;
    const row: Row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.counterparty !== undefined) row.counterparty = patch.counterparty;
    if (patch.depositAccountId !== undefined) row.deposit_account_id = patch.depositAccountId;
    if (patch.payAccountId !== undefined) row.pay_account_id = patch.payAccountId;
    if (patch.payoffDate !== undefined) row.payoff_date = patch.payoffDate;
    if (patch.purchaseId !== undefined) row.purchase_id = patch.purchaseId;
    if (Object.keys(row).length > 0) {
      const { error } = await this.db.from("loans").update(row).eq("id", id);
      throwIf(error);
    }
    const next: Loan = { ...current };
    for (const key of Object.keys(patch) as (keyof LoanPatch)[]) {
      if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
    }
    const back = repaymentDirection(next);
    // the paying account carries what's still planned, the recurring item included
    if (next.payAccountId && next.payAccountId !== current.payAccountId) {
      const { error } = await this.db
        .from("transactions")
        .update({ account_id: next.payAccountId })
        .eq("loan_id", id)
        .eq("status", "planned")
        .eq("direction", back);
      throwIf(error);
      if (next.recurringTemplateId) {
        const { error: tplError } = await this.db.from("recurring_templates").update({ account_id: next.payAccountId }).eq("id", next.recurringTemplateId);
        throwIf(tplError);
      }
    }
    // the money's own row follows its account
    if (next.depositAccountId && next.depositAccountId !== current.depositAccountId) {
      const { error } = await this.db
        .from("transactions")
        .update({ account_id: next.depositAccountId })
        .eq("loan_id", id)
        .neq("direction", back);
      throwIf(error);
    }
    if ("payoffDate" in patch || "purchaseId" in patch) await this.replanLoan(next);
  }

  /** Applies replanRepayments: what's planned from here on, the recurring item's end with it. */
  private async replanLoan(loan: Loan): Promise<void> {
    const transactions = await this.listTransactions();
    const plan = replanRepayments(loan, transactions, todayISO());
    const template = loan.recurringTemplateId ? (await this.listTemplates()).find((t) => t.id === loan.recurringTemplateId) : undefined;
    const { repayments } = debtRows(loan, transactions);
    // a new row pays from where the debt is paid, filed where its repayments are
    const payFrom = loan.payAccountId ?? template?.accountId ?? repayments[0]?.accountId ?? null;
    const categoryId = repayments.find((t) => t.categoryId)?.categoryId ?? template?.categoryId ?? null;
    if (plan.remove.length > 0) {
      const { error } = await this.db.from("transactions").delete().in("id", plan.remove);
      throwIf(error);
    }
    if (template && plan.templateEnd !== undefined && plan.templateEnd !== template.endDate) {
      await this.updateTemplate(template.id, { endDate: plan.templateEnd });
    }
    if (!payFrom || plan.add.length === 0) return;
    const lent = loan.direction === "lent";
    const { error } = await this.db.from("transactions").insert(
      plan.add.map((row) =>
        this.txInsertRow({
          accountId: payFrom,
          direction: repaymentDirection(loan),
          categoryId: lent ? null : categoryId,
          amount: row.amount,
          status: "planned",
          dueDate: row.dueDate,
          description: row.description,
          loanId: loan.id,
          fxSnapshot: null,
          loanPrincipal: lent,
        })
      )
    );
    throwIf(error);
  }

  async deleteLoan(id: string, keepRows = false): Promise<void> {
    const { data: loan } = await this.db.from("loans").select("recurring_template_id").eq("id", id).single();
    if (keepRows) {
      // the item's link to the loan cascades on delete: unlink it first, so it stays
      const { error } = await this.db.from("recurring_templates").update({ loan_id: null }).eq("loan_id", id);
      throwIf(error);
    } else {
      if (loan?.recurring_template_id) await this.deleteTemplate(loan.recurring_template_id, true);
      // dated rows for a varying schedule: only the unpaid ones go, so a
      // deleted loan does not rewrite what already left the account
      const { error: txError } = await this.db
        .from("transactions")
        .delete()
        .eq("loan_id", id)
        .eq("status", "planned");
      throwIf(txError);
    }
    // what stays loses the debt's say over whether it's income; best effort,
    // as a database without 0019 has no such flag to clear
    await this.db.from("transactions").update({ loan_principal: false }).eq("loan_id", id).eq("loan_principal", true);
    const { error } = await this.db.from("loans").delete().eq("id", id);
    throwIf(error);
  }

  async listActivity(): Promise<ActivityEntry[]> {
    const { data, error } = await this.db.from("activity_log").select("*").order("at", { ascending: false }).limit(2000);
    // migration 0018 not run yet: no history, and nothing else depends on it
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id,
      at: r.at,
      entityType: r.entity_type,
      entityId: r.entity_id,
      accountId: r.account_id ?? null,
      action: r.action,
      summary: r.summary ?? "",
      changes: r.changes ?? {},
    }));
  }

  async appendActivity(entries: Omit<ActivityEntry, "id">[]): Promise<void> {
    if (!entries.length) return;
    const { error } = await this.db.from("activity_log").insert(
      entries.map((e) => ({
        user_id: this.userId,
        at: e.at,
        entity_type: e.entityType,
        entity_id: e.entityId,
        account_id: e.accountId,
        action: e.action,
        summary: e.summary,
        changes: e.changes,
      }))
    );
    throwIf(error);
  }

  async deleteAllData(): Promise<void> {
    // FK cascades wipe dependents when accounts go; clear the rest explicitly.
    for (const table of ["transactions", "purchases", "budgets", "goals", "net_worth_snapshots", "victvs_sessions", "victvs_payouts", "loans", "recurring_templates", "accounts", "categories", "user_settings"]) {
      const { error } = await this.db.from(table).delete().eq("user_id", this.userId);
      throwIf(error);
    }
    // the history goes too; a database without migration 0018 has none to clear
    await this.db.from("activity_log").delete().eq("user_id", this.userId);
    // and expected statements (0022), likewise
    await this.db.from("card_estimates").delete().eq("user_id", this.userId);
  }

  async exportAll(): Promise<BackupFile> {
    const [accounts, categories, transactions, templates, victvsSessions, victvsPayouts, loans, purchases, budgets, goals, snapshots, activity, cardEstimates] =
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
        this.listActivity(),
        this.listCardEstimates(),
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
      activity,
      cardEstimates,
    };
  }

  /** replaces all data; inserts follow FK dependency order with two-pass patches for circular refs */
  async importAll(backup: BackupFile): Promise<void> {
    // A backup holding adjustments needs migration 0016's column. Find out
    // before anything is deleted, so an older database refuses the restore
    // instead of being wiped and left half-filled.
    if (backup.transactions.some((t) => t.adjustment)) {
      const { error } = await this.db.from("transactions").select("adjustment").limit(0);
      throwIf(error);
    }
    // likewise debts (0019): money borrowed or lent, a debt's direction and accounts
    const debts =
      backup.transactions.some((t) => t.loanPrincipal) ||
      backup.loans.some((l) => l.direction === "lent" || l.counterparty || l.depositAccountId || l.payAccountId || l.payoffDate);
    if (debts) {
      const { error } = await this.db.from("loans").select("direction").limit(0);
      throwIf(error);
    }
    // and an income's periods (0020)
    if (backup.templates.some((t) => t.series)) {
      const { error } = await this.db.from("recurring_templates").select("series").limit(0);
      throwIf(error);
    }
    // and converted income (0021)
    if (backup.templates.some((t) => t.convertToAccountId) || backup.transactions.some((t) => t.convertsId)) {
      const { error } = await this.db.from("transactions").select("converts_id").limit(0);
      throwIf(error);
    }
    // and debts repaid through a card (0023)
    if (backup.loans.some((l) => l.purchaseId)) {
      const { error } = await this.db.from("loans").select("purchase_id").limit(0);
      throwIf(error);
    }
    // and expected card statements (0022)
    if (backup.cardEstimates?.length) {
      const { error } = await this.db.from("card_estimates").select("id").limit(0);
      throwIf(error);
    }
    await this.deleteAllData();
    const u = this.userId;
    const insert = async (table: string, rows: Row[]) => {
      if (!rows.length) return;
      // PostgREST inserts the union of every row's keys, so a key only some
      // rows carry (adjustment, holdings) would arrive as NULL on the others,
      // and `adjustment` is NOT NULL. Missing keys take the column default.
      const { error } = await this.db.from(table).insert(rows, { defaultToNull: false });
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
    // every field a loan has: its schedule's shape and levies (0014), and what
    // makes it a debt (0019) only when it says more than a plain loan you owe
    await insert("loans", backup.loans.map((l) => ({
      id: l.id, user_id: u, name: l.name, kind: l.kind, currency: l.currency, principal: l.principal,
      monthly_rate_pct: l.monthlyRatePct, term_months: l.termMonths, start_date: l.startDate,
      installment: l.installment, created_at: l.createdAt,
      schedule_kind: l.scheduleKind ?? "annuity", kkdf_pct: l.kkdfPct ?? 0, bsmv_pct: l.bsmvPct ?? 0,
      custom_instalments: l.customInstalments ?? null,
      ...(l.direction === "lent" ? { direction: "lent" } : {}),
      ...(l.counterparty ? { counterparty: l.counterparty } : {}),
      ...(l.depositAccountId ? { deposit_account_id: l.depositAccountId } : {}),
      ...(l.payAccountId ? { pay_account_id: l.payAccountId } : {}),
      ...(l.payoffDate ? { payoff_date: l.payoffDate } : {}),
      ...(l.purchaseId ? { purchase_id: l.purchaseId } : {}),
    })));
    await insert("recurring_templates", backup.templates.map((tpl) => ({
      id: tpl.id, user_id: u, name: tpl.name, account_id: tpl.accountId, direction: tpl.direction,
      category_id: tpl.categoryId, amount: tpl.amount, frequency: tpl.frequency, start_date: tpl.startDate,
      end_date: tpl.endDate, auto_complete: tpl.autoComplete, loan_id: tpl.loanId, created_at: tpl.createdAt,
      ...(tpl.series ? { series: tpl.series } : {}),
      ...(tpl.convertToAccountId ? { convert_to_account_id: tpl.convertToAccountId, convert_from: tpl.convertFrom ?? null } : {}),
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
      ...(t.adjustment ? { adjustment: true } : {}),
      ...(t.loanPrincipal ? { loan_principal: true } : {}),
      ...(t.convertsId ? { converts_id: t.convertsId } : {}),
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
      ...(s.sessionNo ? { session_no: s.sessionNo } : {}),
    })));
    await insert("budgets", backup.budgets.map((b) => ({ id: b.id, user_id: u, category_id: b.categoryId, monthly_limit: b.monthlyLimit, currency: b.currency })));
    await insert("goals", backup.goals.map((g) => ({ id: g.id, user_id: u, name: g.name, account_id: g.accountId, target_amount: g.targetAmount, target_date: g.targetDate, created_at: g.createdAt })));
    await insert("net_worth_snapshots", backup.snapshots.map((s) => ({ id: s.id, user_id: u, snapshot_date: s.snapshotDate, balances: s.balances, usd_per: s.usdPer, total_usd: s.totalUsd })));
    await insert("card_estimates", (backup.cardEstimates ?? []).map((e) => ({
      id: e.id, user_id: u, account_id: e.accountId, month: e.month, amount: e.amount, noted_on: e.notedOn, created_at: e.createdAt,
    })));
    // history last, and best effort: a database without migration 0018 restores everything else
    if (backup.activity?.length) {
      await this.db.from("activity_log").insert(
        backup.activity.map((e) => ({
          id: e.id, user_id: u, at: e.at, entity_type: e.entityType, entity_id: e.entityId,
          account_id: e.accountId, action: e.action, summary: e.summary, changes: e.changes,
        }))
      );
    }
  }
}
