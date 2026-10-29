"use client";

import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState, Select, Spinner } from "@/components/ui";
import { useAccounts, useActivity, useCategories, useTransactions } from "@/lib/data/queries";
import { Account, ActivityEntity, ActivityEntry } from "@/lib/data/types";
import { HistoryItem, holdingsDiff, lastChange, mergeHistory, moneyRows } from "@/lib/domain/activity";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

/** Fields a line never spells out: the action already says it, or it's just context. */
const QUIET = new Set(["status", "legacy", "archived", "reflected", "kind", "currency"]);
const MONEY = new Set(["amount", "openingBalance", "creditLimit", "principal", "usd", "total"]);
/** a transaction's own money row already says these; the log would only repeat them */
const SHOWN_AS_MONEY = new Set(["created", "completed", "autoCompleted", "adjusted"]);

/** An account's log entries that add to its money rows. */
function accountChanges(entries: readonly ActivityEntry[], accountId: string): ActivityEntry[] {
  return entries.filter((e) => e.accountId === accountId && !(e.entityType === "transaction" && SHOWN_AS_MONEY.has(e.action)));
}

/**
 * Turns an ActivityEntry into words: what was done to what, and each field
 * it changed ("Amount ₺1,679.00 → ₺2,090.00", "has 13 → 15").
 */
export function useChangeText() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const accounts = useAccounts();
  const categories = useCategories();
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  return (entry: ActivityEntry): { title: string; details: string[] } => {
    const currency: Currency =
      entry.entityType === "victvs" && "usd" in entry.changes
        ? "USD"
        : (accountById.get(entry.accountId ?? "")?.currency ?? "TRY");
    const value = (field: string, v: unknown): string => {
      if (v == null || v === "") return "—";
      if (MONEY.has(field) && typeof v === "number") return formatAmount(field === "usd" ? v : Math.abs(v), field === "usd" ? "USD" : currency, locale);
      if (field === "dueDate" || field === "startDate" || field === "endDate" || field === "firstDue" || field === "payoffDate") return fmtDate(String(v));
      if (field === "accountId" || field === "paymentAccountId" || field === "depositAccountId" || field === "payAccountId" || field === "convertToAccountId") {
        return accountById.get(String(v))?.name ?? "—";
      }
      if (entry.entityType === "loan" && field === "kind") return t(`loans.${String(v)}`);
      if (entry.entityType === "loan" && field === "direction") return v === "lent" ? t("debts.lentBadge") : t("debts.oweBadge");
      if (field === "categoryId") return categoryById.get(String(v))?.name ?? "—";
      if (typeof v === "boolean") return v ? t("history.yes") : t("history.no");
      return String(v);
    };
    const details: string[] = [];
    for (const [field, [before, after]] of Object.entries(entry.changes)) {
      if (QUIET.has(field)) continue;
      if (field === "dueDate" && before === after) continue;
      if (field === "holdings") {
        for (const d of holdingsDiff(before, after)) details.push(`${t(`gold.type_${d.type}`)} ${d.before} → ${d.after}`);
        continue;
      }
      if (field === "plannedRemoved" && Array.isArray(entry.changes.plannedRemoved)) {
        const [had, left] = entry.changes.plannedRemoved as [number, number];
        if (had > 0) details.push(left === 0 ? t("history.plannedRemoved", { count: had }) : t("history.plannedKept", { count: had }));
        continue;
      }
      if (field === "transactionsDeleted") {
        if (after) details.push(t("history.transactionsDeleted"));
        continue;
      }
      const label = t(`history.field.${field}`);
      // a creation or deletion says what it was; an edit says what it became
      if (before == null) details.push(`${label} ${value(field, after)}`);
      else if (after == null) details.push(`${label} ${value(field, before)}`);
      else details.push(`${label} ${value(field, before)} → ${value(field, after)}`);
    }
    const action =
      entry.entityType === "backup" ? t("history.action.backupRestored") : t(`history.action.${entry.action}`);
    const what = entry.summary && entry.entityType !== "backup" ? entry.summary : t(`history.entity.${entry.entityType}`);
    return { title: `${action} · ${what}`, details };
  };
}

function whenOf(at: string, fmtDate: (iso: string) => string, locale: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const day = fmtDate(at.slice(0, 10));
  const time = d.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** One change, as a line. */
export function ChangeLine({ entry }: { entry: ActivityEntry }) {
  const { locale } = useI18n();
  const fmtDate = useFormatDate();
  const text = useChangeText();
  const { title, details } = text(entry);
  return (
    <div className="min-w-0" data-change={entry.action}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="truncate text-sm">{title}</span>
        <span className="text-[11px] text-zinc-400">{whenOf(entry.at, fmtDate, locale)}</span>
      </div>
      {details.length > 0 ? <div className="text-xs text-zinc-500">{details.join(" · ")}</div> : null}
    </div>
  );
}

/** An account's story: money in and out with the balance it left, and every edit, newest first. */
export function useAccountHistory(account: Account | null, balanceNow: number): HistoryItem[] {
  const transactions = useTransactions();
  const activity = useActivity();
  return useMemo(() => {
    if (!account) return [];
    const money = account.kind === "credit_card" ? [] : moneyRows(account.id, transactions.data ?? [], balanceNow);
    return mergeHistory(money, accountChanges(activity.data ?? [], account.id));
  }, [account, transactions.data, activity.data, balanceNow]);
}

/**
 * The first few lines of an account's story: what changed it last, and
 * before that. Money rows show the balance they left.
 */
export function RecentChanges({
  account,
  balanceNow,
  limit = 5,
  className = "border-b border-[var(--edge-soft)] px-4 py-3",
}: {
  account: Account;
  balanceNow: number;
  limit?: number;
  /** the frame; nothing at all is drawn when there's no history */
  className?: string;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const items = useAccountHistory(account, balanceNow).slice(0, limit);
  if (items.length === 0) return null;
  return (
    <div className={className} data-recent-changes>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{t("history.latest")}</p>
      <ul className="space-y-1.5">
        {items.map((item) =>
          item.kind === "change" ? (
            <li key={`c${item.entry.id}`}>
              <ChangeLine entry={item.entry} />
            </li>
          ) : (
            <li key={`m${item.row.tx.id}`} className="flex items-baseline justify-between gap-2 text-sm" data-money-row>
              <span className="min-w-0 truncate">
                {item.row.tx.description || "—"}
                {item.row.tx.adjustment ? (
                  <span className="ml-1.5">
                    <Badge tone="violet">{t("adjust.badge")}</Badge>
                  </span>
                ) : null}
                <span className="ml-2 text-[11px] text-zinc-400">{fmtDate(item.row.tx.dueDate)}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={item.row.delta >= 0 ? "text-green-600" : "text-red-600"}>
                  {item.row.delta >= 0 ? "+" : "−"}
                  {formatAmount(Math.abs(item.row.delta), account.currency, locale)}
                </span>
                {item.row.balanceAfter != null ? (
                  <span className="block text-[11px] text-zinc-400">
                    {t("history.balanceAfter", { amount: formatAmount(item.row.balanceAfter, account.currency, locale) })}
                  </span>
                ) : null}
              </span>
            </li>
          )
        )}
      </ul>
    </div>
  );
}

/** "Last change: …" under an account's name in a list. */
export function useLastChange() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const transactions = useTransactions();
  const activity = useActivity();
  const text = useChangeText();
  return (account: Account, balanceNow: number): string | null => {
    const money = account.kind === "credit_card" ? [] : moneyRows(account.id, transactions.data ?? [], balanceNow);
    const last = lastChange(money, accountChanges(activity.data ?? [], account.id));
    if (!last) return null;
    if (last.kind === "change") return `${text(last.entry).title} · ${fmtDate(last.entry.at.slice(0, 10))}`;
    const { tx, delta } = last.row;
    return t("history.lastMoney", {
      amount: `${delta >= 0 ? "+" : "−"}${formatAmount(Math.abs(delta), account.currency, locale)}`,
      date: fmtDate(tx.dueDate),
      what: tx.description || "—",
    });
  };
}

/** Changes to one item that isn't an account (a big purchase, a recurring item, a debt). */
export function EntityChanges({ entityType, entityId }: { entityType: ActivityEntity; entityId: string }) {
  const { t } = useI18n();
  const activity = useActivity();
  const entries = (activity.data ?? []).filter((e) => e.entityType === entityType && e.entityId === entityId);
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2" data-entity-changes>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("history.changes")}</h3>
      <ul className="space-y-1.5">
        {entries.slice(0, 20).map((e) => (
          <li key={e.id}>
            <ChangeLine entry={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ENTITY_FILTERS = ["all", "account", "transaction", "purchase", "template", "loan", "victvs"] as const;

/** Settings → History: every change, newest first, by type and account. */
export function HistoryCard() {
  const { t } = useI18n();
  const activity = useActivity();
  const accounts = useAccounts();
  const [type, setType] = useState<(typeof ENTITY_FILTERS)[number]>("all");
  const [accountId, setAccountId] = useState("");
  const [shown, setShown] = useState(50);
  if (activity.isLoading) return <Spinner />;
  const entries = (activity.data ?? []).filter(
    (e) => (type === "all" || e.entityType === type) && (!accountId || e.accountId === accountId)
  );
  return (
    <Card>
      <CardHeader
        title={t("history.title")}
        action={<Badge tone="zinc">{entries.length}</Badge>}
      />
      <div className="space-y-3 p-4">
        <p className="text-sm text-zinc-500">{t("history.intro")}</p>
        <div className="flex flex-wrap gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value as (typeof ENTITY_FILTERS)[number])} aria-label={t("history.filterType")}>
            {ENTITY_FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? t("common.all") : t(`history.entity.${f}`)}
              </option>
            ))}
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("history.filterAccount")}>
            <option value="">{t("history.allAccounts")}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        {entries.length === 0 ? <EmptyState>{t("history.empty")}</EmptyState> : null}
        <ul className="divide-y divide-[var(--edge-soft)]" data-history-list>
          {entries.slice(0, shown).map((e) => (
            <li key={e.id} className="py-2">
              <ChangeLine entry={e} />
            </li>
          ))}
        </ul>
        {entries.length > shown ? (
          <button type="button" className="text-xs text-teal-600 hover:underline" onClick={() => setShown((n) => n + 100)}>
            {t("history.showMore")}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
