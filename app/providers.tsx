"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/toaster";
import { AppProvider } from "@/lib/data/provider";
import { I18nProvider } from "@/lib/i18n";
import { showErrorToast } from "@/lib/ui/toasts";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // a failed save says why, instead of looking like nothing happened
        mutationCache: new MutationCache({ onError: (err) => showErrorToast("save", err) }),
        // so does a list that can't load at all; a failed background refetch
        // stays quiet, because the last good data is still on screen
        queryCache: new QueryCache({
          onError: (err, query) => {
            if (query.state.data === undefined) showErrorToast("load", err);
          },
        }),
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AppProvider>{children}</AppProvider>
        <Toaster />
      </I18nProvider>
    </QueryClientProvider>
  );
}
