"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

/**
 * Pieces Classic's card grid and the version-2 dashboard both draw, so the
 * two say the same thing in the same words.
 */

/**
 * "2 hidden · 1 empty": the accounts a dashboard's list leaves out, linking
 * to where that's chosen. Nothing when nothing is left out. Its click stops
 * here: on Classic the whole card is a link to its page.
 */
export function AccountsLeftOut({ hidden, empty, className }: { hidden: number; empty: number; className?: string }) {
  const { t } = useI18n();
  if (hidden === 0 && empty === 0) return null;
  const parts = [
    hidden > 0 ? t("dashboard.accountsHidden", { count: hidden }) : null,
    empty > 0 ? t("dashboard.accountsEmpty", { count: empty }) : null,
  ].filter(Boolean);
  return (
    <Link
      href="/settings?tab=dashboard#accounts"
      onClick={(e) => e.stopPropagation()}
      data-accounts-left-out
      className={`mt-2 block text-xs text-zinc-400 hover:text-teal-600 hover:underline ${className ?? ""}`}
    >
      {parts.join(" · ")}
    </Link>
  );
}
