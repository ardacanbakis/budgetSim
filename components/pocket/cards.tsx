"use client";

import { useSearchParams } from "next/navigation";
import { Fragment, ReactNode, Suspense, useEffect, useId, useMemo, useState } from "react";
import { AccountModal } from "@/app/(app)/accounts/page";
import { PurchaseModal } from "@/app/(app)/cards/page";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { EmptyState, Skeleton } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, usePurchases, useRates, useTransactions } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Account, Purchase, Transaction } from "@/lib/data/types";
import { buildCardBook, CardBook, cardSchedule, chargeAmount, paymentDateIn } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { snapshotFromTable, UsdPerMap } from "@/lib/domain/fx";
import { CardStanding, cardStandings, DueCardPayment, findDueCardPayments, purchaseProgress } from "@/lib/domain/purchases";
import { addDays, parseISODate, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { CARDS_TAB_KEY, useLocalChoice } from "@/lib/prefs";
import { statementFigure } from "@/lib/ui/pocket/attention";
import { daysBetween } from "@/lib/ui/pocket/dates";
import { dayDate } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { useDueLabel } from "./dayList";
import { Icon } from "./icons";
import { Approx, FitFigure, Money, PocketPage } from "./kit";
import { PocketActionSheet, PocketSheet } from "./sheet";

/**
 * Pocket's Cards (/cards): one tile per active credit card, and the big
 * purchases on them, under a Cards | Big purchases tablist kept in the same
 * device choice as the Classic page (CARDS_TAB_KEY).
 *
 * A card's tile, top to bottom:
 * - its name and a ⋯ menu (Edit; Retire when the card is idle);
 * - when the statement is due: "Due Oct 15 · in 5 days", amber within five
 *   days, red on the day or once it's late; "Paid this month ✓" once a
 *   payment for the month is made. A statement still unpaid after its
 *   day this month is late (as Home's Coming up says), not next month's;
 * - "This statement" and its figure (statementFigure: the Classic page's
 *   Record payment suggestion), with the ≈ line under it;
 * - "Total owed ₺90,220.30 · 5 months to go": CardBook.owed, and the months
 *   of cardSchedule still to come after this one;
 * - the limit bar when a limit is set: teal, amber from 80%, red when over;
 * - Record payment, which opens CardPaymentModal with exactly the Classic
 *   page's suggestion and covers (coversFor below);
 * - the months still to pay as chips, the last three payments, and a link to
 *   the card's big purchases.
 * Retired cards fold away at the bottom with "Bring back".
 *
 * A big purchase's row opens a sheet: Reflect on the account (a switch whose
 * warning shows in the sheet, never window.confirm) and Delete, armed by a
 * second tap; a reflected purchase then asks whether its transactions go too.
 *
 * ?add=purchase (the Add menu's Card purchase) opens PurchaseModal and clears
 * the parameter. Writes are the Classic page's: the same repo methods and
 * the same KEYS.
 */

const PURCHASE_KEYS = [KEYS.purchases, KEYS.transactions, KEYS.accounts];
const TABS = ["cards", "purchases"] as const;
type Tab = (typeof TABS)[number];

const cardClass =
  "overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm";
const primaryButton =
  "flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-[15px] font-semibold text-white active:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950 dark:active:bg-teal-400";
const secondaryButton =
  "flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--edge)] px-4 text-[15px] font-medium active:bg-[var(--edge-soft)] disabled:opacity-50";
const headStyle = {
  fontWeight: "var(--ui-head-weight)" as unknown as number,
  letterSpacing: "var(--ui-head-tracking)",
  textTransform: "var(--ui-head-transform)" as React.CSSProperties["textTransform"],
};

/**
 * A translated sentence with nodes in its {slots}: t(key) without params
 * keeps the placeholders, so a figure can be a <Money> (blurred with hidden
 * amounts) while the words around it stay text.
 */
function Template({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <Fragment key={i}>{values[part] ?? `{${part}}`}</Fragment> : part))}
    </>
  );
}

/** "Oct 15" / "15 Eki"; with the year, "Aug 17, 2025" / "17 Ağu 2025". */
function shortDate(iso: string, locale: string, withYear = false): string {
  const { y, m, d } = parseISODate(iso);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Nov", or "Jan 2027" outside this year. */
function chipMonth(month: string, thisYear: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    year: month.slice(0, 4) === thisYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * What the line under a card's name says:
 * - paid: a payment is recorded for this month and it has been made;
 * - a date: a payment recorded for this month but not made yet is due on its
 *   own date; a statement still unpaid after this month's payment day is late
 *   on that day (as Home's Coming up has it), not next month's; otherwise the
 *   next payment day (daysUntilPaymentDay, through the standing);
 * - nothing without a payment day.
 */
function dueStateOf(
  card: Account,
  standing: CardStanding,
  book: CardBook,
  due: boolean,
  today: string
): { paid: true } | { paid: false; date: string } | null {
  const thisMonth = today.slice(0, 7);
  const recorded = book.payments(card.id).filter((p) => p.date.slice(0, 7) === thisMonth);
  const pending = recorded.find((p) => !p.made);
  if (recorded.length > 0 && !pending) return { paid: true };
  if (pending) return { paid: false, date: pending.date };
  if (card.paymentDay == null || standing.daysToDue == null) return null;
  const thisMonths = paymentDateIn(thisMonth, card.paymentDay)!;
  if (due && thisMonths < today) return { paid: false, date: thisMonths };
  return { paid: false, date: addDays(today, standing.daysToDue) };
}

export function PocketCards() {
  // useSearchParams needs a Suspense boundary on a prerendered page
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <CardsScreen />
    </Suspense>
  );
}

function CardsSkeleton() {
  const { t } = useI18n();
  return (
    <PocketPage title={t("cards.title")}>
      <div aria-hidden className="h-11 animate-pulse rounded-full bg-[var(--edge-soft)]" />
      <TileSkeleton />
    </PocketPage>
  );
}

function TileSkeleton() {
  return (
    <div aria-hidden className={`${cardClass} space-y-4 p-4`}>
      <Skeleton rows={1} className="w-32" />
      <Skeleton rows={1} className="w-48" />
      <div className="h-10 w-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <Skeleton rows={2} />
      <div className="h-11 animate-pulse rounded-xl bg-[var(--edge-soft)]" />
    </div>
  );
}

function CardsScreen() {
  const { t } = useI18n();
  const params = useSearchParams();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const purchases = usePurchases();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const tab = useLocalChoice<Tab>(CARDS_TAB_KEY, TABS, "cards");
  const tabsId = useId();

  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [paying, setPaying] = useState<Account | null>(null);
  const [editingCard, setEditingCard] = useState<Account | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);
  const [menuFor, setMenuFor] = useState<Account | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [retiredOpen, setRetiredOpen] = useState(false);

  // ?add=purchase: open the form once, then take the parameter off the URL
  const addParam = params.get("add") === "purchase";
  const [seenAdd, setSeenAdd] = useState(false);
  if (addParam && !seenAdd) {
    setSeenAdd(true);
    setPurchaseOpen(true);
  } else if (!addParam && seenAdd) {
    setSeenAdd(false);
  }
  useEffect(() => {
    // the same page: the URL changes in place (lib/ui/shallowUrl.ts)
    if (addParam) replaceQuery("/cards");
  }, [addParam]);

  const updateAccount = useAppMutation(
    (v: { id: string; patch: Parameters<typeof repo.updateAccount>[1] }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts]
  );
  const setArchived = useAppMutation(
    (v: { id: string; archived: boolean }) => repo.updateAccount(v.id, { archived: v.archived }),
    [KEYS.accounts]
  );
  const createAccount = useAppMutation((input: NewAccount) => repo.createAccount(input), [KEYS.accounts]);
  const setReflected = useAppMutation(
    (v: { id: string; reflected: boolean }) =>
      repo.setPurchaseReflected(v.id, v.reflected, rates.data ? snapshotFromTable(rates.data) : null),
    PURCHASE_KEYS
  );
  const deletePurchase = useAppMutation(
    (v: { id: string; deleteTransactions: boolean }) => repo.deletePurchase(v.id, v.deleteTransactions),
    PURCHASE_KEYS
  );

  // what each card is owed and which payment covers what (lib/domain/cards.ts)
  const book = useMemo(
    () => buildCardBook(accounts.data ?? [], transactions.data ?? []),
    [accounts.data, transactions.data]
  );

  const action = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setPurchaseOpen(true)}
        aria-label={t("purchases.newPurchase")}
        aria-haspopup="dialog"
        className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
      >
        <Icon name="plus" size={22} />
      </button>
    ),
    [t]
  );

  const loading = purchases.isLoading || accounts.isLoading || transactions.isLoading;
  const accountList = accounts.data ?? [];
  const cards = accountList.filter((a) => a.kind === "credit_card" && !a.archived);
  const retired = accountList.filter((a) => a.kind === "credit_card" && a.archived);
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const standings = new Map(cardStandings(accountList, book, today).map((s) => [s.account.id, s]));
  const duePayments = findDueCardPayments(accountList, book, today);
  // what a payment recorded now would cover: charges from before this month no payment covers yet
  const coversFor = (cardId: string) => book.wouldCover(cardId, thisMonth);
  const purchaseList = purchases.data ?? [];
  const purchasesOn = (accountId: string) => purchaseList.filter((p) => p.accountId === accountId);
  const openPurchase = purchaseId ? (purchaseList.find((p) => p.id === purchaseId) ?? null) : null;
  const usdPer = rates.data?.usdPer;

  const tabButton = (id: Tab) => (
    <button
      key={id}
      id={`${tabsId}-${id}`}
      role="tab"
      type="button"
      aria-selected={tab.value === id}
      aria-controls={`${tabsId}-panel`}
      onClick={() => tab.setValue(id)}
      className={`min-h-[36px] flex-1 rounded-[var(--pocket-chip-radius,9999px)] px-3 text-[13px] font-medium transition-colors ${
        tab.value === id ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      {id === "cards" ? t("cards.tabCards") : t("cards.tabPurchases")}
    </button>
  );

  return (
    <PocketPage title={t("cards.title")} action={action}>
      <div role="tablist" aria-label={t("cards.title")} className="flex rounded-[var(--pocket-chip-radius,9999px)] bg-[var(--edge-soft)] p-1">
        {TABS.map(tabButton)}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab.value}`} className="space-y-4">
        {loading ? (
          <TileSkeleton />
        ) : tab.value === "cards" ? (
          <>
            {cards.length === 0 ? (
              <EmptyState
                action={
                  <button type="button" onClick={() => setCreatingCard(true)} className={secondaryButton}>
                    <Icon name="plus" size={18} />
                    {t("accounts.newAccount")}
                  </button>
                }
              >
                {t("cards.noneActive")}
              </EmptyState>
            ) : (
              cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  standing={standings.get(card.id)!}
                  book={book}
                  today={today}
                  duePayments={duePayments}
                  usdPer={usdPer}
                  display={displayCurrency}
                  bigPurchases={purchasesOn(card.id).length}
                  onPay={() => setPaying(card)}
                  onMenu={() => setMenuFor(card)}
                  onPurchases={() => {
                    tab.setValue("purchases");
                    window.scrollTo(0, 0);
                  }}
                />
              ))
            )}
            {retired.length > 0 ? (
              <Retired
                cards={retired}
                open={retiredOpen}
                onToggle={() => setRetiredOpen((v) => !v)}
                busy={setArchived.isPending}
                onBringBack={(card) => setArchived.mutate({ id: card.id, archived: false })}
              />
            ) : null}
          </>
        ) : (
          <BigPurchases
            cards={cards}
            accounts={accountList}
            purchases={purchaseList}
            book={book}
            transactions={transactions.data ?? []}
            usdPer={usdPer}
            display={displayCurrency}
            onOpen={(p) => setPurchaseId(p.id)}
            onNew={() => setPurchaseOpen(true)}
          />
        )}
      </div>

      <PocketActionSheet
        open={menuFor != null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name ?? ""}
        items={
          menuFor
            ? [
                {
                  label: t("common.edit"),
                  icon: "edit",
                  tone: "primary",
                  onSelect: () => {
                    const card = menuFor;
                    setMenuFor(null);
                    setEditingCard(card);
                  },
                },
                ...(standings.get(menuFor.id)?.idle
                  ? [
                      {
                        label: t("cards.markInactive"),
                        hint: t("cards.inactiveHint"),
                        icon: "eyeOff" as const,
                        onSelect: () => {
                          const card = menuFor;
                          setMenuFor(null);
                          setArchived.mutate(
                            { id: card.id, archived: true },
                            {
                              onSuccess: () =>
                                showSnack(`${card.name} · ${t("cards.inactive")}`, {
                                  label: t("pocket.undo"),
                                  run: () => setArchived.mutate({ id: card.id, archived: false }),
                                }),
                            }
                          );
                        },
                      },
                    ]
                  : []),
              ]
            : []
        }
      />

      <PurchaseSheet
        purchase={openPurchase}
        account={openPurchase ? accountList.find((a) => a.id === openPurchase.accountId) : undefined}
        book={book}
        transactions={transactions.data ?? []}
        onClose={() => setPurchaseId(null)}
        reflecting={setReflected.isPending}
        onReflect={(reflected) => openPurchase && setReflected.mutate({ id: openPurchase.id, reflected })}
        onDelete={(deleteTransactions) => {
          if (!openPurchase) return;
          const id = openPurchase.id;
          setPurchaseId(null);
          deletePurchase.mutate({ id, deleteTransactions }, { onSuccess: () => showSnack(t("pocket.lists.deleted")) });
        }}
      />

      <AccountModal
        open={editingCard != null || creatingCard}
        initial={editingCard}
        initialKind="credit_card"
        onClose={() => {
          setEditingCard(null);
          setCreatingCard(false);
        }}
        onSave={async (input) => {
          if (editingCard) await updateAccount.mutateAsync({ id: editingCard.id, patch: input });
          else await createAccount.mutateAsync(input);
          setEditingCard(null);
          setCreatingCard(false);
        }}
      />

      <PurchaseModal open={purchaseOpen} onClose={() => setPurchaseOpen(false)} />

      <CardPaymentModal
        card={paying}
        suggested={paying ? Math.max(0, coversFor(paying.id).reduce((sum, c) => sum + chargeAmount(c), 0)) : 0}
        covers={paying ? coversFor(paying.id) : []}
        onClose={() => setPaying(null)}
      />
    </PocketPage>
  );
}

/* ------------------------------------------------------------- card tile */

function CardTile({
  card,
  standing,
  book,
  today,
  duePayments,
  usdPer,
  display,
  bigPurchases,
  onPay,
  onMenu,
  onPurchases,
}: {
  card: Account;
  standing: CardStanding;
  book: CardBook;
  today: string;
  duePayments: readonly DueCardPayment[];
  usdPer: UsdPerMap | undefined;
  display: Currency;
  bigPurchases: number;
  onPay: () => void;
  onMenu: () => void;
  onPurchases: () => void;
}) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const thisMonth = today.slice(0, 7);
  const figure = statementFigure(card, book, today, duePayments);
  const schedule = cardSchedule(book, card.id, thisMonth);
  const ahead = schedule.filter((m) => m.month > thisMonth);
  const payments = [...book.payments(card.id)].reverse().slice(0, 3);
  const due = duePayments.some((d) => d.account.id === card.id);
  const dueState = dueStateOf(card, standing, book, due, today);
  const owed = standing.owed;
  const money = (amount: number, sign: "auto" | "none" = "none") => <Money amount={amount} currency={card.currency} sign={sign} />;

  let dueLine: ReactNode = null;
  if (dueState?.paid) {
    dueLine = (
      <p className="flex items-center gap-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-400" data-card-due>
        {t("pocket.cards.paidThisMonth")}
        <Icon name="check" size={16} />
      </p>
    );
  } else if (dueState) {
    const when = dueLabel(dueState.date, today);
    const days = daysBetween(today, dueState.date);
    const owing = figure.amount > 0.005;
    // amber within five days, red on the day and after, while there's something to pay
    const tone =
      owing && days <= 0
        ? "text-red-600 dark:text-red-400"
        : owing && days <= 5
          ? "text-amber-600 dark:text-amber-400"
          : "text-zinc-500 dark:text-zinc-400";
    dueLine = (
      <p className={`text-[13px] font-medium ${tone}`} data-card-due>
        {t("pocket.cards.dueOn", { date: shortDate(dueState.date, locale), when: when.text })}
      </p>
    );
  }

  const owedLine =
    owed <= 0.005 ? (
      t("cards.nothingOwed")
    ) : (
      <Template
        text={t(ahead.length === 0 ? "pocket.cards.owedOnly" : ahead.length === 1 ? "pocket.cards.owedMonthsOne" : "pocket.cards.owedMonthsMany")}
        values={{ amount: money(owed), count: ahead.length }}
      />
    );

  return (
    <article className={cardClass} aria-labelledby={`card-${card.id}`} data-card-tile={card.name}>
      <div className="space-y-3 px-4 pb-4 pt-3">
        <div className="-mr-2 flex items-start gap-2">
          <div className="min-w-0 flex-1 pt-2">
            <h2 id={`card-${card.id}`} className="truncate text-[17px] font-semibold">
              {card.name}
            </h2>
            {dueLine ? <div className="mt-0.5">{dueLine}</div> : null}
          </div>
          <button
            type="button"
            onClick={onMenu}
            aria-haspopup="dialog"
            aria-label={t("pocket.cards.cardMenu", { name: card.name })}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge-soft)] dark:text-zinc-400"
          >
            <Icon name="more" size={22} />
          </button>
        </div>

        <div data-card-statement>
          {figure.amount > 0.005 ? (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("pocket.cards.thisStatement")}</p>
              <FitFigure>{formatSigned(figure.amount, card.currency, locale, "none")}</FitFigure>
              <Approx amount={figure.amount} from={card.currency} to={display} usdPer={usdPer} />
            </>
          ) : figure.next ? (
            // this month is done: lead with what's next rather than with nothing
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400" data-card-next>
                {t("pocket.cards.nextStatement", {
                  date: figure.next.date ? shortDate(figure.next.date, locale) : figure.next.month,
                })}
              </p>
              <FitFigure>{formatSigned(figure.next.amount, card.currency, locale, "none")}</FitFigure>
              <Approx amount={figure.next.amount} from={card.currency} to={display} usdPer={usdPer} />
            </>
          ) : (
            <p className="py-1 text-[17px] font-semibold text-zinc-600 dark:text-zinc-300">{t("pocket.cards.nothingThisMonth")}</p>
          )}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400" data-card-owed>
            {owedLine}
          </p>
        </div>

        {card.creditLimit != null && card.creditLimit > 0 ? (
          <LimitBar used={owed} limit={card.creditLimit} currency={card.currency} available={standing.available} />
        ) : null}

        <button type="button" onClick={onPay} aria-haspopup="dialog" aria-label={`${t("cards.recordPayment")} — ${card.name}`} className={primaryButton}>
          {t("cards.recordPayment")}
        </button>
      </div>

      {ahead.length > 0 ? (
        <div className="border-t border-[var(--edge-soft)] py-3">
          <p className="px-4 text-xs text-zinc-500 dark:text-zinc-400">{t("cards.upcomingByMonth")}</p>
          <ul
            aria-label={t("cards.upcomingByMonth")}
            className="mt-2 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
            data-card-timeline
          >
            {ahead.map(({ month, total }) => (
              <li
                key={month}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--pocket-chip-radius,9999px)] border border-[var(--edge)] px-3 text-[13px]"
              >
                <span className="text-zinc-500 dark:text-zinc-400">{chipMonth(month, today.slice(0, 4), locale)}</span>
                <Money amount={total} currency={card.currency} sign="auto" className="font-medium" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="border-t border-[var(--edge-soft)] pt-3">
          <p className="px-4 text-xs text-zinc-500 dark:text-zinc-400">{t("cards.paymentsMade")}</p>
          <ul className="mt-1 pb-1">
            {payments.map((p) => (
              <li key={p.groupId} className="flex min-h-[40px] items-center gap-2 px-4 text-[13px]">
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{dayDate(p.date, locale, p.date.slice(0, 4) !== today.slice(0, 4))}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">{p.paying.description}</span>
                {p.made ? null : (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {t("tx.planned")}
                  </span>
                )}
                <Money amount={p.amount} currency={card.currency} sign="out" tone="neg" className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {bigPurchases > 0 ? (
        <button
          type="button"
          onClick={onPurchases}
          className="flex min-h-[44px] w-full items-center gap-2 border-t border-[var(--edge-soft)] px-4 text-left text-[13px] font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
        >
          <span className="min-w-0 flex-1 truncate">
            {bigPurchases === 1 ? t("cards.seeBigPurchasesOne") : t("cards.seeBigPurchases", { count: bigPurchases })}
          </span>
          <Icon name="chevron" size={18} className="shrink-0" />
        </button>
      ) : null}
    </article>
  );
}

/** A 6px track of what's used of the limit: teal, amber from 80%, red once over. */
function LimitBar({ used, limit, currency, available }: { used: number; limit: number; currency: Currency; available: number | null }) {
  const { t, locale } = useI18n();
  const ratio = limit > 0 ? used / limit : 0;
  const over = available != null && available < 0;
  const fill = over || ratio > 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-teal-600 dark:bg-teal-500";
  const text = over
    ? t("cards.limitOver", { amount: formatSigned(-(available ?? 0), currency, locale, "none") })
    : t("pocket.cards.limitUsed", {
        used: formatSigned(used, currency, locale, "none"),
        limit: formatSigned(limit, currency, locale, "none"),
      });
  return (
    <div data-card-limit>
      <p className={`mb-1.5 text-xs ${over ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
        {over ? (
          <Template text={t("cards.limitOver")} values={{ amount: <Money amount={-(available ?? 0)} currency={currency} sign="none" /> }} />
        ) : (
          <Template
            text={t("pocket.cards.limitUsed")}
            values={{
              used: <Money amount={used} currency={currency} sign="none" />,
              limit: <Money amount={limit} currency={currency} sign="none" />,
            }}
          />
        )}
      </p>
      <div
        role="progressbar"
        aria-label={t("cards.creditLimit")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(0, ratio) * 100)}
        aria-valuetext={text}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--edge-soft)]"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
      </div>
    </div>
  );
}

function Retired({
  cards,
  open,
  onToggle,
  busy,
  onBringBack,
}: {
  cards: Account[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onBringBack: (card: Account) => void;
}) {
  const { t } = useI18n();
  const listId = useId();
  return (
    <section className={cardClass}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-[48px] w-full items-center gap-2 px-4 text-left active:bg-[var(--edge-soft)]"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-zinc-600 dark:text-zinc-300">
          {t("cards.inactive")} ({cards.length})
        </span>
        <Icon name="chevron" size={18} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <ul id={listId} className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
          {cards.map((card) => (
            <li key={card.id} className="flex min-h-[var(--pocket-row,56px)] items-center gap-3 pl-4 pr-2">
              <Icon name="card" size={18} className="shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-500 dark:text-zinc-400">{card.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onBringBack(card)}
                aria-label={`${t("cards.markActive")} — ${card.name}`}
                className="flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-[14px] font-medium text-teal-600 active:bg-[var(--edge-soft)] disabled:opacity-50 dark:text-teal-400"
              >
                {t("cards.markActive")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------- big purchases */

function BigPurchases({
  cards,
  accounts,
  purchases,
  book,
  transactions,
  usdPer,
  display,
  onOpen,
  onNew,
}: {
  cards: Account[];
  accounts: Account[];
  purchases: Purchase[];
  book: CardBook;
  transactions: Transaction[];
  usdPer: UsdPerMap | undefined;
  display: Currency;
  onOpen: (p: Purchase) => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  if (purchases.length === 0) {
    return (
      <EmptyState
        action={
          <button type="button" onClick={onNew} className={secondaryButton}>
            <Icon name="plus" size={18} />
            {t("purchases.newPurchase")}
          </button>
        }
      >
        {t("purchases.empty")}
      </EmptyState>
    );
  }
  const groups = cards
    .map((card) => ({ key: card.id, title: card.name, items: purchases.filter((p) => p.accountId === card.id) }))
    .filter((g) => g.items.length > 0);
  const others = purchases.filter((p) => !p.accountId || !cards.some((c) => c.id === p.accountId));
  if (others.length > 0) groups.push({ key: "other", title: t("purchases.otherAccounts"), items: others });

  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className={cardClass} aria-labelledby={`purchases-${group.key}`} data-purchase-group={group.title}>
          <h2 id={`purchases-${group.key}`} className="flex min-h-[44px] items-center px-4 pt-1 text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]" style={headStyle}>
            {group.title}
          </h2>
          <ul className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
            {group.items.map((p) => (
              <li key={p.id}>
                <PurchaseRow
                  purchase={p}
                  account={accounts.find((a) => a.id === p.accountId)}
                  book={book}
                  transactions={transactions}
                  usdPer={usdPer}
                  display={display}
                  onOpen={() => onOpen(p)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">{t("cards.bigPurchasesHint")}</p>
    </>
  );
}

/** What a purchase's row says under its name: progress, or what kind of entry it is. */
function usePurchaseMeta() {
  const { t, locale } = useI18n();
  return (
    purchase: Purchase,
    account: Account | undefined,
    book: CardBook,
    transactions: Transaction[]
  ): { text: ReactNode; ratio: number | null } => {
    const currency = account?.currency ?? "TRY";
    const instalments = purchase.installmentCount > 1;
    if (instalments && purchase.reflected) {
      const progress = purchaseProgress(purchase, book, transactions, currency);
      return {
        text: (
          <Template
            text={t("pocket.cards.progressLeft")}
            values={{
              done: progress.paidCount,
              total: progress.totalCount,
              amount: <Money amount={progress.remainingAmount} currency={currency} sign="none" />,
            }}
          />
        ),
        ratio: progress.totalCount > 0 ? progress.paidCount / progress.totalCount : 0,
      };
    }
    // short enough for one line beside the amount: the date or the instalments, and whether it's only logged
    const first = instalments
      ? `${purchase.installmentCount}× ${t("purchases.installments").toLowerCase()}`
      : shortDate(purchase.purchaseDate, locale, purchase.purchaseDate.slice(0, 4) !== todayISO().slice(0, 4));
    const second = purchase.reflected ? t("purchases.oneShot") : t("purchases.logOnly");
    return { text: `${first} · ${second}`, ratio: null };
  };
}

function PurchaseRow({
  purchase,
  account,
  book,
  transactions,
  usdPer,
  display,
  onOpen,
}: {
  purchase: Purchase;
  account: Account | undefined;
  book: CardBook;
  transactions: Transaction[];
  usdPer: UsdPerMap | undefined;
  display: Currency;
  onOpen: () => void;
}) {
  const meta = usePurchaseMeta()(purchase, account, book, transactions);
  const currency = account?.currency ?? "TRY";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-purchase-row={purchase.name}
      className="flex min-h-[var(--pocket-row,56px)] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{purchase.name}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{meta.text}</span>
        {meta.ratio != null ? (
          <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--edge-soft)]">
            <span className="block h-full rounded-full bg-teal-600 dark:bg-teal-500" style={{ width: `${Math.round(meta.ratio * 100)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <Money amount={purchase.amount} currency={currency} sign="none" className="text-[15px] font-semibold" />
        <Approx amount={purchase.amount} from={currency} to={display} usdPer={usdPer} />
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-zinc-400" />
    </button>
  );
}

/**
 * A purchase's sheet: what it is, Reflect on the account as a switch whose
 * warning is confirmed in place, and Delete — armed by a second tap, then,
 * for a reflected purchase, whether its transactions go with it.
 */
function PurchaseSheet({
  purchase,
  account,
  book,
  transactions,
  reflecting,
  onReflect,
  onDelete,
  onClose,
}: {
  purchase: Purchase | null;
  account: Account | undefined;
  book: CardBook;
  transactions: Transaction[];
  reflecting: boolean;
  onReflect: (reflected: boolean) => void;
  onDelete: (deleteTransactions: boolean) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const meta = usePurchaseMeta();
  const [step, setStep] = useState<{ id: string; kind: "reflect" | "armed" | "choose" } | null>(null);
  const current = purchase && step?.id === purchase.id ? step.kind : null;

  // an armed delete disarms after four seconds, as the action sheets do
  useEffect(() => {
    if (current !== "armed") return;
    const timer = setTimeout(() => setStep(null), 4000);
    return () => clearTimeout(timer);
  }, [current]);

  const close = () => {
    setStep(null);
    onClose();
  };

  if (!purchase) return null;
  const currency = account?.currency ?? "TRY";
  const info = meta(purchase, account, book, transactions);
  const nextReflected = !purchase.reflected;

  return (
    <PocketSheet open onClose={close} title={purchase.name}>
      <div className="space-y-4 pb-2">
        <div>
          <Money amount={purchase.amount} currency={currency} sign="none" className="text-2xl font-bold" />
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
            {[account?.name ?? t("purchases.noAccount"), shortDate(purchase.purchaseDate, locale, true)].join(" · ")}
          </p>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{info.text}</p>
          {purchase.details ? <p className="mt-1 text-[13px] text-zinc-400">{purchase.details}</p> : null}
        </div>

        <div className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
          <button
            type="button"
            role="switch"
            aria-checked={purchase.reflected}
            disabled={!purchase.accountId || reflecting}
            data-autofocus
            onClick={() => setStep(current === "reflect" ? null : { id: purchase.id, kind: "reflect" })}
            className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] active:bg-[var(--edge-soft)] disabled:opacity-50"
          >
            <span>{t("purchases.reflect")}</span>
            <span
              aria-hidden
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${purchase.reflected ? "bg-teal-600 dark:bg-teal-500" : "bg-[var(--edge)]"}`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${purchase.reflected ? "translate-x-[22px]" : "translate-x-0.5"}`}
              />
            </span>
          </button>
          {current === "reflect" ? (
            <div role="alert" className="space-y-3 border-t border-[var(--edge-soft)] bg-amber-50 px-4 py-3 dark:bg-amber-950/40" data-reflect-warning>
              <p className="text-[13px] text-amber-800 dark:text-amber-200">
                {nextReflected ? t("purchases.reflectOnWarning") : t("purchases.reflectOffWarning")}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(null)} className={`${secondaryButton} flex-1 bg-[var(--surface)]`}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={reflecting}
                  onClick={() => {
                    setStep(null);
                    onReflect(nextReflected);
                  }}
                  className={`${primaryButton} flex-1`}
                >
                  {t("common.confirm")}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
          {current === "choose" ? (
            <div className="divide-y divide-[var(--edge-soft)]" role="group" aria-label={t("purchases.deleteTitle")}>
              <p className="px-4 py-3 text-[13px] font-medium">{t("purchases.deleteTitle")}</p>
              <button
                type="button"
                onClick={() => onDelete(true)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-[15px] text-red-600 active:bg-[var(--edge-soft)] dark:text-red-400"
              >
                <Icon name="trash" size={20} className="shrink-0 opacity-80" />
                {t("purchases.deleteAlsoTx")}
              </button>
              <button
                type="button"
                onClick={() => onDelete(false)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-[var(--edge-soft)]"
              >
                <Icon name="trash" size={20} className="shrink-0 opacity-60" />
                {t("purchases.deleteKeepTx")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (current !== "armed") setStep({ id: purchase.id, kind: "armed" });
                else if (purchase.reflected) setStep({ id: purchase.id, kind: "choose" });
                else onDelete(false);
              }}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-[15px] text-red-600 active:bg-[var(--edge-soft)] dark:text-red-400"
            >
              <Icon name="trash" size={20} className="shrink-0 opacity-80" />
              {current === "armed" ? t("pocket.tapAgain") : t("purchases.deleteTitle")}
            </button>
          )}
        </div>
      </div>
    </PocketSheet>
  );
}
