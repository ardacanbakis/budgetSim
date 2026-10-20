"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { Badge, Button, Card, CardHeader, EmptyState, Figure } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useRates, useVictvsSessions } from "@/lib/data/queries";
import { Account } from "@/lib/data/types";
import { chargeAmount } from "@/lib/domain/cards";
import { snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { cardStandings } from "@/lib/domain/purchases";
import { useI18n } from "@/lib/i18n";
import { NormalizedLayout } from "@/lib/ui/dashboardLayout";
import { COMING_UP_ROWS } from "@/lib/ui/pocket/homeSections";
import { comingUp, ComingUpItem } from "@/lib/ui/pocket/attention";
import { formatRow, formatSigned } from "@/lib/ui/pocket/format";
import { DashboardData } from "@/lib/useDashboardData";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * Upcoming on Classic and version 2: the same rule as Pocket's "Coming up"
 * (comingUp in lib/ui/pocket/attention.ts), so the three agree on what's due.
 * Planned rows that are overdue or due within the layout's range
 * (upcomingDays, 30 unless chosen), a transfer between your own accounts
 * once, card statements with Pay, and the unpaid VICTVS sessions as one row
 * unless the VICTVS card already shows them. COMING_UP_ROWS rows, then
 * "See all (n)".
 *
 * Every button stops its click: on Classic the whole card is a link.
 */

/** Where "See all" goes. The Timeline replaces it once it exists. */
export const UPCOMING_HREF = "/transactions";

export function useUpcomingItems(
  d: DashboardData | null,
  layout: NormalizedLayout | null,
  victvsCardShown: boolean
): ComingUpItem[] | null {
  const victvs = useVictvsSessions();
  const days = layout?.upcomingDays;
  return useMemo(() => {
    if (!d || days == null) return null;
    const unpaid = (victvs.data ?? []).filter((s) => s.status === "unpaid");
    return comingUp({
      transactions: d.transactions,
      accounts: d.accounts,
      book: d.book,
      today: d.today,
      days,
      duePayments: d.duePayments,
      standings: cardStandings(d.accounts, d.book, d.today),
      unpaidVictvsUsd: sumAmounts("USD", unpaid.map((s) => s.amount)),
      // the VICTVS card says it already; one place is enough
      unpaidVictvsCount: victvsCardShown ? 0 : unpaid.length,
    });
  }, [d, days, victvs.data, victvsCardShown]);
}

export function UpcomingCard({
  d,
  items,
  days,
  variant,
  className,
}: {
  d: DashboardData;
  items: ComingUpItem[];
  days: number;
  variant: "classic" | "v2";
  className?: string;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const rates = useRates();
  const [paying, setPaying] = useState<Account | null>(null);
  const complete = useAppMutation(
    (id: string) => repo.completeTransaction(id, snapshotFromTable(rates.data!)),
    [KEYS.transactions, KEYS.accounts]
  );

  // what a payment recorded now would cover, as the Cards page suggests it
  const covers = paying
    ? d.book.uncovered(paying.id).filter((c) => c.dueDate.slice(0, 7) < d.today.slice(0, 7))
    : [];

  const row = variant === "classic" ? "px-4 py-2.5" : "px-[var(--ui-card-pad-x)] py-[var(--ui-row-py)]";
  const link = variant === "classic" ? "text-xs text-teal-600 hover:underline" : "text-xs text-teal-600 hover:underline dark:text-teal-400";
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const amount = (text: string, tone?: "pos" | "neg") =>
    variant === "classic" ? (
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${tone === "pos" ? "text-emerald-600" : ""}`}>{text}</span>
    ) : (
      <Figure size="sm" tone={tone} className="shrink-0">
        {text}
      </Figure>
    );

  const overdueBadge = <Badge tone="red">{t("dashboard.overdue")}</Badge>;

  const render = (item: ComingUpItem) => {
    if (item.kind === "planned") {
      const { tx, account } = item;
      return (
        <li key={item.key} data-upcoming="planned" className={`flex items-center gap-3 ${row}`}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{tx.description || account.name || "—"}</div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className="truncate">
                {account.name} · <span className="tabular-nums">{fmtDate(tx.dueDate)}</span>
              </span>
              {item.overdue ? overdueBadge : null}
            </div>
          </div>
          {amount(formatRow(tx.direction, tx.amount, account.currency, locale), tx.direction === "income" ? "pos" : undefined)}
          <Button
            variant="ghost"
            disabled={!rates.data || complete.isPending}
            onClick={(e) => {
              stop(e);
              complete.mutate(tx.id);
            }}
          >
            ✓ {t("dashboard.complete")}
          </Button>
        </li>
      );
    }
    if (item.kind === "card") {
      const { account, figure } = item;
      return (
        <li key={item.key} data-upcoming="card" className={`flex items-center gap-3 ${row}`}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{account.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className="truncate">
                {t("dashboard.statementDue")} · <span className="tabular-nums">{fmtDate(item.date)}</span>
              </span>
              {item.overdue ? overdueBadge : null}
            </div>
          </div>
          {amount(formatSigned(figure.amount, account.currency, locale, "out"))}
          <Button
            variant="ghost"
            aria-label={t("pocket.home.payCard", { name: account.name })}
            onClick={(e) => {
              stop(e);
              setPaying(account);
            }}
          >
            {t("pocket.home.pay")}
          </Button>
        </li>
      );
    }
    return (
      <li key={item.key} data-upcoming="victvs" className={`flex items-center gap-3 ${row}`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {item.count === 1 ? t("pocket.home.unpaidSessionsOne") : t("pocket.home.unpaidSessionsMany", { count: item.count })}
          </div>
          <div className="text-xs text-zinc-500">{t("nav.victvs")}</div>
        </div>
        {amount(formatSigned(item.amountUsd, "USD", locale, "in"), "pos")}
        <Link href="/victvs" onClick={stop} className={link}>
          {t("dashboard.seeAll")} →
        </Link>
      </li>
    );
  };

  return (
    <Card className={className}>
      <CardHeader
        title={t("dashboard.upcoming")}
        action={
          <Link href={UPCOMING_HREF} onClick={stop} className={link}>
            {items.length > COMING_UP_ROWS ? t("dashboard.seeAllN", { count: items.length }) : t("dashboard.seeAll")} →
          </Link>
        }
      />
      {items.length === 0 ? (
        <div className={variant === "classic" ? "p-4" : "p-[var(--ui-card-pad-x)]"}>
          <EmptyState>{t("dashboard.nothingDueN", { count: days })}</EmptyState>
        </div>
      ) : (
        <ul data-upcoming-list className="divide-y divide-[var(--edge-soft)]">
          {items.slice(0, COMING_UP_ROWS).map(render)}
        </ul>
      )}
      {/* the modal portals out, but React still bubbles its clicks to the card */}
      <div onClick={stop}>
        <CardPaymentModal
          card={paying}
          suggested={Math.max(0, covers.reduce((sum, c) => sum + chargeAmount(c), 0))}
          covers={covers}
          onClose={() => setPaying(null)}
        />
      </div>
    </Card>
  );
}
