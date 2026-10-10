import { redirect } from "next/navigation";

/** Recurring is a tab of the Transactions page now; old links and bookmarks land there. */
export default function RecurringPage() {
  redirect("/transactions?tab=recurring");
}
