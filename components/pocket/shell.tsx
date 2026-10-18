"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdjustBalanceModal } from "@/components/adjustBalanceModal";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { CommandPalette } from "@/components/commandPalette";
import { useApp } from "@/lib/data/provider";
import { KEYS, useAccounts, useRates, useTransactions, useUserSettings } from "@/lib/data/queries";
import { Account } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { buildCardBook, chargeAmount } from "@/lib/domain/cards";
import { CURRENCIES, Currency } from "@/lib/domain/currencies";
import { goldRatiosOf } from "@/lib/domain/gold";
import { cardsDueSoon, cardStandings } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { isStaleTable } from "@/lib/rates/fallback";
import { activeSlot, barSlots, DEFAULT_FOURTH } from "@/lib/ui/pocket/bar";
import { formatSigned } from "@/lib/ui/pocket/format";
import { PHONE_LAYOUT_ANCHOR, SHOW_PHONE_LAYOUT_EVENT } from "@/lib/ui/phone";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { POCKET_KEYS, usePocketFlag, usePocketPref } from "@/lib/ui/pocket/prefs";
import { dismissSnack, useSnack } from "@/lib/ui/pocket/snackbar";
import { NavItem } from "@/components/shell.nav";
import { AddSheet } from "./addSheet";
import { AddRequest, HeaderState, PocketChrome, PocketChromeContext } from "./chrome";
import { Icon, navIcon } from "./icons";
import { NoteCard } from "./kit";
import { PocketActionSheet, PocketSheet } from "./sheet";

/** Pages with work that wants a larger screen; Pocket says so once. */
const DESK_NOTE = new Set(["/planner", "/savings"]);

type SheetName = "more" | "currency" | "menu" | "demo" | "pickCard" | "pickAccount";

/**
 * Pocket's shell, on a phone with the setting on: a 44px header that
 * condenses but never hides, the page, and a five-slot tab bar with + in the
 * middle. No rate ticker, no card banner strip, no floating button — that's
 * about 130px of every screen given back. Everything Standard's chrome did is
 * still reachable: rates and the display currency from the currency pill,
 * every page from More, every kind of entry from the + (long-press for the
 * menu), the quick jump from the search button.
 */
export function PocketShell({ sync, children }: { sync: ReactNode; children: ReactNode }) {
  const { t, locale } = useI18n();
  const { session, displayCurrency, setDisplayCurrency, signOut } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const settings = useUserSettings();
  const rates = useRates();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const [fourthPref] = usePocketPref(POCKET_KEYS.tab, DEFAULT_FOURTH);
  const [hideAmounts] = usePocketFlag(POCKET_KEYS.hideAmounts);
  const [noteDismissed, dismissNote] = usePocketFlag(POCKET_KEYS.note + pathname);

  const [header, setHeaderState] = useState<HeaderState>({});
  const [condensed, setCondensed] = useState(false);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paying, setPaying] = useState<Account | null>(null);
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  // a page's own form, opened by its ?add= link; on that page already, the
  // link takes this history entry's place, or Back would have nothing to undo
  const openForm = (href: string) => {
    setSheet(null);
    if (pathname === href.split("?")[0]) replaceQuery(href);
    else router.push(href);
  };
  const mainRef = useRef<HTMLElement>(null);

  const slots = barSlots(settings.data?.navOrder, fourthPref);
  const active = activeSlot(pathname, slots);
  const isDemo = session.status === "ready" && session.repo.mode === "demo";
  const today = todayISO();

  const book = useMemo(
    () => (accounts.data && transactions.data ? buildCardBook(accounts.data, transactions.data) : null),
    [accounts.data, transactions.data]
  );
  const activeCards = (accounts.data ?? []).filter((a) => a.kind === "credit_card" && !a.archived);
  const cardsDot = book ? cardsDueSoon(cardStandings(accounts.data ?? [], book, today), 7).length > 0 : false;
  // planned rows already past their date, as the Activity tab would list them
  const overdue = (transactions.data ?? []).filter(
    (tx) => tx.status === "planned" && !tx.legacy && tx.dueDate < today && book?.roleOf(tx) !== "charge"
  ).length;

  const setHeader = useCallback((next: HeaderState) => {
    setHeaderState((prev) =>
      prev.title === next.title && prev.condensed === next.condensed && prev.back === next.back && prev.action === next.action ? prev : next
    );
  }, []);
  const chrome: PocketChrome = useMemo(
    () => ({
      setHeader,
      openAdd: (request) => {
        setSheet(null);
        setAddRequest(request ?? { mode: "expense" });
      },
      openAddMenu: () => setSheet("menu"),
    }),
    [setHeader]
  );

  // The header condenses once the page's large title has scrolled under it.
  // Pocket screens mark their title; a Classic page inside Pocket has its h1.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let observed: Element | null = null;
    const io = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < 60),
      { rootMargin: "-48px 0px 0px 0px", threshold: 0 }
    );
    const attach = () => {
      const target = main.querySelector("[data-pocket-title]") ?? main.querySelector("h1");
      if (target === observed) return;
      if (observed) io.unobserve(observed);
      observed = target;
      if (target) io.observe(target);
    };
    attach();
    // pages render their title after their data loads
    const mo = new MutationObserver(attach);
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [pathname]);

  // sticky table heads on Classic pages stop under this header, as in Standard
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
      document.documentElement.style.setProperty("--pocket-top", `${el.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // blurred figures: an attribute on <html>, removed whenever Pocket isn't showing
  useEffect(() => {
    const root = document.documentElement;
    if (hideAmounts) root.dataset.hideAmounts = "on";
    else delete root.dataset.hideAmounts;
    return () => {
      delete root.dataset.hideAmounts;
    };
  }, [hideAmounts]);

  // a phone with a keyboard: the same shortcuts as Standard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (document.querySelector("[data-pocket-sheet-root]")) return;
      if (e.key === "n") {
        e.preventDefault();
        setAddRequest({ mode: "expense" });
      } else if (e.key === "t") {
        e.preventDefault();
        setAddRequest({ mode: "transfer" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const balances = useMemo(
    () => (accounts.data && transactions.data ? computeBalances(accounts.data, transactions.data, goldRatiosOf(rates.data)) : new Map<string, number>()),
    [accounts.data, transactions.data, rates.data]
  );
  const adjustable = (accounts.data ?? []).filter(
    (a) => !a.archived && a.kind !== "credit_card" && !(a.kind === "gold" && (a.holdings?.length ?? 0) > 0)
  );
  const visible = new Set([slots.home, slots.activity, slots.fourth, ...slots.more].filter(Boolean).map((i) => i!.href));
  const coversFor = (cardId: string) =>
    book ? book.uncovered(cardId).filter((c) => c.dueDate.slice(0, 7) < today.slice(0, 7)) : [];
  const dueCards = new Set(book ? cardsDueSoon(cardStandings(accounts.data ?? [], book, today), 7).map((s) => s.account.id) : []);

  const tab = (item: NavItem | null, slot: "home" | "activity" | "fourth", label?: string, badge?: ReactNode) => {
    if (!item) return <span />;
    const on = active === slot;
    const name = label ?? t(item.key);
    return (
      <Link
        href={item.href}
        aria-current={on ? "page" : undefined}
        aria-label={name}
        className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 ${
          on ? "text-teal-600 dark:text-teal-400" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        <span className="relative">
          <Icon name={navIcon(item.href)} size={22} />
          {badge}
        </span>
        <span aria-hidden className="w-full truncate text-center text-[11px] font-medium">
          {name}
        </span>
      </Link>
    );
  };

  const overdueBadge =
    overdue > 0 ? (
      <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
        {overdue > 9 ? "9+" : overdue}
      </span>
    ) : null;
  const dot = <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-red-600" />;
  const moreHasCards = slots.more.some((i) => i.href === "/cards");
  const currentMore = slots.more.find((i) => active === "more" && (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)));

  // long-press on + opens the menu; a tap opens Expense
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number }>({ timer: null, fired: false, x: 0, y: 0 });
  const plusHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      press.current.fired = false;
      // only a primary press is a long-press; a right click opens the menu through onContextMenu
      if (e.button !== 0) return;
      press.current.x = e.clientX;
      press.current.y = e.clientY;
      press.current.timer = setTimeout(() => {
        press.current.fired = true;
        navigator.vibrate?.(10);
        setSheet("menu");
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.current.timer && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) {
        clearTimeout(press.current.timer);
        press.current.timer = null;
      }
    },
    onPointerUp: () => {
      if (press.current.timer) clearTimeout(press.current.timer);
      press.current.timer = null;
    },
    onPointerCancel: () => {
      if (press.current.timer) clearTimeout(press.current.timer);
      press.current.timer = null;
    },
    onClick: () => {
      if (press.current.fired) return;
      setAddRequest({ mode: "expense" });
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      // the menu opens now: a pending long-press must not reopen it after an item was chosen
      if (press.current.timer) clearTimeout(press.current.timer);
      press.current.timer = null;
      setSheet("menu");
    },
  };

  const lastFetched = rates.data ? new Date(rates.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const stale = rates.data != null && isStaleTable(rates.data);

  return (
    <PocketChromeContext.Provider value={chrome}>
      <div className="min-h-screen" data-pocket-shell>
        {sync}
        <header
          ref={headerRef}
          data-pocket-header
          data-condensed={condensed ? "" : undefined}
          className={`no-print sticky top-0 z-40 flex h-[calc(44px+env(safe-area-inset-top))] items-center gap-1 bg-[var(--page)]/90 px-1 pt-[env(safe-area-inset-top)] backdrop-blur transition-[border-color] duration-150 ${
            condensed ? "border-b border-[var(--edge)]" : "border-b border-transparent"
          }`}
        >
          <div className="flex w-[88px] shrink-0 items-center">
            {header.back ? (
              <button
                type="button"
                onClick={header.back.onBack}
                aria-label={t("pocket.back")}
                className="flex h-11 min-w-11 items-center gap-0.5 rounded-full pl-1 pr-2 text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
              >
                <Icon name="back" size={22} />
                <span className="max-w-[56px] truncate text-[15px]">{header.back.label}</span>
              </button>
            ) : isDemo ? (
              <button
                type="button"
                onClick={() => setSheet("demo")}
                className="ml-2 flex h-11 items-center"
                aria-haspopup="dialog"
              >
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {t("pocket.demo")}
                </span>
              </button>
            ) : null}
          </div>
          <div
            aria-hidden
            className={`min-w-0 flex-1 truncate text-center text-[15px] font-semibold transition-opacity duration-150 ${
              condensed ? "opacity-100" : "opacity-0"
            }`}
          >
            {header.condensed ?? header.title ?? ""}
          </div>
          <div className="flex w-[132px] shrink-0 items-center justify-end">
            {header.action}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("pocket.search")}
              className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-600 active:bg-[var(--edge-soft)] dark:text-zinc-300"
            >
              <Icon name="search" size={20} />
            </button>
            <button
              type="button"
              onClick={() => setSheet("currency")}
              aria-haspopup="dialog"
              aria-label={`${t("settings.displayCurrency")}: ${displayCurrency}`}
              className="flex h-11 items-center px-1"
            >
              <span className={`flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium ${stale ? "border-amber-400 text-amber-700 dark:text-amber-300" : "border-[var(--edge)]"}`}>
                {displayCurrency === "XAU_G" ? "g" : displayCurrency}
                <span aria-hidden className="text-[9px] opacity-60">▼</span>
              </span>
            </button>
          </div>
        </header>

        <main ref={mainRef} className="px-4 pt-1 pb-[calc(var(--pocket-bottom,56px)+var(--pocket-float,0px)+1.5rem)]">
          {DESK_NOTE.has(pathname) && !noteDismissed ? (
            <div className="mb-3">
              <NoteCard onDismiss={() => dismissNote(true)}>{t("pocket.bestOnLarger")}</NoteCard>
            </div>
          ) : null}
          {children}
        </main>

        <Snackbar />

        <nav
          aria-label={t("pocket.tabs")}
          className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--edge)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          {tab(slots.home, "home")}
          {tab(slots.activity, "activity", slots.activity?.href === "/transactions" ? t("pocket.activityTab") : undefined, overdueBadge)}
          <div className="flex items-start justify-center">
            <button
              type="button"
              aria-label={t("pocket.addButton")}
              aria-haspopup="dialog"
              className="-mt-2.5 flex h-[52px] w-[52px] touch-none select-none items-center justify-center rounded-[var(--pocket-fab-radius,9999px)] bg-teal-600 text-white shadow-lg ring-4 ring-[var(--surface)] transition-transform active:scale-95 dark:bg-teal-500 dark:text-zinc-950"
              {...plusHandlers}
            >
              <Icon name="plus" size={26} />
            </button>
          </div>
          {tab(slots.fourth, "fourth", undefined, slots.fourth?.href === "/cards" && cardsDot ? dot : null)}
          <button
            type="button"
            onClick={() => setSheet("more")}
            aria-haspopup="dialog"
            aria-expanded={sheet === "more"}
            aria-label={currentMore ? t("pocket.moreCurrent", { page: t(currentMore.key) }) : t("nav.more")}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 ${
              active === "more" || sheet === "more" ? "text-teal-600 dark:text-teal-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <span className="relative">
              <Icon name="more" size={22} />
              {moreHasCards && cardsDot ? dot : null}
            </span>
            <span aria-hidden className="text-[11px] font-medium">
              {t("nav.more")}
            </span>
          </button>
        </nav>

        {/* More: every other page, then the way back to Standard */}
        <PocketSheet open={sheet === "more"} onClose={() => setSheet(null)} title={t("nav.more")}>
          <div className="grid grid-cols-3 gap-2">
            {slots.more.map((item) => {
              const on = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheet(null)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-[var(--ui-card-radius)] border border-[var(--edge)] px-2 py-3 text-xs font-medium ${
                    on ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" : "text-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  <span className="relative">
                    <Icon name={navIcon(item.href)} size={24} />
                    {item.href === "/cards" && cardsDot ? dot : null}
                  </span>
                  <span className="text-center">{t(item.key)}</span>
                </Link>
              );
            })}
          </div>
          <ul className="mt-4 divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
            <li>
              <button
                type="button"
                onClick={() => {
                  setSheet(null);
                  try {
                    window.localStorage.setItem("renovator-settings-tab", "preferences");
                  } catch {
                    // the page opens on its last tab instead
                  }
                  if (pathname === "/settings") window.dispatchEvent(new Event(SHOW_PHONE_LAYOUT_EVENT));
                  else router.push(`/settings#${PHONE_LAYOUT_ANCHOR}`);
                }}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-[var(--edge-soft)]"
              >
                <Icon name="phone" size={20} className="text-zinc-500" />
                <span className="flex-1">{t("pocket.phoneLayoutRow")}</span>
                <Icon name="chevron" size={18} className="text-zinc-400" />
              </button>
            </li>
            {isDemo ? (
              <li>
                <button
                  type="button"
                  onClick={() => signOut().then(() => router.replace("/login"))}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-[var(--edge-soft)]"
                >
                  <Icon name="logout" size={20} className="text-zinc-500" />
                  <span className="flex-1">{t("auth.exitDemo")}</span>
                </button>
              </li>
            ) : (
              <li>
                <button
                  type="button"
                  onClick={() => signOut().then(() => router.replace("/login"))}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-[var(--edge-soft)]"
                >
                  <Icon name="logout" size={20} className="text-zinc-500" />
                  <span className="flex-1">{t("nav.logout")}</span>
                </button>
              </li>
            )}
          </ul>
        </PocketSheet>

        {/* display currency and rates: also Pocket's way to refresh them */}
        <PocketSheet open={sheet === "currency"} onClose={() => setSheet(null)} title={t("settings.displayCurrency")}>
          <div role="radiogroup" aria-label={t("settings.displayCurrency")} className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
            {CURRENCIES.map((c: Currency) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={displayCurrency === c}
                onClick={() => {
                  setDisplayCurrency(c);
                  setSheet(null);
                }}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left active:bg-[var(--edge-soft)]"
              >
                <span className="w-16 text-sm font-semibold">{c === "XAU_G" ? "GOLD g" : c}</span>
                <span className="flex-1 truncate text-sm text-zinc-500">{t(`currency.${c}`)}</span>
                {displayCurrency === c ? <Icon name="check" size={20} className="text-teal-600 dark:text-teal-400" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className={`text-xs ${stale ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>
              {lastFetched ? `${t("common.ratesUpdated")} ${lastFetched}${stale ? ` (${t("common.stale")})` : ""}` : null}
            </span>
            <button
              type="button"
              onClick={() => void queryClient.invalidateQueries({ queryKey: KEYS.rates })}
              className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              <Icon name="refresh" size={18} />
              {t("pocket.refreshRates")}
            </button>
          </div>
        </PocketSheet>

        <PocketSheet open={sheet === "demo"} onClose={() => setSheet(null)} title={t("pocket.demo")}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("auth.demoBanner")}</p>
          <button
            type="button"
            onClick={() => signOut().then(() => router.replace("/login"))}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-xl bg-teal-600 text-[15px] font-semibold text-white dark:bg-teal-500 dark:text-zinc-950"
          >
            {t("auth.exitDemo")}
          </button>
        </PocketSheet>

        {/* every kind of entry; the + itself opens Expense */}
        <PocketActionSheet
          open={sheet === "menu"}
          onClose={() => setSheet(null)}
          title={t("pocket.addMenu")}
          items={[
            { label: t("pocket.expense"), icon: "arrowUp", tone: "primary", onSelect: () => chrome.openAdd({ mode: "expense" }) },
            { label: t("pocket.income"), icon: "arrowDown", onSelect: () => chrome.openAdd({ mode: "income" }) },
            { label: t("pocket.transfer"), icon: "transfer", onSelect: () => chrome.openAdd({ mode: "transfer" }) },
            ...(activeCards.length > 0
              ? [
                  {
                    label: t("pocket.cardPayment"),
                    icon: "card" as const,
                    onSelect: () => {
                      if (activeCards.length === 1) {
                        setSheet(null);
                        setPaying(activeCards[0]);
                      } else setSheet("pickCard");
                    },
                  },
                ]
              : []),
            ...(visible.has("/cards")
              ? [{ label: t("pocket.cardPurchase"), icon: "card" as const, onSelect: () => openForm("/cards?add=purchase") }]
              : []),
            ...(visible.has("/victvs")
              ? [{ label: t("pocket.victvsSession"), icon: "checkCircle" as const, onSelect: () => openForm("/victvs?add=session") }]
              : []),
            ...(adjustable.length > 0 ? [{ label: t("pocket.adjust"), icon: "adjust" as const, onSelect: () => setSheet("pickAccount") }] : []),
          ]}
        />

        <PocketActionSheet
          open={sheet === "pickCard"}
          onClose={() => setSheet(null)}
          title={t("pocket.chooseCard")}
          items={activeCards.map((card) => ({
            label: card.name,
            icon: "card" as const,
            hint: dueCards.has(card.id) ? t("pocket.statementDue") : undefined,
            onSelect: () => {
              setSheet(null);
              setPaying(card);
            },
          }))}
        />

        <PocketActionSheet
          open={sheet === "pickAccount"}
          onClose={() => setSheet(null)}
          title={t("pocket.chooseAccount")}
          items={adjustable.map((account) => ({
            label: account.name,
            icon: navIcon("/accounts"),
            hint: formatSigned(balances.get(account.id) ?? 0, account.currency, locale),
            onSelect: () => {
              setSheet(null);
              setAdjusting(account);
            },
          }))}
        />

        <AddSheet request={addRequest} onClose={() => setAddRequest(null)} />
        <CardPaymentModal
          card={paying}
          suggested={paying ? Math.max(0, coversFor(paying.id).reduce((sum, c) => sum + chargeAmount(c), 0)) : 0}
          covers={paying ? coversFor(paying.id) : []}
          onClose={() => setPaying(null)}
        />
        <AdjustBalanceModal
          open={adjusting != null}
          account={adjusting}
          balance={adjusting ? (balances.get(adjusting.id) ?? 0) : 0}
          onClose={() => setAdjusting(null)}
        />
        {paletteOpen ? (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onNewTransaction={() => setAddRequest({ mode: "expense" })}
            onNewTransfer={() => setAddRequest({ mode: "transfer" })}
          />
        ) : null}
      </div>
    </PocketChromeContext.Provider>
  );
}

function Snackbar() {
  const snack = useSnack();
  if (!snack) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-3 z-[45] flex min-h-12 items-center gap-3 rounded-xl bg-zinc-900 px-4 text-sm text-zinc-50 shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      style={{ bottom: "calc(var(--pocket-bottom, 56px) + var(--pocket-float, 0px) + 8px)" }}
    >
      <span className="min-w-0 flex-1 truncate">{snack.text}</span>
      {snack.action ? (
        <button
          type="button"
          onClick={() => {
            snack.action!.run();
            dismissSnack(snack.id);
          }}
          className="-mr-2 flex h-11 items-center rounded-lg px-2 font-semibold text-teal-300 dark:text-teal-700"
        >
          {snack.action.label}
        </button>
      ) : null}
    </div>
  );
}
