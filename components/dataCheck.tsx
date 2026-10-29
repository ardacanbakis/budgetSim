"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DebtModal } from "@/components/debtModal";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTransactions, useVictvsSessions } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { checkData, DataFix, DataIssue, openIssues } from "@/lib/domain/dataCheck";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

/** Dismissed issues, kept on this device: a dismissal is a judgement about your own data. */
const DISMISSED_KEY = "renovator-datacheck-dismissed";
const DISMISS_EVENT = "renovator-datacheck-dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useDismissedIssues() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const load = () => setDismissed(readDismissed());
    queueMicrotask(load);
    window.addEventListener(DISMISS_EVENT, load);
    return () => window.removeEventListener(DISMISS_EVENT, load);
  }, []);
  const dismiss = useCallback((id: string) => {
    const next = readDismissed();
    next.add(id);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // nowhere to keep it; it shows again next time
    }
    setDismissed(next);
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, []);
  return { dismissed, dismiss };
}

/** Everything the check finds, minus what's been dismissed here. */
export function useDataIssues(): DataIssue[] | null {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const sessions = useVictvsSessions();
  const { dismissed } = useDismissedIssues();
  return useMemo(() => {
    if (!accounts.data || !transactions.data) return null;
    const all = checkData({
      accounts: accounts.data,
      transactions: transactions.data,
      victvsSessions: sessions.data ?? [],
      today: todayISO(),
    });
    return openIssues(all, dismissed);
  }, [accounts.data, transactions.data, sessions.data, dismissed]);
}

/** A line on the dashboard when something makes the numbers wrong. */
export function DataCheckNudge() {
  const { t } = useI18n();
  const issues = useDataIssues();
  const wrong = (issues ?? []).filter((i) => i.severity === "fix").length;
  if (wrong === 0) return null;
  return (
    <Link
      href="/settings?tab=check"
      data-datacheck-nudge
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span>{t("datacheck.nudge", { count: wrong })}</span>
      <span className="shrink-0 font-medium">{t("datacheck.review")} →</span>
    </Link>
  );
}

/** Settings → Data check. */
export function DataCheckCard() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const rates = useRates();
  const accounts = useAccounts();
  const issues = useDataIssues();
  const { dismiss } = useDismissedIssues();
  const [moving, setMoving] = useState<Transaction | null>(null);

  const apply = useAppMutation(
    async (fix: DataFix) => {
      switch (fix.kind) {
        case "delete":
          for (const id of fix.txIds) await repo.deleteTransaction(id);
          return;
        case "complete": {
          const snapshot = rates.data ? snapshotFromTable(rates.data) : null;
          if (!snapshot) throw new Error("rates");
          for (const id of fix.txIds) await repo.completeTransaction(id, snapshot);
          return;
        }
        case "reopen":
          await repo.reopenTransaction(fix.txId);
          return;
        case "setPayer":
          await repo.updateAccount(fix.cardId, { paymentAccountId: fix.payerId });
          return;
      }
    },
    [KEYS.transactions, KEYS.accounts]
  );

  if (issues == null) return <Spinner />;

  const currencyOf = new Map((accounts.data ?? []).map((a) => [a.id, a.currency] as const));
  const money = (amount: number | undefined, currency: DataIssue["currency"]) =>
    amount != null && currency ? formatAmount(amount, currency, locale) : "";

  const title = (i: DataIssue) =>
    t(`datacheck.${i.kind}`, {
      account: i.account?.name ?? "—",
      other: i.other?.name ?? "—",
      amount: money(i.amount, i.currency),
      count: i.txs.length || i.sessions?.length || 0,
    });

  const fixLabel = (fix: DataFix) =>
    fix.kind === "delete"
      ? t("datacheck.fixDelete", { count: fix.txIds.length })
      : fix.kind === "complete"
        ? t("datacheck.fixComplete", { count: fix.txIds.length })
        : fix.kind === "reopen"
          ? t("datacheck.fixReopen")
          : t("datacheck.fixPayer");

  const rows = (["fix", "tidy"] as const).map((severity) => ({
    severity,
    items: issues.filter((i) => i.severity === severity),
  }));

  return (
    <Card>
      <CardHeader title={t("datacheck.title")} />
      <div className="space-y-4 p-4">
        <p className="text-sm text-zinc-500">{t("datacheck.intro")}</p>
        {issues.length === 0 ? <EmptyState>{t("datacheck.clean")}</EmptyState> : null}
        {rows.map(({ severity, items }) =>
          items.length === 0 ? null : (
            <section key={severity} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t(severity === "fix" ? "datacheck.groupFix" : "datacheck.groupTidy")} · {items.length}
              </h3>
              <ul className="space-y-2">
                {items.map((issue) => (
                  <li
                    key={issue.id}
                    data-issue={issue.kind}
                    className="space-y-2 rounded-lg border border-[var(--edge)] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium">{title(issue)}</p>
                      <Badge tone={severity === "fix" ? "amber" : "zinc"}>{t(`datacheck.short_${issue.kind}`)}</Badge>
                    </div>
                    {issue.txs.length > 0 ? (
                      <ul className="space-y-0.5 text-xs text-zinc-500">
                        {issue.txs.slice(0, 4).map((tx) => (
                          <li key={tx.id} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {fmtDate(tx.dueDate)} · {tx.description || "—"}
                              {tx.status === "planned" ? ` · ${t("tx.planned")}` : ""}
                              {tx.legacy ? ` · ${t("legacy.badge")}` : ""}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {tx.direction === "income" ? "+" : "−"}
                              {formatAmount(tx.amount, currencyOf.get(tx.accountId) ?? "TRY", locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {issue.sessions ? (
                      <p className="text-xs text-zinc-500">
                        {issue.sessions
                          .slice(0, 4)
                          .map((s) => `${fmtDate(s.date)} · ${s.sessionType} · ${formatAmount(s.amount, "USD", locale)}`)
                          .join("  ·  ")}
                      </p>
                    ) : null}
                    <p className="text-xs text-zinc-500">{t(`datacheck.hint_${issue.kind}`)}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      {issue.kind === "oldUnpaidSession" ? (
                        <Link href="/victvs" className="self-center text-xs text-teal-600 hover:underline">
                          {t("datacheck.openVictvs")} →
                        </Link>
                      ) : null}
                      <Button variant="ghost" onClick={() => dismiss(issue.id)}>
                        {t("datacheck.dismiss")}
                      </Button>
                      {issue.kind === "borrowedAsIncome" && issue.txs[0] ? (
                        <Button variant="primary" onClick={() => setMoving(issue.txs[0])}>
                          {t("debts.moveToDebts")}
                        </Button>
                      ) : null}
                      {issue.fix ? (
                        <Button
                          variant={issue.fix.kind === "delete" ? "danger" : "primary"}
                          disabled={apply.isPending || (issue.fix.kind === "complete" && !rates.data)}
                          onClick={() => apply.mutate(issue.fix!)}
                        >
                          {fixLabel(issue.fix)}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>
      <DebtModal open={moving != null} onClose={() => setMoving(null)} from={moving ? { kind: "transaction", tx: moving } : null} />
    </Card>
  );
}
