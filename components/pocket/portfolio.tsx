"use client";

import { useSearchParams } from "next/navigation";
import { KeyboardEvent, ReactNode, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { AccountModal } from "@/app/(app)/accounts/page";
import { Skeleton } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useLoans } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Currency } from "@/lib/domain/currencies";
import { computeDebtOverview } from "@/lib/domain/debt";
import { UsdPerMap } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";
import { useLocalToggle } from "@/lib/prefs";
import { monthLabel } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import {
  AccountLine,
  ARCHIVED_OPEN_KEY,
  HIDE_EMPTY_KEY,
  isPortfolioSegment,
  LoanLine,
  ordinal,
  parseScroll,
  PORTFOLIO_SCROLL_KEY,
  PORTFOLIO_SEG_KEY,
  PORTFOLIO_SEGMENTS,
  PortfolioSegment,
  SectionKey,
  sections as buildSections,
  SEGMENT_SECTIONS,
} from "@/lib/ui/pocket/portfolioSections";
import { usePocketFlag, usePocketPref } from "@/lib/ui/pocket/prefs";
import {
  AccountDetail,
  ApproxLine,
  KindAvatar,
  LimitBar,
  LoanAvatar,
  openAccount,
  PortfolioBase,
  unitOf,
  usePortfolioBase,
} from "./accountDetail";
import { Icon } from "./icons";
import { FitFigure, Money, PocketPage, Row, Section } from "./kit";

/**
 * Pocket's Portfolio (/accounts): what you hold and what you owe, one list.
 *
 * - The hero is the figure for the chosen segment — All is the Dashboard's
 *   net worth, Assets the cash and crypto & gold subtotals, Debts every loan
 *   and card (computeDebtOverview) — with the All | Assets | Debts radios
 *   under it, kept on the device.
 * - Then a card per section, its subtotal in the display currency: Cash &
 *   bank, Crypto & gold, Credit cards (what each is owed), Debt (tracked
 *   loans). Rows show the native figure first and the ≈ under it.
 * - Footer: "Show empty accounts (n)" (the Classic page's own setting) and
 *   the archived accounts, folded away.
 * - ?account={id} opens that account full-screen (accountDetail.tsx); an id
 *   that isn't there falls back to this list.
 *
 * The arithmetic is lib/ui/pocket/portfolioSections.ts.
 */

export function PocketPortfolio() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PortfolioRoute />
    </Suspense>
  );
}

function PortfolioRoute() {
  const params = useSearchParams();
  const accounts = useAccounts();
  const id = params.get("account");
  const account = id ? accounts.data?.find((a) => a.id === id) : undefined;
  if (id && accounts.isLoading) return <ListSkeleton />;
  if (account) return <AccountDetail key={account.id} account={account} />;
  return <PortfolioList />;
}

const headStyle = {
  fontWeight: "var(--ui-head-weight)" as unknown as number,
  letterSpacing: "var(--ui-head-tracking)",
  textTransform: "var(--ui-head-transform)" as React.CSSProperties["textTransform"],
};

const cardClass =
  "overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm";

const unitLabel = (c: Currency) => (c === "XAU_G" ? "g" : c);

function ListSkeleton() {
  const { t } = useI18n();
  return (
    <PocketPage title={t("portfolio.title")}>
      <div aria-hidden className={`${cardClass} space-y-3 p-4`}>
        <Skeleton rows={1} className="w-32" />
        <div className="h-10 w-52 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-9 animate-pulse rounded-full bg-[var(--edge-soft)]" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden className={`${cardClass} space-y-4 p-4`}>
          <Skeleton rows={1} className="w-28" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <Skeleton rows={2} className="flex-1" />
            </div>
          ))}
        </div>
      ))}
    </PocketPage>
  );
}

function PortfolioList() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const base = usePortfolioBase();
  const loans = useLoans();
  const hideEmpty = useLocalToggle(HIDE_EMPTY_KEY, false);
  const [segRaw, setSeg] = usePocketPref(PORTFOLIO_SEG_KEY, "all", isPortfolioSegment);
  const seg = segRaw as PortfolioSegment;
  const [archivedOpen, setArchivedOpen] = usePocketFlag(ARCHIVED_OPEN_KEY);
  const [creating, setCreating] = useState(false);
  const archivedId = useId();

  const createAccount = useAppMutation((input: NewAccount) => repo.createAccount(input), [KEYS.accounts]);

  const { accounts, transactions, balances, book, usdPer, display, today, derived } = base;

  // loans need no rates to be listed; their total does
  const debt = useMemo(() => {
    if (!loans.data || !accounts || !transactions || !balances) return null;
    return computeDebtOverview({
      loans: loans.data,
      accounts,
      balances,
      transactions,
      usdPer: usdPer ?? ({} as UsdPerMap),
      display,
      today,
    });
  }, [loans.data, accounts, transactions, balances, usdPer, display, today]);

  const s = useMemo(
    () =>
      accounts && balances && book
        ? buildSections({ accounts, balances, book, debt, usdPer, display, hideEmpty: hideEmpty.value, today })
        : null,
    [accounts, balances, book, debt, usdPer, display, hideEmpty.value, today]
  );

  // back from an account: the list where it was left
  const ready = s != null;
  useEffect(() => {
    if (!ready) return;
    let y: number | null = null;
    try {
      y = parseScroll(window.sessionStorage.getItem(PORTFOLIO_SCROLL_KEY));
      window.sessionStorage.removeItem(PORTFOLIO_SCROLL_KEY);
    } catch {
      // no storage, nothing to restore
    }
    if (y == null) return;
    const to = y;
    const frame = requestAnimationFrame(() => window.scrollTo(0, to));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  const action = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label={t("accounts.newAccount")}
        aria-haspopup="dialog"
        className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
      >
        <Icon name="plus" size={22} />
      </button>
    ),
    [t]
  );

  const modal = (
    <AccountModal
      open={creating}
      initial={null}
      onClose={() => setCreating(false)}
      onSave={async (input) => {
        await createAccount.mutateAsync(input);
        setCreating(false);
      }}
    />
  );

  if (base.loading || !s) {
    return <ListSkeleton />;
  }

  if ((accounts ?? []).length === 0) {
    return (
      <PocketPage title={t("portfolio.title")} action={action}>
        <div className={`${cardClass} space-y-4 p-4`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("accounts.empty")}</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-teal-600 text-[15px] font-semibold text-white active:opacity-90 dark:bg-teal-500 dark:text-zinc-950"
          >
            + {t("accounts.newAccount")}
          </button>
        </div>
        {modal}
      </PocketPage>
    );
  }

  const heroTotal = seg === "all" ? (derived?.netWorth.total ?? s.totals.all) : s.totals[seg];
  const segLabel = (v: PortfolioSegment) =>
    v === "all" ? t("common.all") : v === "assets" ? t("pocket.portfolio.segAssets") : t("pocket.portfolio.segDebts");
  const heroName = seg === "all" ? t("dashboard.netWorth") : segLabel(seg);
  const shown = SEGMENT_SECTIONS[seg];

  const accountRows = (lines: AccountLine[], archived = false) => (
    <ul className="divide-y divide-[var(--edge-soft)]">
      {lines.map((l) => (
        <li key={l.account.id} data-account-row={l.account.name}>
          <AccountRow line={l} base={base} archived={archived} onOpen={openAccount} />
        </li>
      ))}
    </ul>
  );

  const titles: Record<SectionKey, string> = {
    cash: t("pocket.portfolio.cashBank"),
    cryptoGold: t("pocket.portfolio.cryptoGold"),
    cards: t("portfolio.cards"),
    loans: t("nav.loans"),
  };

  const sectionCard = (key: SectionKey): ReactNode => {
    const section = s[key];
    if (section.rows.length === 0) return null;
    const subtotal = section.subtotal;
    return (
      <div key={key} data-portfolio-section={key}>
        <Section
          flush
          title={titles[key]}
          action={
            subtotal != null ? (
              <Money
                amount={subtotal}
                currency={display}
                tone={subtotal < 0 ? "neg" : undefined}
                className="text-sm font-semibold"
              />
            ) : null
          }
        >
          {key === "loans"
            ? (
                <ul className="divide-y divide-[var(--edge-soft)]">
                  {(section.rows as LoanLine[]).map((l) => (
                    <li key={l.item.id}>
                      <LoanRow line={l} base={base} />
                    </li>
                  ))}
                </ul>
              )
            : accountRows(section.rows as AccountLine[])}
        </Section>
      </div>
    );
  };

  const anyShown = shown.some((k) => s[k].rows.length > 0);

  return (
    <PocketPage title={t("portfolio.title")} action={action}>
      <section aria-label={`${heroName} · ${unitLabel(display)}`} className={cardClass} data-portfolio-hero>
        <div className="px-4 pt-3">
          <span className="block truncate text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]" style={headStyle}>
            {heroName} · {unitLabel(display)}
          </span>
          {heroTotal != null ? (
            <FitFigure tone={heroTotal < 0 ? "neg" : undefined}>{formatSigned(heroTotal, display, locale)}</FitFigure>
          ) : base.ratesSettled ? (
            <p className="py-2 text-sm text-amber-600 dark:text-amber-400">{t("common.rateUnavailable")}</p>
          ) : (
            <div aria-hidden className="my-1.5 h-9 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          )}
          {seg === "all" && derived && derived.netWorth.skippedAccountIds.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("dashboard.skippedAccounts")}</p>
          ) : null}
        </div>
        <div className="px-3 pb-3 pt-3">
          <SegmentRadios
            label={t("pocket.portfolio.segLabel")}
            value={seg}
            options={PORTFOLIO_SEGMENTS.map((v) => ({ value: v, label: segLabel(v) }))}
            onChange={setSeg}
          />
        </div>
      </section>

      {shown.map(sectionCard)}

      {!anyShown ? (
        <p className={`${cardClass} px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400`}>{t("portfolio.noHistory")}</p>
      ) : null}

      {s.emptyCount > 0 ? (
        <button
          type="button"
          role="switch"
          aria-checked={!hideEmpty.value}
          onClick={() => hideEmpty.setValue(!hideEmpty.value)}
          className={`${cardClass} flex min-h-[var(--pocket-row,56px)] w-full items-center justify-between gap-3 px-4 text-left active:bg-[var(--edge-soft)]`}
        >
          <span className="min-w-0 text-[15px]">{t("pocket.portfolio.showEmptyN", { count: s.emptyCount })}</span>
          <SwitchTrack on={!hideEmpty.value} />
        </button>
      ) : null}

      {s.archived.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={archivedOpen}
            aria-controls={archivedId}
            onClick={() => setArchivedOpen(!archivedOpen)}
            className="-mx-1 flex min-h-[44px] w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-lg px-1 text-left text-sm font-medium text-zinc-500 active:bg-[var(--edge-soft)] dark:text-zinc-400"
          >
            <Icon name="chevron" size={18} className={`shrink-0 transition-transform ${archivedOpen ? "rotate-90" : ""}`} />
            {t("pocket.portfolio.archivedN", { count: s.archived.length })}
          </button>
          {archivedOpen ? (
            <div id={archivedId} className={`${cardClass} mt-1`} data-portfolio-section="archived">
              {accountRows(s.archived, true)}
            </div>
          ) : null}
        </div>
      ) : null}

      {modal}
    </PocketPage>
  );
}

/** The 44px switch's track; the whole row is the control. */
function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-teal-600 dark:bg-teal-500" : "bg-[var(--edge)]"
      }`}
    >
      <span
        className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform dark:bg-zinc-100 ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

/**
 * One choice of a few as a radio group: the selected one checked, arrow keys
 * move and choose, as a segmented control should read to a screen reader.
 * Drawn like the kit's Segmented.
 */
function SegmentRadios<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[var(--pocket-chip-radius,9999px)] bg-[var(--edge-soft)] p-1">
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`relative min-h-[36px] flex-1 rounded-[var(--pocket-chip-radius,9999px)] px-3 text-[13px] font-medium transition-colors before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] ${
              on ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ArchivedTag() {
  const { t } = useI18n();
  return (
    <span className="ml-1.5 inline-block rounded-full bg-zinc-100 px-1.5 align-middle text-[10px] font-medium leading-4 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {t("accounts.archived")}
    </span>
  );
}

function AccountRow({
  line,
  base,
  archived,
  onOpen,
}: {
  line: AccountLine;
  base: PortfolioBase;
  archived: boolean;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { account, shown, card } = line;
  const meta: ReactNode = card ? (
    <>
      {card.paymentDay != null ? t("pocket.portfolio.cardDue", { day: ordinal(card.paymentDay, locale) }) : account.currency}
      <LimitBar card={card} className="mt-1.5" />
    </>
  ) : (
    unitOf(account)
  );
  return (
    <Row
      leading={<KindAvatar account={account} />}
      title={
        <>
          {account.name}
          {archived ? <ArchivedTag /> : null}
        </>
      }
      meta={meta}
      dim={archived}
      onClick={() => onOpen(account.id)}
      trailing={
        <>
          <Money amount={shown.amount} currency={shown.currency} tone="auto" className="block text-[15px] font-semibold" />
          <ApproxLine amount={shown.amount} from={shown.currency} to={base.display} usdPer={base.usdPer} settled={base.ratesSettled} />
        </>
      }
    />
  );
}

function LoanRow({ line, base }: { line: LoanLine; base: PortfolioBase }) {
  const { t, locale } = useI18n();
  const { item, amount } = line;
  return (
    <Row
      href="/loans"
      leading={<LoanAvatar />}
      title={item.name}
      meta={item.endDate ? t("pocket.portfolio.debtFree", { date: monthLabel(item.endDate.slice(0, 7), locale) }) : item.currency}
      chevron
      trailing={
        <>
          <Money amount={amount} currency={item.currency} tone="auto" className="block text-[15px] font-semibold" />
          <ApproxLine amount={amount} from={item.currency} to={base.display} usdPer={base.usdPer} settled={base.ratesSettled} />
        </>
      }
    />
  );
}
