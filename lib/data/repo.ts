import { Currency, CurrencyKind } from "@/lib/domain/currencies";
import { FxSnapshot } from "@/lib/domain/fx";
import {
  Account,
  Category,
  Frequency,
  Loan,
  LoanKind,
  RecurringTemplate,
  Transaction,
  TxDirection,
  TxStatus,
  VictvsSession,
  VictvsPayout,
} from "./types";

export interface NewAccount {
  name: string;
  currency: Currency;
  kind: CurrencyKind;
  openingBalance: number;
}

export interface NewTransaction {
  accountId: string;
  direction: TxDirection;
  categoryId: string | null;
  amount: number;
  status: TxStatus;
  dueDate: string;
  description: string;
  /** required when status is completed */
  fxSnapshot: FxSnapshot | null;
  recurringTemplateId?: string | null;
  loanId?: string | null;
}

export interface NewTransfer {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  toAmount: number;
  date: string;
  description: string;
  marketRate: number | null;
  fxSnapshot: FxSnapshot | null;
}

export interface NewTemplate {
  name: string;
  accountId: string;
  direction: TxDirection;
  categoryId: string | null;
  amount: number;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  autoComplete: boolean;
  loanId?: string | null;
}

export interface NewVictvsSession {
  date: string;
  sessionType: string;
  amount: number;
  notes?: string;
  source: "manual" | "paste";
}

export interface MarkPaidInput {
  sessionIds: string[];
  accountId: string;
  paymentDate: string;
  /** amount that landed in the deposit account, in that account's currency */
  receivedAmount: number;
  /** sum of session amounts in USD */
  totalUsd: number;
  categoryId: string | null;
  fxSnapshot: FxSnapshot | null;
}

export interface NewLoan {
  name: string;
  kind: LoanKind;
  currency: Currency;
  principal: number;
  monthlyRatePct: number;
  termMonths: number;
  startDate: string;
  /** account the installments are paid from */
  accountId: string;
  categoryId: string | null;
  autoComplete: boolean;
}

/**
 * All app data flows through this interface. SupabaseRepo talks to Postgres
 * (RLS-scoped, server-authoritative); DemoRepo is a localStorage sandbox for
 * trying the app without an account. UI code cannot tell them apart.
 */
export interface Repo {
  readonly mode: "supabase" | "demo";

  listAccounts(): Promise<Account[]>;
  createAccount(input: NewAccount): Promise<Account>;
  updateAccount(id: string, patch: Partial<NewAccount> & { archived?: boolean }): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  listCategories(): Promise<Category[]>;
  createCategory(input: { name: string; direction: TxDirection; color: string }): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  /** idempotent: creates the default category set if the user has none */
  seedDefaultCategories(): Promise<void>;

  listTransactions(): Promise<Transaction[]>;
  createTransaction(input: NewTransaction): Promise<Transaction>;
  updateTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>
  ): Promise<void>;
  /** planned → completed, capturing the FX snapshot and optional final amount */
  completeTransaction(id: string, fxSnapshot: FxSnapshot, amount?: number): Promise<void>;
  /** completed → planned (undo) */
  reopenTransaction(id: string): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  createTransfer(input: NewTransfer): Promise<void>;

  listTemplates(): Promise<RecurringTemplate[]>;
  createTemplate(input: NewTemplate): Promise<RecurringTemplate>;
  updateTemplate(id: string, patch: Partial<NewTemplate>): Promise<void>;
  deleteTemplate(id: string, deletePlanned: boolean): Promise<void>;
  /** create missing planned transactions for template occurrences in [today, today+monthsAhead] */
  materializeTemplates(monthsAhead: number): Promise<number>;
  /** complete due planned items whose template has autoComplete, with given snapshot */
  autoCompleteDue(fxSnapshot: FxSnapshot): Promise<number>;

  listVictvsSessions(): Promise<VictvsSession[]>;
  listVictvsPayouts(): Promise<VictvsPayout[]>;
  createVictvsSessions(inputs: NewVictvsSession[]): Promise<number>;
  updateVictvsSession(
    id: string,
    patch: Partial<Pick<VictvsSession, "date" | "sessionType" | "amount" | "notes">>
  ): Promise<void>;
  deleteVictvsSession(id: string): Promise<void>;
  /** mark sessions paid: creates a payout + one aggregated income transaction */
  markVictvsPaid(input: MarkPaidInput): Promise<void>;
  /** undo a payout: sessions back to unpaid, aggregated transaction removed */
  unmarkVictvsPayout(payoutId: string): Promise<void>;

  listLoans(): Promise<Loan[]>;
  /** creates the loan + a linked auto recurring template for installments */
  createLoan(input: NewLoan): Promise<Loan>;
  deleteLoan(id: string): Promise<void>;

  /** wipe all data for this user/sandbox (demo reset & "delete my data") */
  deleteAllData(): Promise<void>;
}
