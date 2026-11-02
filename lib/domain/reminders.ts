import { Account, Transaction } from "@/lib/data/types";
import { CardBook } from "./cards";

/**
 * Reminders for what you pay that isn't a card statement: a loan's
 * installment, a bill, a one-off expense set down ahead. Card statements have
 * their own rule (cardPaymentReminders in ./cards.ts); this one is the same
 * timing for everything else.
 *
 * A planned expense on one of your accounts is brought up the day before it's
 * due, on the day, and every day after while it's still not marked paid.
 * Charges on a card (paid with its statement), card payments (the card's own
 * reminder) and transfers between your accounts aren't bills. Overdue first,
 * then by date.
 */
export interface BillReminder {
  tx: Transaction;
  account: Account;
  when: "tomorrow" | "today" | "overdue";
}

export function billReminders(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  book: CardBook,
  today: string
): BillReminder[] {
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const out: BillReminder[] = [];
  for (const tx of transactions) {
    if (tx.status !== "planned" || tx.direction !== "expense" || tx.legacy || tx.dueDate > tomorrow) continue;
    if (book.roleOf(tx) !== "regular") continue;
    const account = byId.get(tx.accountId);
    if (!account || account.archived) continue;
    const when = tx.dueDate < today ? "overdue" : tx.dueDate === today ? "today" : "tomorrow";
    out.push({ tx, account, when });
  }
  return out.sort((a, b) => a.tx.dueDate.localeCompare(b.tx.dueDate));
}
