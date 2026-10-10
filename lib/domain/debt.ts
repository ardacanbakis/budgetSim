import { Account, Loan, Transaction } from "@/lib/data/types";
import { buildCardBook } from "./cards";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { amortizationSchedule } from "./loan";

export interface DebtItem {
  kind: "loan" | "card";
  id: string;
  name: string;
  currency: Currency;
  /** outstanding amount in its own currency */
  outstanding: number;
  /** monthly interest %; null for cards (unknown) */
  monthlyRatePct: number | null;
  /** last scheduled payment date; null for revolving card debt */
  endDate: string | null;
}

export interface DebtOverview {
  items: DebtItem[];
  /** total outstanding in display currency (loans remaining + what each card is owed) */
  totalInDisplay: number;
  /** latest scheduled payment across everything, i.e. the debt-free date */
  debtFreeDate: string | null;
  /** avalanche: highest-rate debt to attack first */
  avalancheTarget: DebtItem | null;
}

/** Combined debt picture: tracked loans + what each credit card is owed (see lib/domain/cards.ts). */
export function computeDebtOverview(params: {
  loans: Loan[];
  accounts: Account[];
  balances: Map<string, number>;
  transactions: Transaction[];
  usdPer: UsdPerMap;
  display: Currency;
  today: string;
}): DebtOverview {
  const { loans, accounts, transactions, usdPer, display, today } = params;
  const items: DebtItem[] = [];
  let debtFreeDate: string | null = null;

  for (const loan of loans) {
    const schedule = amortizationSchedule(loan.principal, loan.monthlyRatePct, loan.termMonths, loan.startDate, loan.currency);
    const paidCount = transactions.filter((t) => t.loanId === loan.id && t.status === "completed").length;
    const paid = Math.min(paidCount, loan.termMonths);
    const outstanding = paid > 0 ? schedule.rows[paid - 1].remaining : loan.principal;
    const endDate = schedule.rows[schedule.rows.length - 1].date;
    if (outstanding > 0) {
      items.push({ kind: "loan", id: loan.id, name: loan.name, currency: loan.currency, outstanding, monthlyRatePct: loan.monthlyRatePct, endDate });
      if (debtFreeDate == null || endDate > debtFreeDate) debtFreeDate = endDate;
    }
  }

  const book = buildCardBook(accounts, transactions);
  for (const account of accounts) {
    if (account.kind !== "credit_card" || account.archived) continue;
    const outstanding = book.owed(account.id, today);
    if (outstanding <= 0.005) continue;
    // the last bill: a payment still to make, or the month an uncovered charge is paid in
    const dates = [
      ...book.payments(account.id).filter((p) => !p.made).map((p) => p.date),
      ...book.uncovered(account.id).map((c) => `${book.paidInMonth(c)}-01`),
    ];
    const lastDue = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    items.push({ kind: "card", id: account.id, name: account.name, currency: account.currency, outstanding, monthlyRatePct: null, endDate: lastDue });
    const cardEnd = lastDue ?? today;
    if (debtFreeDate == null || cardEnd > debtFreeDate) debtFreeDate = cardEnd;
  }

  let totalInDisplay = 0;
  for (const item of items) {
    const converted = convert(item.outstanding, item.currency, display, usdPer);
    if (converted != null) totalInDisplay += converted;
  }

  const rated = items.filter((i) => i.monthlyRatePct != null);
  const avalancheTarget = rated.length
    ? rated.reduce((max, i) => ((i.monthlyRatePct ?? 0) > (max.monthlyRatePct ?? 0) ? i : max))
    : null;

  return { items, totalInDisplay, debtFreeDate, avalancheTarget };
}
