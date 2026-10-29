import { TxDirection } from "@/lib/data/types";

/**
 * Where recurring items live: Transactions' Income and Bills tabs, which took
 * the Recurring tab's place. /recurring and ?tab=recurring land on Income.
 */
export const RECURRING_HREF = {
  income: "/transactions?tab=income",
  bills: "/transactions?tab=bills",
} as const;

/** The tab an item of this direction is listed on. */
export function recurringHref(direction: TxDirection): string {
  return direction === "income" ? RECURRING_HREF.income : RECURRING_HREF.bills;
}
