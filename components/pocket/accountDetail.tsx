"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccountModal } from "@/app/(app)/accounts/page";
import { AdjustBalanceModal } from "@/components/adjustBalanceModal";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { HoldingsList, HoldingsSummary } from "@/components/goldHoldings";
import { Badge } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTransactions } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { buildCardBook, CardBook, chargeAmount } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { GoldPrices, goldRatiosOf } from "@/lib/domain/gold";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useDashboardData } from "@/lib/useDashboardData";
import { groupMonthsDays } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import {
  accountFeed,
  accountLine,
  canAdjust,
  CardInfo,
  isMixedGold,
  ordinal,
  PORTFOLIO_SCROLL_KEY,
} from "@/lib/ui/pocket/portfolioSections";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { usePocketChrome } from "./chrome";
import { PocketDayList, PocketTxRow, useTxLookup } from "./dayList";
import { Icon, IconName } from "./icons";
import { Approx, Avatar, FitFigure, PocketPage, Section } from "./kit";
import { PocketActionSheet } from "./sheet";
import { usePocketTxSheet } from "./txActions";

/**
 * One account full-screen (/accounts?account={id}), Pocket's version of the
 * Classic Portfolio's right-hand pane: the balance with its ≈, four actions
 * (Add, Transfer, Adjust — Card payment on a card — and More), what's
 * planned on it with a ✓ each, then its history grouped by month and day,
 * nets in its own currency. Adjustments read as "EFT fee · Adjustment".
 *
 * The layer is a route: Back (the header's chevron or the browser's) closes
 * it, and the list comes back where it was scrolled to.
 *
 * Also the pieces the list draws its rows with (KindAvatar, AccountMeta,
 * ApproxLine, LimitBar) and usePortfolioBase(), the figures both use.
 */

/** Opened from the list in this tab: Back can simply go back. */
let openedFromList = false;

/** Open an account's page, remembering where the list was scrolled. */
export function openAccount(router: ReturnType<typeof useRouter>, id: string): void {
  try {
    window.sessionStorage.setItem(PORTFOLIO_SCROLL_KEY, String(window.scrollY));
  } catch {
    // no storage: the list just opens at the top
  }
  openedFromList = true;
  router.push(`/accounts?account=${encodeURIComponent(id)}`, { scroll: false });
}

/** Close it: back to the list it came from, or to the list when it was opened by link. */
export function closeAccount(router: ReturnType<typeof useRouter>): void {
  if (openedFromList) {
    openedFromList = false;
    router.back();
  } else {
    router.replace("/accounts", { scroll: false });
  }
}

export interface PortfolioBase {
  accounts: Account[] | undefined;
  transactions: Transaction[] | undefined;
  balances: Map<string, number> | null;
  book: CardBook | null;
  usdPer: UsdPerMap | undefined;
  /** today's prices per gold type, for a gold account's holdings */
  goldTry: GoldPrices | undefined;
  /** rates have arrived, or failed for good: a missing ≈ can say so */
  ratesSettled: boolean;
  display: Currency;
  today: string;
  derived: ReturnType<typeof useDashboardData>;
  loading: boolean;
}

/**
 * The figures the list and the account page share: the Dashboard's own
 * (useDashboardData) once rates are in, and the same computeBalances the
 * Classic page runs before that, so rows show without waiting for rates.
 */
export function usePortfolioBase(): PortfolioBase {
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const derived = useDashboardData(displayCurrency);
  const today = todayISO();
  const list = accounts.data;
  const txs = transactions.data;
  const balances = useMemo(
    () => (list && txs ? computeBalances(list, txs, goldRatiosOf(rates.data)) : null),
    [list, txs, rates.data]
  );
  const book = useMemo(() => (list && txs ? buildCardBook(list, txs) : null), [list, txs]);
  return {
    accounts: list,
    transactions: txs,
    balances,
    book,
    usdPer: rates.data?.usdPer,
    goldTry: rates.data?.goldTry,
    ratesSettled: rates.data != null || !rates.isLoading,
    display: displayCurrency,
    today,
    derived,
    loading: accounts.isLoading || transactions.isLoading,
  };
}

/* ------------------------------------------------------------ row pieces */

const COINS = "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5";
const BITCOIN = "M8 5h5.5a3 3 0 0 1 0 6H8zM8 11h6.5a3 3 0 0 1 0 6H8zM8 5v12M10 3v2M13 3v2M10 17v2M13 17v2M6 5h2M6 17h2";

/** The two glyphs icons.tsx doesn't have, drawn the same way. */
function Glyph({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const TINT: Record<Account["kind"], string> = {
  fiat: "var(--color-teal-600)",
  crypto: "var(--color-sky-600)",
  gold: "var(--color-amber-600)",
  credit_card: "var(--color-zinc-500)",
};

/** A 36px disc for what kind of account it is: bank, bitcoin, coins or card. */
export function KindAvatar({ account }: { account: Account }) {
  const icon =
    account.kind === "credit_card" ? (
      <Icon name="card" size={18} />
    ) : account.kind === "crypto" ? (
      <Glyph d={BITCOIN} />
    ) : account.kind === "gold" ? (
      <Glyph d={COINS} />
    ) : (
      <Icon name="bank" size={18} />
    );
  return <Avatar color={TINT[account.kind]} label={account.name} icon={icon} />;
}

/** A tracked loan's disc. */
export function LoanAvatar() {
  return <Avatar color="var(--color-red-600)" label="" icon={<Icon name="repeat" size={18} />} />;
}

/** "TRY", "GOLD g", "2 Tam · 5 Çeyrek" — what an account holds, as the Classic rows say it. */
export function unitOf(account: Account): ReactNode {
  if (isMixedGold(account)) return <HoldingsSummary holdings={account.holdings!} />;
  return account.currency === "XAU_G" ? "GOLD g" : account.currency;
}

/** The 4px used-of-limit bar: teal, amber from 80%, red at the limit. */
export function LimitBar({ card, className = "" }: { card: CardInfo; className?: string }) {
  if (card.used == null) return null;
  const fill =
    card.over || card.used >= 1
      ? "bg-red-500"
      : card.used >= 0.8
        ? "bg-amber-500"
        : "bg-teal-600 dark:bg-teal-500";
  return (
    <span aria-hidden className={`block h-1 w-full overflow-hidden rounded-full bg-[var(--edge-soft)] ${className}`}>
      <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.round(card.used * 1000) / 10}%` }} />
    </span>
  );
}

/**
 * The "≈ display currency" line under a native figure, only when the two
 * differ; "≈ rate unavailable" once rates have failed rather than nothing.
 */
export function ApproxLine({
  amount,
  from,
  to,
  usdPer,
  settled,
  exact = false,
}: {
  amount: number;
  from: Currency;
  to: Currency;
  usdPer: UsdPerMap | undefined;
  settled: boolean;
  /** the exact figure in place of the compact one (a page's own big number) */
  exact?: boolean;
}) {
  const { t, locale } = useI18n();
  if (from === to) return null;
  const converted = usdPer ? convert(amount, from, to, usdPer) : null;
  if (converted == null) {
    return settled ? (
      <span className="block whitespace-nowrap text-[11px] text-zinc-400">≈ {t("common.rateUnavailable")}</span>
    ) : null;
  }
  if (!exact) return <Approx amount={amount} from={from} to={to} usdPer={usdPer} />;
  return (
    <span data-amount className="block whitespace-nowrap text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
      ≈ {formatSigned(converted, to, locale)}
    </span>
  );
}

/* ------------------------------------------------------------ the page */

const UPCOMING_ROWS = 5;
const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

function ActionButton({
  icon,
  label,
  onClick,
  dialog,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  /** it opens a sheet */
  dialog?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup={dialog ? "dialog" : undefined}
      className="flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] px-1 py-2 text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
    >
      <Icon name={icon} size={22} />
      <span className="max-w-full text-center text-xs font-medium leading-tight">{label}</span>
    </button>
  );
}

export function AccountDetail({ account }: { account: Account }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const chrome = usePocketChrome();
  const repo = useRepo();
  const queryClient = useQueryClient();
  const base = usePortfolioBase();
  const lookup = useTxLookup();
  const txSheet = usePocketTxSheet();
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [allUpcoming, setAllUpcoming] = useState(false);
  // the adjustments this account had when the sheet opened: a new one means it saved
  const adjustSeen = useRef<Set<string> | null>(null);

  const updateAccount = useAppMutation(
    (v: { id: string; patch: Partial<NewAccount> & { archived?: boolean } }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts, KEYS.transactions]
  );
  const deleteAccount = useAppMutation((id: string) => repo.deleteAccount(id), [KEYS.accounts, KEYS.transactions]);

  // the list was pushed with scroll: false; the page itself starts at its top
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [account.id]);

  const back = useMemo(() => ({ label: t("portfolio.title"), onBack: () => closeAccount(router) }), [t, router]);

  const { display, usdPer, ratesSettled, today, book, balances } = base;
  const line =
    book && balances ? accountLine(account, { balances, book, usdPer, display, today }) : null;
  const balance = balances?.get(account.id) ?? 0;
  const card = account.kind === "credit_card";
  const mixed = isMixedGold(account);

  const feed = useMemo(() => accountFeed(base.transactions ?? [], account.id), [base.transactions, account.id]);
  const months = useMemo(
    () =>
      groupMonthsDays(feed.completed, {
        accountsById: lookup.accountsById,
        usdPer: lookup.usdPer,
        display: lookup.display,
        book: lookup.book,
        accountId: account.id,
      }),
    [feed.completed, lookup.accountsById, lookup.usdPer, lookup.display, lookup.book, account.id]
  );
  const upcoming = allUpcoming ? feed.upcoming : feed.upcoming.slice(0, UPCOMING_ROWS);

  // what a payment recorded now would cover, as the Cards page suggests it
  const covers = card && book ? book.uncovered(account.id).filter((c) => c.dueDate.slice(0, 7) < today.slice(0, 7)) : [];
  const suggested = Math.max(0, covers.reduce((sum, c) => sum + chargeAmount(c), 0));

  const startAdjust = () => {
    const current = queryClient.getQueryData<Transaction[]>(KEYS.transactions) ?? base.transactions ?? [];
    adjustSeen.current = new Set(current.filter((tx) => tx.adjustment && tx.accountId === account.id).map((tx) => tx.id));
    setAdjusting(true);
  };
  const endAdjust = () => {
    const seen = adjustSeen.current;
    adjustSeen.current = null;
    // the modal closes after its save has refetched the ledger
    const now = queryClient.getQueryData<Transaction[]>(KEYS.transactions) ?? [];
    if (seen && now.some((tx) => tx.adjustment && tx.accountId === account.id && !seen.has(tx.id))) {
      showSnack(t("pocket.saved"));
    }
    setAdjusting(false);
  };

  const actions: ReactNode[] = [];
  if (!account.archived) {
    actions.push(
      <ActionButton key="add" icon="plus" label={t("common.add")} dialog onClick={() => chrome.openAdd({ mode: "expense", accountId: account.id })} />,
      <ActionButton key="transfer" icon="transfer" label={t("pocket.transfer")} dialog onClick={() => chrome.openAdd({ mode: "transfer", accountId: account.id })} />
    );
    if (card) {
      actions.push(<ActionButton key="pay" icon="card" label={t("tx.cardPayment")} dialog onClick={() => setPaying(true)} />);
    } else if (canAdjust(account)) {
      actions.push(<ActionButton key="adjust" icon="adjust" label={t("pocket.portfolio.adjustShort")} dialog onClick={startAdjust} />);
    }
  } else {
    actions.push(
      <ActionButton
        key="unarchive"
        icon="undo"
        label={t("accounts.unarchive")}
        onClick={() => updateAccount.mutate({ id: account.id, patch: { archived: false } })}
      />
    );
  }
  actions.push(<ActionButton key="more" icon="more" label={t("nav.more")} dialog onClick={() => setMore(true)} />);

  const kindLabel = card ? t("accounts.creditCard") : t(`currency.${account.currency}`);
  const kindTone = card ? "red" : account.kind === "crypto" ? "sky" : account.kind === "gold" ? "amber" : "zinc";
  const fmt = (n: number) => formatSigned(n, account.currency, locale, "none");

  return (
    <PocketPage title={account.name} condensed={account.name} back={back}>
      <div data-account-detail={account.id} className="space-y-4">
        <section
          aria-label={account.name}
          className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm"
        >
          <div className="flex items-center gap-3 px-4 pt-3">
            <KindAvatar account={account} />
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge tone={kindTone}>{kindLabel}</Badge>
              {account.archived ? <Badge tone="red">{t("accounts.archived")}</Badge> : null}
            </div>
          </div>
          <div className="space-y-1 px-4 pb-4 pt-2" data-account-balance>
            {line ? (
              <>
                <FitFigure tone={line.shown.amount < 0 ? "neg" : undefined}>
                  {formatSigned(line.shown.amount, line.shown.currency, locale)}
                </FitFigure>
                <ApproxLine
                  amount={line.shown.amount}
                  from={line.shown.currency}
                  to={display}
                  usdPer={usdPer}
                  settled={ratesSettled}
                  exact
                />
              </>
            ) : (
              <div aria-hidden className="h-10 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            )}
            {line?.card ? (
              <div className="space-y-1.5 pt-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {line.card.paymentDay != null
                    ? t("pocket.portfolio.cardDueLine", { day: ordinal(line.card.paymentDay, locale), amount: fmt(line.card.owed) })
                    : t("cards.owed", { amount: fmt(line.card.owed) })}
                </p>
                {line.card.limit != null ? (
                  <>
                    <LimitBar card={line.card} />
                    <p className={`text-xs ${line.card.over ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                      {line.card.over
                        ? t("cards.limitOver", { amount: fmt(line.card.owed - line.card.limit) })
                        : t("cards.limitLeft", { amount: fmt(line.card.limit - line.card.owed), limit: fmt(line.card.limit) })}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {mixed ? (
            <div className="border-t border-[var(--edge-soft)]">
              <p className="px-4 pt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("gold.holdings")}</p>
              <HoldingsList holdings={account.holdings!} prices={base.goldTry} />
            </div>
          ) : null}
        </section>

        <div role="group" aria-label={account.name} className={`grid gap-2 ${COLS[actions.length]}`}>
          {actions}
        </div>

        {feed.upcoming.length > 0 ? (
          <Section title={t("portfolio.upcoming")} flush>
            <ul className="divide-y divide-[var(--edge-soft)]" data-account-upcoming>
              {upcoming.map((tx) => (
                <PocketTxRow key={tx.id} tx={tx} lookup={lookup} onTap={txSheet.open} onComplete={txSheet.complete} accountScoped due />
              ))}
            </ul>
            {feed.upcoming.length > upcoming.length ? (
              <button
                type="button"
                onClick={() => setAllUpcoming(true)}
                className="flex min-h-[44px] w-full items-center justify-center border-t border-[var(--edge-soft)] text-sm font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
              >
                {t("pocket.portfolio.showAllN", { count: feed.upcoming.length })}
              </button>
            ) : null}
          </Section>
        ) : null}

        {months.length > 0 ? (
          <div data-account-feed>
            <PocketDayList months={months} onRowTap={txSheet.open} onComplete={txSheet.complete} accountCurrency={account.currency} />
          </div>
        ) : feed.upcoming.length === 0 && !base.loading ? (
          <p className="rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t("portfolio.noHistory")}
          </p>
        ) : null}
      </div>

      {txSheet.element}

      <PocketActionSheet
        key={account.id}
        open={more}
        onClose={() => setMore(false)}
        title={account.name}
        items={[
          {
            label: t("common.edit"),
            icon: "edit",
            tone: "primary",
            onSelect: () => {
              setMore(false);
              setEditing(true);
            },
          },
          {
            label: account.archived ? t("accounts.unarchive") : t("accounts.archive"),
            icon: account.archived ? "undo" : "eyeOff",
            onSelect: () => {
              setMore(false);
              updateAccount.mutate({ id: account.id, patch: { archived: !account.archived } });
            },
          },
          {
            label: t("common.delete"),
            icon: "trash",
            tone: "danger",
            // the warning wraps: it has to be read before the second tap
            hint: <span className="whitespace-normal">{t("accounts.deleteWarning")}</span>,
            onSelect: () => {
              setMore(false);
              deleteAccount.mutateAsync(account.id).then(
                () => {
                  showSnack(t("pocket.lists.deleted"));
                  closeAccount(router);
                },
                () => {
                  // the error toast already says why
                }
              );
            },
          },
        ]}
      />

      <AccountModal
        open={editing}
        initial={editing ? account : null}
        onClose={() => setEditing(false)}
        onSave={async (input) => {
          await updateAccount.mutateAsync({ id: account.id, patch: input });
          setEditing(false);
        }}
      />

      <AdjustBalanceModal open={adjusting} account={adjusting ? account : null} balance={balance} onClose={endAdjust} />

      <CardPaymentModal card={paying ? account : null} suggested={suggested} covers={covers} onClose={() => setPaying(false)} />
    </PocketPage>
  );
}
