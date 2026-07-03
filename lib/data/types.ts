import { Currency, CurrencyKind } from "@/lib/domain/currencies";
import { FxSnapshot } from "@/lib/domain/fx";

export type TxDirection = "income" | "expense";
export type TxStatus = "planned" | "completed";

/** Currency-derived kinds plus credit cards (fiat-currency debt accounts). */
export type AccountKind = CurrencyKind | "credit_card";

export interface Account {
  id: string;
  name: string;
  currency: Currency;
  kind: AccountKind;
  openingBalance: number;
  archived: boolean;
  /** credit cards: default account the bill is paid from */
  paymentAccountId: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  direction: TxDirection;
  color: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  direction: TxDirection;
  categoryId: string | null;
  /** amount in the account's currency, always positive */
  amount: number;
  status: TxStatus;
  /** date the item is due / happened (yyyy-mm-dd) */
  dueDate: string;
  completedAt: string | null;
  description: string;
  fxSnapshot: FxSnapshot | null;
  /** links the two legs of a transfer */
  transferGroupId: string | null;
  /** market rate (dst per src) at transfer time, for spread display */
  transferMarketRate: number | null;
  recurringTemplateId: string | null;
  loanId: string | null;
  victvsPayoutId: string | null;
  purchaseId: string | null;
  createdAt: string;
}

/** Big-purchase log entry; installmentCount 1 = one-shot. */
export interface Purchase {
  id: string;
  name: string;
  accountId: string | null;
  amount: number;
  purchaseDate: string;
  installmentCount: number;
  firstDue: string;
  details: string;
  reflected: boolean;
  categoryId: string | null;
  createdAt: string;
}

export type Frequency = "weekly" | "monthly" | "yearly";

export interface RecurringTemplate {
  id: string;
  name: string;
  accountId: string;
  direction: TxDirection;
  categoryId: string | null;
  amount: number;
  frequency: Frequency;
  /** anchor date; monthly recurs on its day-of-month (clamped), weekly on its weekday */
  startDate: string;
  endDate: string | null;
  autoComplete: boolean;
  loanId: string | null;
  createdAt: string;
}

export type VictvsStatus = "unpaid" | "paid";

/** The four session kinds; sessionType stays a string for forward-compat. */
export const VICTVS_TYPES = ["IWCF", "CIPS OR", "CIPS CR", "FIFA"] as const;
export type VictvsType = (typeof VICTVS_TYPES)[number];

export const DEFAULT_VICTVS_AMOUNTS: Record<VictvsType, number> = {
  IWCF: 60,
  "CIPS OR": 37.5,
  "CIPS CR": 60,
  FIFA: 30,
};

export interface VictvsSession {
  id: string;
  date: string;
  sessionType: string;
  /** exam/session number, e.g. "37324" */
  sessionNo: string;
  amount: number; // USD
  status: VictvsStatus;
  payoutId: string | null;
  notes: string;
  source: "manual" | "paste";
  createdAt: string;
}

export interface VictvsPayout {
  id: string;
  paymentDate: string;
  accountId: string;
  total: number;
  transactionId: string;
  sessionCount: number;
  createdAt: string;
}

export type LoanKind = "house" | "car" | "other";

export interface Loan {
  id: string;
  name: string;
  kind: LoanKind;
  currency: Currency;
  principal: number;
  /** monthly interest rate in percent (Turkish bank convention) */
  monthlyRatePct: number;
  termMonths: number;
  startDate: string;
  installment: number;
  recurringTemplateId: string | null;
  createdAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  monthlyLimit: number;
  currency: Currency;
}

export interface Goal {
  id: string;
  name: string;
  accountId: string;
  targetAmount: number; // in the account's currency
  targetDate: string | null;
  createdAt: string;
}

export interface NetWorthSnapshot {
  id: string;
  /** yyyy-mm-dd; unique per month per user */
  snapshotDate: string;
  balances: Record<string, number>;
  usdPer: import("@/lib/domain/fx").UsdPerMap;
  totalUsd: number;
}

export interface DashboardLayout {
  order: string[];
  hidden: string[];
}

export interface UserSettings {
  dashboardLayout: DashboardLayout | null;
  theme: "system" | "light" | "dark" | "slate" | "ocean" | "forest" | "mocha";
  compact: boolean;
  /** default deposit account for VICTVS payouts */
  victvsAccountId: string | null;
  /** per-type default session amounts (USD) */
  victvsDefaults: Record<string, number> | null;
}
