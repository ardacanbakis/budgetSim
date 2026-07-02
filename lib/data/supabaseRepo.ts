import type { SupabaseClient } from "@supabase/supabase-js";
import { FxSnapshot } from "@/lib/domain/fx";
import { amortizationSchedule } from "@/lib/domain/loan";
import { computeMissingOccurrences, findAutoCompletable } from "@/lib/domain/materialize";
import {
  MarkPaidInput,
  NewAccount,
  NewLoan,
  NewTemplate,
  NewTransaction,
  NewTransfer,
  NewVictvsSession,
  Repo,
} from "./repo";
import {
  Account,
  Category,
  Loan,
  RecurringTemplate,
  Transaction,
  TxDirection,
  VictvsPayout,
  VictvsSession,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const accountFromRow = (r: Row): Account => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  kind: r.kind,
  openingBalance: Number(r.opening_balance),
  archived: r.archived,
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
  recurringTemplateId: r.recurring_template_id,
  createdAt: r.created_at,
});

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
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

  async listAccounts(): Promise<Account[]> {
    const { data, error } = await this.db.from("accounts").select("*").order("created_at");
    throwIf(error);
    return (data ?? []).map(accountFromRow);
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
    const { error } = await this.db.from("accounts").update(row).eq("id", id);
    throwIf(error);
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.db.from("accounts").delete().eq("id", id);
    throwIf(error);
  }

  async listCategories(): Promise<Category[]> {
    const { data, error } = await this.db.from("categories").select("*").order("created_at");
    throwIf(error);
    return (data ?? []).map(categoryFromRow);
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

  async listTransactions(): Promise<Transaction[]> {
    const { data, error } = await this.db
      .from("transactions")
      .select("*")
      .order("due_date", { ascending: false })
      .limit(10000);
    throwIf(error);
    return (data ?? []).map(txFromRow);
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

  async completeTransaction(id: string, fxSnapshot: FxSnapshot, amount?: number): Promise<void> {
    const row: Row = {
      status: "completed",
      completed_at: new Date().toISOString(),
      fx_snapshot: fxSnapshot,
    };
    if (amount != null) row.amount = amount;
    const { error } = await this.db.from("transactions").update(row).eq("id", id);
    throwIf(error);
  }

  async reopenTransaction(id: string): Promise<void> {
    const { error } = await this.db
      .from("transactions")
      .update({ status: "planned", completed_at: null, fx_snapshot: null })
      .eq("id", id);
    throwIf(error);
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
    const base = {
      user_id: this.userId,
      category_id: null,
      status: "completed",
      due_date: input.date,
      completed_at: now,
      fx_snapshot: input.fxSnapshot,
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
    const { data, error } = await this.db.from("recurring_templates").select("*").order("created_at");
    throwIf(error);
    return (data ?? []).map(templateFromRow);
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

  async createTemplate(input: NewTemplate): Promise<RecurringTemplate> {
    const { data, error } = await this.db
      .from("recurring_templates")
      .insert(this.templateInsertRow(input))
      .select()
      .single();
    throwIf(error);
    return templateFromRow(data!);
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
    const { error } = await this.db.from("recurring_templates").update(row).eq("id", id);
    throwIf(error);
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
    const rows = missing.map(({ template, dueDate }) => ({
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
    }));
    const { error } = await this.db.from("transactions").insert(rows);
    throwIf(error);
    return missing.length;
  }

  async autoCompleteDue(fxSnapshot: FxSnapshot): Promise<number> {
    const [templates, transactions] = await Promise.all([this.listTemplates(), this.listTransactions()]);
    const due = findAutoCompletable(templates, transactions);
    if (!due.length) return 0;
    const { error } = await this.db
      .from("transactions")
      .update({ status: "completed", completed_at: new Date().toISOString(), fx_snapshot: fxSnapshot })
      .in(
        "id",
        due.map((t) => t.id)
      );
    throwIf(error);
    return due.length;
  }

  async listVictvsSessions(): Promise<VictvsSession[]> {
    const { data, error } = await this.db
      .from("victvs_sessions")
      .select("*")
      .order("date", { ascending: false });
    throwIf(error);
    return (data ?? []).map(sessionFromRow);
  }

  async listVictvsPayouts(): Promise<VictvsPayout[]> {
    const { data, error } = await this.db
      .from("victvs_payouts")
      .select("*")
      .order("payment_date", { ascending: false });
    throwIf(error);
    return (data ?? []).map(payoutFromRow);
  }

  async createVictvsSessions(inputs: NewVictvsSession[]): Promise<number> {
    if (!inputs.length) return 0;
    const rows = inputs.map((s) => ({
      user_id: this.userId,
      date: s.date,
      session_type: s.sessionType,
      amount: s.amount,
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

  async listLoans(): Promise<Loan[]> {
    const { data, error } = await this.db.from("loans").select("*").order("created_at");
    throwIf(error);
    return (data ?? []).map(loanFromRow);
  }

  async createLoan(input: NewLoan): Promise<Loan> {
    const schedule = amortizationSchedule(
      input.principal,
      input.monthlyRatePct,
      input.termMonths,
      input.startDate,
      input.currency
    );
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
      })
      .select()
      .single();
    throwIf(loanError);
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
      loanId: loanRow!.id,
    });
    const { error: linkError } = await this.db
      .from("loans")
      .update({ recurring_template_id: template.id })
      .eq("id", loanRow!.id);
    throwIf(linkError);
    return { ...loanFromRow(loanRow!), recurringTemplateId: template.id };
  }

  async deleteLoan(id: string): Promise<void> {
    const { data: loan } = await this.db.from("loans").select("recurring_template_id").eq("id", id).single();
    if (loan?.recurring_template_id) await this.deleteTemplate(loan.recurring_template_id, true);
    const { error } = await this.db.from("loans").delete().eq("id", id);
    throwIf(error);
  }

  async deleteAllData(): Promise<void> {
    // FK cascades wipe dependents when accounts go; clear the rest explicitly.
    for (const table of ["transactions", "victvs_sessions", "victvs_payouts", "loans", "recurring_templates", "accounts", "categories"]) {
      const { error } = await this.db.from(table).delete().eq("user_id", this.userId);
      throwIf(error);
    }
  }
}
