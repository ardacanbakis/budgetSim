import { redirect } from "next/navigation";
import { movedHref, SearchParamsRecord } from "@/lib/ui/movedHref";

/**
 * Debt split in two: tracked loans and what's owed are the Portfolio's Debts
 * view, the simulator a tab of Plan. Old links and bookmarks land on the
 * Debts view.
 */
export default async function LoansPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(movedHref("/accounts?view=debts", await searchParams));
}
