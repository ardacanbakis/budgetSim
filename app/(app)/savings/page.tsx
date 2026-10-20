import { redirect } from "next/navigation";
import { movedHref, SearchParamsRecord } from "@/lib/ui/movedHref";

/**
 * Evim sistemi is a tab of the Plan page now; old links and bookmarks land
 * there, a saved scenario's ?plan= with them.
 */
export default async function SavingsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(movedHref("/planner?tab=evim", await searchParams));
}
