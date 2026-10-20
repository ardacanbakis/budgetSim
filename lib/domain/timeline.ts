import { Account, Loan, Purchase, RecurringTemplate, Transaction } from "@/lib/data/types";
import { computeBalances } from "./balances";
import { CardBook, chargeAmount, paymentDateIn } from "./cards";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { GoldRatios } from "./gold";
import { buildSchedule } from "./loanSchedule";
import { fromMinor, roundTo, toMinor } from "./money";
import { buildInstallmentPlan, lastDueDate } from "./purchases";
import { addDays } from "./recurrence";
import { templateProgress } from "./templateStatus";

/**
 * The money timeline: what happened and what is planned, as one list of
 * events on one axis, and what each cash account holds day by day.
 *
 * Every event says where it is drawn (`date`) and when it moves money
 * (`effectiveDate`), and carries its `legs`: what it does to each cash
 * account, in that account's own currency. Cards have no legs: what is spent
 * on a card counts when the card is paid (lib/domain/cards.ts).
 *
 * - ledgerEvents: the rows a ledger lists (not a card's charges, not a
 *   payment's landing on a card), a transfer once, as the leg that leaves,
 *   with both legs. A planned row past its date is overdue and takes effect
 *   today; a row completed before its date took effect today too, since
 *   that is when the balance moved. Legacy rows are listed but have no legs,
 *   so they never move a balance.
 * - statementEvents: each card's charges no payment covers yet, by the month
 *   they're paid in (book.paidInMonth), dated on the card's payment day.
 *   Months already behind fold into this month's entry, which is overdue
 *   once its payment day has passed. A planned payment row already covers
 *   the charges before its month, so it is never counted twice: the charges
 *   leave the statement and the payment row is the outflow. The leg is on
 *   the card's paying account, converted at today's rates when the two
 *   currencies differ (and marked approx).
 * - debtMilestones: when a loan's last instalment, a taksit or a recurring
 *   item with an end date finishes, and what that frees each month. Markers
 *   only, no legs.
 * - buildTimeline: all three, sorted the way comingUp sorts (date, overdue
 *   first, kind, then createdAt and id).
 *
 * Balances, per cash account in its own currency (balanceSeries):
 * anchored on computeBalances (completed, non-legacy rows), walked back
 * through completed events and forward through planned and overdue ones.
 * lowestAhead reads the lowest point from today to a horizon.
 */

export type TimelineKind = "tx" | "statement" | "milestone";
export type TimelineStatus = "completed" | "planned" | "overdue" | "marker";

export interface TimelineLeg {
  accountId: string;
  /** signed, in that account's currency */
  delta: number;
  /** converted at today's rates */
  approx?: boolean;
}

export interface TimelineMilestone {
  what: "loan" | "purchase" | "template";
  /** the loan, purchase or template */
  id: string;
  name: string;
  /** what stops leaving (or arriving) each period once it ends; null when unknown */
  frees: number | null;
  currency: Currency | null;
  direction: "income" | "expense";
  frequency: RecurringTemplate["frequency"];
  /** instalments in all, when counted */
  count: number | null;
}

export interface TimelineEvent {
  /** tx.id | `stmt:${cardId}:${month}` | `end:${what}:${id}` */
  key: string;
  kind: TimelineKind;
  status: TimelineStatus;
  /** where it is drawn (yyyy-mm-dd) */
  date: string;
  /** when it moves money: today for an overdue row or one completed early */
  effectiveDate: string;
  legs: TimelineLeg[];
  /** the account it is shown on: the row's, a statement's card */
  accountId: string | null;
  /** positive, in `currency` */
  amount: number;
  currency: Currency | null;
  /** a transfer between your own accounts is "none" */
  direction: "income" | "expense" | "none";
  tx?: Transaction;
  /** a statement: the card and the charges it covers */
  cardId?: string;
  charges?: Transaction[];
  legacy?: boolean;
  /** a statement on a card with no payment day: dated the 1st (or today) */
  dateApprox?: boolean;
  /** completed with its date still ahead */
  early?: boolean;
  milestone?: TimelineMilestone;
}

const KIND_RANK: Record<TimelineKind, number> = { tx: 0, statement: 1, milestone: 2 };

export function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ao = a.status === "overdue";
  if (ao !== (b.status === "overdue")) return ao ? -1 : 1;
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  const ac = a.tx?.createdAt ?? "";
  const bc = b.tx?.createdAt ?? "";
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function statusOf(tx: Transaction, today: string): TimelineStatus {
  if (tx.status === "completed") return "completed";
  return tx.dueDate < today ? "overdue" : "planned";
}

function effectiveOf(tx: Transaction, today: string): string {
  // overdue: it still has to happen, so today at the earliest; completed
  // early: the money moved when it was ticked, which is today at the latest
  if (tx.status === "planned") return tx.dueDate < today ? today : tx.dueDate;
  return tx.dueDate > today ? today : tx.dueDate;
}

/** A row's leg, or none when it is history, on a card, or on an unknown account. */
function legOf(tx: Transaction, book: CardBook, accountsById: ReadonlyMap<string, Account>): TimelineLeg[] {
  if (tx.legacy || book.isCard(tx.accountId) || !accountsById.has(tx.accountId)) return [];
  return [{ accountId: tx.accountId, delta: tx.direction === "income" ? tx.amount : -tx.amount }];
}

export function ledgerEvents(
  transactions: readonly Transaction[],
  book: CardBook,
  accountsById: ReadonlyMap<string, Account>,
  today: string
): TimelineEvent[] {
  // a transfer's legs by group, so the leg that leaves can carry the other
  const legsByGroup = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.transferGroupId) continue;
    const legs = legsByGroup.get(tx.transferGroupId);
    if (legs) legs.push(tx);
    else legsByGroup.set(tx.transferGroupId, [tx]);
  }

  const events: TimelineEvent[] = [];
  for (const tx of transactions) {
    const role = book.roleOf(tx);
    if (role === "charge" || role === "cardSide") continue;
    const account = accountsById.get(tx.accountId);
    if (!account) continue;
    const group = tx.transferGroupId ? (legsByGroup.get(tx.transferGroupId) ?? []) : [];
    // shown once, as the leg that leaves; a landing leg with nothing leaving stands alone
    if (tx.transferGroupId && tx.direction === "income" && group.some((l) => l.direction === "expense")) continue;
    const legs = legOf(tx, book, accountsById);
    if (role === "transfer" && tx.direction === "expense") {
      for (const other of group) if (other.id !== tx.id) legs.push(...legOf(other, book, accountsById));
    }
    events.push({
      key: tx.id,
      kind: "tx",
      status: statusOf(tx, today),
      date: tx.dueDate,
      effectiveDate: effectiveOf(tx, today),
      legs,
      accountId: tx.accountId,
      amount: tx.amount,
      currency: account.currency,
      direction: role === "transfer" ? "none" : role === "payment" ? "expense" : tx.direction,
      tx,
      legacy: tx.legacy || undefined,
      early: tx.status === "completed" && tx.dueDate > today ? true : undefined,
    });
  }
  return events;
}

export function statementEvents(
  book: CardBook,
  accounts: readonly Account[],
  today: string,
  toMonth: string,
  usdPer?: UsdPerMap | null
): TimelineEvent[] {
  const thisMonth = today.slice(0, 7);
  const accountsById = new Map(accounts.map((a) => [a.id, a] as const));
  const events: TimelineEvent[] = [];
  for (const card of accounts) {
    if (card.kind !== "credit_card" || card.archived) continue;
    const byMonth = new Map<string, Transaction[]>();
    for (const c of book.uncovered(card.id)) {
      // a statement already behind is still to pay: it folds into this month's
      const month = book.paidInMonth(c) < thisMonth ? thisMonth : book.paidInMonth(c);
      if (month > toMonth) continue;
      const list = byMonth.get(month);
      if (list) list.push(c);
      else byMonth.set(month, [c]);
    }
    const payer = card.paymentAccountId ? accountsById.get(card.paymentAccountId) : undefined;
    for (const [month, charges] of byMonth) {
      let minor = 0;
      for (const c of charges) minor += toMinor(chargeAmount(c), card.currency);
      const total = fromMinor(minor, card.currency);
      // nothing to pay, or a refund the card owes back
      if (total <= 0.005) continue;
      const day = paymentDateIn(month, card.paymentDay);
      const date = day ?? (month === thisMonth ? today : `${month}-01`);
      const legs: TimelineLeg[] = [];
      if (payer && !payer.archived && payer.kind !== "credit_card") {
        if (payer.currency === card.currency) legs.push({ accountId: payer.id, delta: -total });
        else {
          const converted = usdPer ? convert(total, card.currency, payer.currency, usdPer) : null;
          if (converted != null) legs.push({ accountId: payer.id, delta: -roundTo(converted, payer.currency), approx: true });
        }
      }
      events.push({
        key: `stmt:${card.id}:${month}`,
        kind: "statement",
        status: date < today ? "overdue" : "planned",
        date,
        effectiveDate: date < today ? today : date,
        legs,
        accountId: card.id,
        amount: total,
        currency: card.currency,
        direction: "expense",
        cardId: card.id,
        charges,
        dateApprox: day == null ? true : undefined,
      });
    }
  }
  return events;
}

export function debtMilestones(params: {
  loans: readonly Loan[];
  purchases: readonly Purchase[];
  templates: readonly RecurringTemplate[];
  transactions: Transaction[];
  accounts: readonly Account[];
  today: string;
}): TimelineEvent[] {
  const { loans, purchases, templates, transactions, accounts, today } = params;
  const accountsById = new Map(accounts.map((a) => [a.id, a] as const));
  const events: TimelineEvent[] = [];
  const marker = (date: string, milestone: TimelineMilestone, accountId: string | null): TimelineEvent => ({
    key: `end:${milestone.what}:${milestone.id}`,
    kind: "milestone",
    status: "marker",
    date,
    effectiveDate: date,
    legs: [],
    accountId,
    amount: milestone.frees ?? 0,
    currency: milestone.currency,
    direction: "none",
    milestone,
  });

  const tracked = new Set<string>();
  for (const loan of loans) {
    const schedule = buildSchedule({
      kind: loan.scheduleKind,
      principal: loan.principal,
      monthlyRatePct: loan.monthlyRatePct,
      termMonths: loan.termMonths,
      startDate: loan.startDate,
      currency: loan.currency,
      kkdfPct: loan.kkdfPct,
      bsmvPct: loan.bsmvPct,
      customInstalments: loan.customInstalments ?? undefined,
    });
    const last = schedule.rows.at(-1);
    if (!last) continue;
    tracked.add(loan.id);
    const template = loan.recurringTemplateId ? templates.find((t) => t.id === loan.recurringTemplateId) : undefined;
    events.push(
      marker(
        last.date,
        {
          what: "loan",
          id: loan.id,
          name: loan.name,
          frees: last.payment,
          currency: loan.currency,
          direction: "expense",
          frequency: "monthly",
          count: schedule.rows.length,
        },
        template?.accountId ?? null
      )
    );
  }

  for (const p of purchases) {
    if (p.installmentCount <= 1) continue;
    const account = p.accountId ? accountsById.get(p.accountId) : undefined;
    const plan = account
      ? buildInstallmentPlan({ amount: p.amount, currency: account.currency, count: p.installmentCount, firstDue: p.firstDue })
      : [];
    events.push(
      marker(
        lastDueDate(p.firstDue, p.installmentCount),
        {
          what: "purchase",
          id: p.id,
          name: p.name,
          frees: plan.at(-1)?.amount ?? null,
          currency: account?.currency ?? null,
          direction: "expense",
          frequency: "monthly",
          count: p.installmentCount,
        },
        account?.id ?? null
      )
    );
  }

  for (const template of templates) {
    // a tracked loan's instalments end with the loan's own marker
    if (!template.endDate || (template.loanId && tracked.has(template.loanId))) continue;
    const progress = templateProgress(template, transactions, today);
    if (!progress.last) continue;
    const account = accountsById.get(template.accountId);
    events.push(
      marker(
        progress.last,
        {
          what: "template",
          id: template.id,
          name: template.name,
          frees: template.amount,
          currency: account?.currency ?? null,
          direction: template.direction,
          frequency: template.frequency,
          count: progress.total,
        },
        account?.id ?? null
      )
    );
  }
  return events;
}

export interface TimelineInput {
  accounts: Account[];
  transactions: Transaction[];
  templates?: RecurringTemplate[];
  loans?: Loan[];
  purchases?: Purchase[];
  /** pass useTxLookup().book, so one book serves every screen */
  book: CardBook;
  /** only for a statement paid from an account in another currency */
  usdPer?: UsdPerMap | null;
}

/**
 * Every event from `from` (or the beginning) to `to`, sorted. Overdue rows
 * and statements are kept whatever their date: they still have to happen.
 */
export function buildTimeline(input: TimelineInput, o: { from?: string; to: string; today: string }): TimelineEvent[] {
  const { accounts, transactions, book } = input;
  const accountsById = new Map(accounts.map((a) => [a.id, a] as const));
  const inWindow = (e: TimelineEvent) =>
    e.date <= o.to && (e.status === "overdue" || o.from == null || e.date >= o.from);
  const events = [
    ...ledgerEvents(transactions, book, accountsById, o.today),
    ...statementEvents(book, accounts, o.today, o.to.slice(0, 7), input.usdPer),
    ...debtMilestones({
      loans: input.loans ?? [],
      purchases: input.purchases ?? [],
      templates: input.templates ?? [],
      transactions,
      accounts,
      today: o.today,
    }),
  ].filter(inWindow);
  return events.sort(compareEvents);
}

/* -------------------------------------------------------------- balances */

export interface BalancePoint {
  date: string;
  /** at the end of that day */
  balance: number;
}

export interface AccountSeries {
  account: Account;
  /** today's balance: computeBalances, completed and non-legacy rows */
  now: number;
  /**
   * End-of-day balances on each day the balance changes, oldest first. The
   * first point is the day before the first completed movement (what the
   * account opened with); there is always a point today.
   */
  points: BalancePoint[];
  /** a step was converted at today's rates */
  approx: boolean;
}

/** Whether a not-yet-real event counts in the balances; planned and overdue always do. */
export type CountsInBalance = (event: TimelineEvent) => boolean;

/**
 * Per cash account (not a card, not archived), in its own currency. `events`
 * should be the whole timeline (buildTimeline with no `from`), or the walk
 * back from today lands in the wrong place.
 */
export function balanceSeries(params: {
  accounts: readonly Account[];
  transactions: Transaction[];
  events: readonly TimelineEvent[];
  today: string;
  /** points after this are left out */
  to?: string;
  goldRatios?: GoldRatios;
  /** for kinds of event that only count when asked (expected income) */
  counts?: CountsInBalance;
}): Map<string, AccountSeries> {
  const { accounts, transactions, events, today, to, goldRatios, counts } = params;
  const balances = computeBalances([...accounts], transactions, goldRatios);
  const cash = accounts.filter((a) => a.kind !== "credit_card" && !a.archived);

  // minor units per account and day: done (≤ today) and to come (≥ today)
  const done = new Map<string, Map<string, number>>();
  const coming = new Map<string, Map<string, number>>();
  const approx = new Set<string>();
  const currencyOf = new Map(cash.map((a) => [a.id, a.currency] as const));
  const add = (into: Map<string, Map<string, number>>, accountId: string, date: string, minor: number) => {
    let days = into.get(accountId);
    if (!days) into.set(accountId, (days = new Map()));
    days.set(date, (days.get(date) ?? 0) + minor);
  };
  for (const e of events) {
    if (e.legs.length === 0 || e.status === "marker") continue;
    const real = e.status === "completed" || e.status === "planned" || e.status === "overdue";
    if (!real && !(counts?.(e) ?? false)) continue;
    for (const leg of e.legs) {
      const currency = currencyOf.get(leg.accountId);
      if (!currency) continue;
      if (leg.approx) approx.add(leg.accountId);
      add(e.status === "completed" ? done : coming, leg.accountId, e.effectiveDate, toMinor(leg.delta, currency));
    }
  }

  const result = new Map<string, AccountSeries>();
  for (const account of cash) {
    const now = balances.get(account.id) ?? 0;
    const at = (offsetMinor: number) =>
      offsetMinor === 0 ? now : roundTo(now + fromMinor(offsetMinor, account.currency), account.currency);
    const past = [...(done.get(account.id) ?? new Map<string, number>()).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const ahead = [...(coming.get(account.id) ?? new Map<string, number>()).entries()].sort(([a], [b]) => (a < b ? -1 : 1));

    const points: BalancePoint[] = [];
    // back from today: before each completed day, take that day's movement off
    let offset = 0;
    for (const [, minor] of past) offset -= minor;
    if (past.length > 0) points.push({ date: addDays(past[0][0], -1), balance: at(offset) });
    for (const [date, minor] of past) {
      offset += minor;
      // today's own point comes with what is due today, below
      if (date < today) points.push({ date, balance: at(offset) });
    }
    // offset is 0 again here: the completed rows are what `now` counts
    for (const [date, minor] of ahead) {
      if (date === today) offset += minor;
    }
    points.push({ date: today, balance: at(offset) });
    for (const [date, minor] of ahead) {
      if (date <= today) continue;
      if (to != null && date > to) break;
      offset += minor;
      points.push({ date, balance: at(offset) });
    }
    result.set(account.id, { account, now, points, approx: approx.has(account.id) });
  }
  return result;
}

/** The balance at the end of `date`, or null before the series begins. */
export function balanceAt(points: readonly BalancePoint[], date: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found == null ? null : points[found].balance;
}

export interface LowPoint {
  /** the lowest end-of-day balance from today to the horizon */
  balance: number;
  /** the first day it gets there */
  date: string;
  /** the first day it is below zero, if it goes there */
  belowZeroOn: string | null;
}

export function lowestAhead(points: readonly BalancePoint[], today: string, to: string): LowPoint | null {
  let low: LowPoint | null = null;
  let below: string | null = null;
  for (const p of points) {
    if (p.date < today || p.date > to) continue;
    if (below == null && p.balance < -0.005) below = p.date;
    if (low == null || p.balance < low.balance - 0.005) low = { balance: p.balance, date: p.date, belowZeroOn: null };
  }
  return low ? { ...low, belowZeroOn: below } : null;
}
