"use client";

import { Fragment, ReactNode, useCallback, useId, useMemo } from "react";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { Account, Category, Transaction } from "@/lib/data/types";
import { buildCardBook, CardBook } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { UsdPerMap } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { dayLabel, relativeDue } from "@/lib/ui/pocket/dates";
import { DayGroup, MonthGroup, monthLabel, transferCounterparts } from "@/lib/ui/pocket/dayGroups";
import { formatSigned, MoneySign } from "@/lib/ui/pocket/format";
import { Icon } from "./icons";
import { Approx, Avatar, Money } from "./kit";
import { SwipeableRow } from "./rowSwipe";

/**
 * The ledger as a Pocket list: month separators, sticky day headers, and one
 * row per entry. Group the rows with lib/ui/pocket/dayGroups.ts first.
 *
 *   const lookup = useTxLookup();
 *   const months = groupMonthsDays(listedRows(txs, lookup.book), { …, book: lookup.book });
 *   const sheet = usePocketTxSheet();                    // components/pocket/txActions.tsx
 *   <PocketDayList months={months} onRowTap={sheet.open} onComplete={sheet.complete} />
 *   {sheet.element}
 *
 * Exports
 * - PocketDayList({ months, onRowTap, onComplete?, stickyHeaders?, inCard?, accountCurrency?, selection? })
 *   - each month: a 48px MonthSeparator (h2, not sticky) with its net;
 *   - each day: a <section aria-labelledby> whose DayHeader is an h3 ("Today ·
 *     3" and the day's net), sticky under the Pocket header unless
 *     stickyHeaders is false;
 *   - inCard: the list sits inside a host card (Home's recent activity): no
 *     month separators, plain rows, headers that don't stick;
 *   - accountCurrency: the months were grouped with an accountId, so nets are
 *     in that currency and rows read as that account's history;
 *   - selection: selection mode (Activity's bulk actions): a tap chooses the
 *     row instead of opening its sheet, and the ✓ steps aside.
 * - PocketTxRow({ tx, lookup, onTap, onComplete?, accountScoped?, due?, selection? }):
 *   one button for the row and, on a planned row given onComplete, a 44px ✓
 *   beside it. In selection mode the button toggles the row (aria-pressed), a
 *   check circle takes the avatar's place and there's no ✓. Outside selection
 *   mode the row swipes (components/pocket/rowSwipe.tsx): right marks a
 *   planned row paid by the ✓'s path, left opens its sheet. Renders nothing
 *   when the row's account is unknown.
 * - CompleteCheck({ name, ready, onClick }): that ✓, for any planned row
 *   (Home's Coming up), disabled with a reason until rates arrive.
 * - MonthSeparator, DayHeader: the two headings, for lists built by hand.
 * - useTxLookup(): what a row needs to draw itself, from the shared queries.
 * - describeTx(tx, lookup, t): a row's title, accounts and kind.
 * - useDueLabel(): "Today", "Tomorrow", "in 3 days", "2 days late" (core's
 *   relativeDue, worded). Day headers use core's dayLabel (dates.ts).
 */

/** Selection mode: which rows are chosen, and choosing one. */
export interface RowSelection {
  has: (id: string) => boolean;
  toggle: (tx: Transaction) => void;
}

export interface TxLookup {
  accountsById: ReadonlyMap<string, Account>;
  categoriesById: ReadonlyMap<string, Category>;
  book: CardBook;
  /** the other leg of a transfer: the landing leg for the leaving one, and back */
  counterpartOf: (tx: Transaction) => Transaction | undefined;
  /** today's rates, when they've arrived */
  usdPer: UsdPerMap | undefined;
  display: Currency;
  /** rates are in, so Mark paid can snapshot them */
  ratesReady: boolean;
  today: string;
  /** accounts, categories or transactions are still loading */
  loading: boolean;
}

export function useTxLookup(): TxLookup {
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const rates = useRates();
  const today = todayISO();
  const usdPer = rates.data?.usdPer;
  const ratesReady = rates.data != null;
  const loading = accounts.isLoading || categories.isLoading || transactions.isLoading;
  return useMemo(() => {
    const txs = transactions.data ?? [];
    const accountList = accounts.data ?? [];
    const landing = transferCounterparts(txs);
    const leaving = new Map<string, Transaction>();
    for (const tx of txs) if (tx.transferGroupId && tx.direction === "expense") leaving.set(tx.transferGroupId, tx);
    return {
      accountsById: new Map(accountList.map((a) => [a.id, a])),
      categoriesById: new Map((categories.data ?? []).map((c) => [c.id, c])),
      book: buildCardBook(accountList, txs),
      counterpartOf: (tx: Transaction) =>
        tx.transferGroupId ? (tx.direction === "income" ? leaving : landing).get(tx.transferGroupId) : undefined,
      usdPer,
      display: displayCurrency,
      ratesReady,
      today,
      loading,
    };
  }, [accounts.data, categories.data, transactions.data, usdPer, displayCurrency, ratesReady, today, loading]);
}

export interface TxDescription {
  /** description, else category, else what kind of move it is */
  title: string;
  account: Account;
  category?: Category;
  /** a move between two accounts: where it left and where it landed */
  route?: { from: Account; to: Account };
  /** the other leg of a transfer, and its account */
  other?: Transaction;
  otherAccount?: Account;
  /** between your own accounts, no card being paid */
  transfer: boolean;
  /** a payment into a card (either leg) */
  cardPayment: boolean;
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** Null when the row's account is unknown: such a row isn't shown. */
export function describeTx(tx: Transaction, lookup: TxLookup, t: T): TxDescription | null {
  const account = lookup.accountsById.get(tx.accountId);
  if (!account) return null;
  const category = tx.categoryId ? lookup.categoriesById.get(tx.categoryId) : undefined;
  const role = lookup.book.roleOf(tx);
  const cardPayment = role === "payment" || role === "cardSide";
  const transfer = tx.transferGroupId != null && !cardPayment;
  const other = lookup.counterpartOf(tx);
  const otherAccount = other ? lookup.accountsById.get(other.accountId) : undefined;
  const route = otherAccount
    ? tx.direction === "expense"
      ? { from: account, to: otherAccount }
      : { from: otherAccount, to: account }
    : undefined;
  const title =
    tx.description || category?.name || (cardPayment ? t("tx.cardPayment") : transfer ? t("tx.transfer") : "—");
  return { title, account, category, route, other, otherAccount, transfer, cardPayment };
}

/** When a planned row is due, from today: "Today", "Tomorrow", "in 3 days", "1 day late", "2 days late". */
export function useDueLabel(): (date: string, today?: string) => { text: string; late: boolean } {
  const { t } = useI18n();
  return useCallback(
    (date: string, today = todayISO()) => {
      const { key, count } = relativeDue(date, today);
      switch (key) {
        case "today":
          return { text: t("common.today"), late: false };
        case "tomorrow":
          return { text: t("pocket.lists.tomorrow"), late: false };
        case "inDays":
          return { text: t("pocket.lists.inDays", { count }), late: false };
        default:
          // a due date a day behind is late, not "yesterday"
          return { text: count === 1 ? t("pocket.lists.lateOne") : t("pocket.lists.lateMany", { count }), late: true };
      }
    },
    [t]
  );
}

/** The 44px ✓ that marks a planned row paid; disabled with the reason until rates arrive. */
export function CompleteCheck({ name, ready, onClick }: { name: string; ready: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const label = t("pocket.lists.markPaidRow", { name });
  const waiting = t("pocket.lists.waitingRates");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!ready}
      aria-label={ready ? label : `${label}. ${waiting}`}
      title={ready ? undefined : waiting}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] disabled:text-zinc-300 dark:text-teal-400 dark:disabled:text-zinc-600"
    >
      <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-current">
        <Icon name="check" size={16} />
      </span>
    </button>
  );
}

/** The figure beside a heading: "+" when positive, nothing when zero. */
function Net({ amount, currency, className = "" }: { amount: number; currency: Currency; className?: string }) {
  if (Math.abs(amount) < 0.005) return null;
  return <Money amount={amount} currency={currency} sign={amount > 0 ? "in" : "auto"} tone="auto" className={className} />;
}

/** "October 2026" and the month's net: 48px, not sticky. */
export function MonthSeparator({ month, net, currency }: { month: string; net: number; currency: Currency }) {
  const { locale } = useI18n();
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <h2 className="min-w-0 truncate text-[15px] font-bold">{monthLabel(month, locale)}</h2>
      <Net amount={net} currency={currency} className="text-sm font-semibold" />
    </div>
  );
}

/** A day's heading (an h3, labelling its section): "Today · 3" and the day's net. */
export function DayHeader({
  id,
  day,
  currency,
  today,
  sticky = true,
  inset = false,
}: {
  id: string;
  day: Pick<DayGroup, "date" | "count" | "net">;
  currency: Currency;
  today: string;
  sticky?: boolean;
  /** inside a host card: line up with the rows' padding */
  inset?: boolean;
}) {
  const { t, locale } = useI18n();
  const label = dayLabel(day.date, today, locale, {
    today: t("common.today"),
    yesterday: t("pocket.lists.yesterday"),
    tomorrow: t("pocket.lists.tomorrow"),
  });
  const entries = day.count === 1 ? t("pocket.lists.entriesOne") : t("pocket.lists.entriesMany", { count: day.count });
  return (
    <div
      className={`flex h-8 items-center justify-between gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 ${
        sticky
          ? "sticky top-[var(--pocket-top,44px)] z-10 -mx-4 bg-[var(--page)]/95 px-4 backdrop-blur"
          : inset
            ? "px-4"
            : ""
      }`}
    >
      <h3 id={id} className="min-w-0 truncate">
        {label}
        <span aria-hidden> · {day.count}</span>
        <span className="sr-only">, {entries}</span>
      </h3>
      <Net amount={day.net} currency={currency} />
    </div>
  );
}

export interface PocketDayListProps {
  months: MonthGroup[];
  /** a tap on a row's body: open its action sheet */
  onRowTap: (tx: Transaction) => void;
  /** the ✓ on a planned row; without it, planned rows have no ✓ */
  onComplete?: (tx: Transaction) => void;
  /** day headers stick under the Pocket header (default true) */
  stickyHeaders?: boolean;
  /** inside a host card: no month separators, plain rows, headers that don't stick */
  inCard?: boolean;
  /** the months were grouped for one account: nets are in its currency */
  accountCurrency?: Currency;
  /** selection mode: a tap chooses the row */
  selection?: RowSelection;
}

export function PocketDayList({
  months,
  onRowTap,
  onComplete,
  stickyHeaders = true,
  inCard = false,
  accountCurrency,
  selection,
}: PocketDayListProps) {
  const lookup = useTxLookup();
  const currency = accountCurrency ?? lookup.display;
  return (
    <div className={inCard ? "divide-y divide-[var(--edge-soft)]" : "space-y-2"}>
      {months.map((month) => (
        <div key={month.month} className={inCard ? "divide-y divide-[var(--edge-soft)]" : "space-y-3"}>
          {inCard ? null : <MonthSeparator month={month.month} net={month.net} currency={currency} />}
          {month.days.map((day) => (
            <DaySection
              key={day.date}
              day={day}
              lookup={lookup}
              currency={currency}
              sticky={stickyHeaders && !inCard}
              inCard={inCard}
              accountScoped={accountCurrency != null}
              onRowTap={onRowTap}
              onComplete={onComplete}
              selection={selection}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DaySection({
  day,
  lookup,
  currency,
  sticky,
  inCard,
  accountScoped,
  onRowTap,
  onComplete,
  selection,
}: {
  day: DayGroup;
  lookup: TxLookup;
  currency: Currency;
  sticky: boolean;
  inCard: boolean;
  accountScoped: boolean;
  onRowTap: (tx: Transaction) => void;
  onComplete?: (tx: Transaction) => void;
  selection?: RowSelection;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={inCard ? "pt-1" : undefined}>
      <DayHeader id={id} day={day} currency={currency} today={lookup.today} sticky={sticky} inset={inCard} />
      <ul
        className={
          inCard
            ? "divide-y divide-[var(--edge-soft)]"
            : "divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]"
        }
      >
        {day.rows.map((tx) => (
          <PocketTxRow
            key={tx.id}
            tx={tx}
            lookup={lookup}
            onTap={onRowTap}
            onComplete={onComplete}
            accountScoped={accountScoped}
            selection={selection}
          />
        ))}
      </ul>
    </section>
  );
}

/** Selection mode's check circle, in the avatar's place; decorative (the row says aria-pressed). */
function SelectCircle({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden className="flex h-9 w-9 items-center justify-center">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
          selected
            ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-zinc-950"
            : "border-zinc-300 dark:border-zinc-600"
        }`}
      >
        {selected ? <Icon name="check" size={14} /> : null}
      </span>
    </span>
  );
}

/** A transfer's or card payment's glyph, tinted like the category avatars. */
function MoveAvatar({ card }: { card: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 items-center justify-center rounded-full ${
        card
          ? "bg-[var(--edge-soft)] text-zinc-600 dark:text-zinc-300"
          : "bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400"
      }`}
    >
      <Icon name={card ? "card" : "transfer"} size={18} />
    </span>
  );
}

export function PocketTxRow({
  tx,
  lookup,
  onTap,
  onComplete,
  accountScoped = false,
  due = false,
  selection,
}: {
  tx: Transaction;
  lookup: TxLookup;
  onTap: (tx: Transaction) => void;
  /** the ✓ on a planned row */
  onComplete?: (tx: Transaction) => void;
  /** one account's history: the account name is left out, transfer legs are signed */
  accountScoped?: boolean;
  /** lists without day headers: the second line starts with when it's due ("2 days late"), in place of "Planned" */
  due?: boolean;
  /** selection mode: a tap chooses the row */
  selection?: RowSelection;
}) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const d = describeTx(tx, lookup, t);
  if (!d) return null;

  const planned = tx.status === "planned";
  const when = due && planned ? dueLabel(tx.dueDate, lookup.today) : null;
  // a due row says when, then the account only (Home's Coming up)
  const place = d.route
    ? `${d.route.from.name} → ${d.route.to.name}`
    : accountScoped
      ? (d.category?.name ?? "")
      : when
        ? d.account.name
        : [d.account.name, d.category?.name].filter(Boolean).join(" · ");

  // a transfer between your own accounts isn't money in or out, unless the
  // list is one account's, where each leg is
  const sign: MoneySign = d.transfer && !accountScoped ? "none" : tx.direction === "income" ? "in" : "out";
  const cross = d.other && d.otherAccount && d.otherAccount.currency !== d.account.currency ? d.other : null;
  const selected = selection ? selection.has(tx.id) : false;
  // a card's instalment is paid by the card payment that covers it, never ticked by hand
  const showCheck = !selection && planned && onComplete != null && lookup.book.roleOf(tx) !== "charge";

  const parts: Array<{ key: string; node: ReactNode; shrink?: boolean }> = [];
  if (when) {
    parts.push({
      key: "when",
      node: <span className={when.late ? "text-red-600 dark:text-red-400" : ""}>{when.text}</span>,
    });
  }
  if (place) parts.push({ key: "place", node: place, shrink: true });
  // "2 days late" already says it's planned, and the line is short beside the ✓
  if (planned && !when) {
    parts.push({ key: "planned", node: <span className="text-amber-600 dark:text-amber-400">{t("tx.planned")}</span> });
  }
  if (tx.legacy) parts.push({ key: "legacy", node: t("legacy.badge") });

  return (
    <SwipeableRow
      className={tx.legacy ? "opacity-60" : ""}
      swipe={
        selection
          ? null
          : {
              // the ✓'s own path (Undo included); none while it can't be ticked
              right: showCheck && lookup.ratesReady ? () => onComplete(tx) : undefined,
              left: () => onTap(tx),
            }
      }
    >
      <button
        type="button"
        onClick={() => (selection ? selection.toggle(tx) : onTap(tx))}
        aria-pressed={selection ? selected : undefined}
        data-selected={selected ? "" : undefined}
        className={`flex min-h-[var(--pocket-row-tx,60px)] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left ${
          showCheck ? "pr-1" : "pr-4"
        } ${selected ? "bg-teal-50 shadow-[inset_4px_0_0_var(--color-teal-600)] dark:bg-teal-950" : "active:bg-[var(--edge-soft)]"}`}
      >
        <span className="shrink-0">
          {selection ? (
            <SelectCircle selected={selected} />
          ) : d.transfer || d.cardPayment ? (
            <MoveAvatar card={d.cardPayment} />
          ) : (
            <Avatar color={d.category?.color} label={d.category?.name ?? d.title} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{d.title}</span>
          <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
            {parts.map((part, i) => (
              <Fragment key={part.key}>
                {/* the dot stays whole when the part after it is squeezed */}
                {i > 0 ? <span aria-hidden className="shrink-0">·</span> : null}
                <span className={part.shrink ? "min-w-0 truncate" : "shrink-0"}>{part.node}</span>
              </Fragment>
            ))}
            {tx.adjustment ? (
              <span className="shrink-0 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium leading-4 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                {t("adjust.badge")}
              </span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money
            amount={tx.amount}
            currency={d.account.currency}
            sign={sign}
            tone={d.transfer ? undefined : "auto"}
            className={`block text-[15px] font-semibold ${d.transfer ? "text-zinc-500 dark:text-zinc-400" : ""}`}
          />
          {cross && d.otherAccount ? (
            <span data-amount className="block whitespace-nowrap text-[11px] tabular-nums text-zinc-400">
              {tx.direction === "expense" ? "→" : "←"} {formatSigned(cross.amount, d.otherAccount.currency, locale, "none")}
            </span>
          ) : (
            <Approx
              amount={tx.amount}
              from={d.account.currency}
              to={lookup.display}
              usdPer={tx.fxSnapshot?.usdPer ?? lookup.usdPer}
            />
          )}
        </span>
      </button>
      {showCheck ? (
        <span className="pr-1">
          <CompleteCheck name={d.title} ready={lookup.ratesReady} onClick={() => onComplete(tx)} />
        </span>
      ) : null}
    </SwipeableRow>
  );
}
