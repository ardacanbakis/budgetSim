import { redirect } from "next/navigation";
import { RECURRING_HREF } from "@/lib/ui/recurringUrl";

/** Recurring items are Transactions' Income and Bills tabs now; old links and bookmarks land on Income. */
export default function RecurringPage() {
  redirect(RECURRING_HREF.income);
}
