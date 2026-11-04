"use client";

import { useQuery } from "@tanstack/react-query";
import { LiraHistory } from "@/lib/domain/liraDevaluation";

/** USD/TRY now and 1–5 years back (lib/domain/liraDevaluation.ts), for Gadgets and the Plan's devaluation. */
export function useLiraHistory() {
  return useQuery({
    queryKey: ["lira-history"],
    queryFn: async () => {
      const res = await fetch("/api/rate-history?devaluation=1");
      if (!res.ok) throw new Error(`lira history ${res.status}`);
      return (await res.json()) as LiraHistory;
    },
    // a year-on-year average barely moves within a day
    staleTime: 12 * 3600_000,
  });
}
