import { Currency, CurrencyKind } from "@/lib/domain/currencies";
import { FxSnapshot } from "@/lib/domain/fx";

export type TxDirection = "income" | "expense";
export type TxStatus = "planned" | "completed";

export interface Account {
  id: string;
  name: string;
  currency: Currency;
  kind: CurrencyKind;
  openingBalance: number;
  archived: boolean;
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

export interface VictvsSession {
  id: string;
  date: string;
  sessionType: string;
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

export interface Settings {
  displayCurrency: Currency;
  locale: "en" | "tr";
}
