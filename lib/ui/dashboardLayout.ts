import { DashboardAccounts, DashboardLayout } from "@/lib/data/types";

/**
 * The dashboard's card catalogue, and the layout the user keeps for it. Pure,
 * so the rules can be checked without a page; useDashboardLayout reads and
 * saves it.
 *
 * The catalogue, CARD_SPECS, in default order. Each card has:
 * - its label and one-line description, dashboard.card_<id> and
 *   dashboard.cardDesc_<id> (built from the id, so a test walks the list for
 *   both languages: t() would print a missing key as it is);
 * - defaultOn, whether it shows in each style before the user picks:
 *   Classic's card grid and the version-2 dashboard;
 * - nav, the page it belongs to: hidden from the menus, the card goes too
 *   (Pocket's rule for its VICTVS row);
 * - route, the page Classic's card opens when clicked; span, its width on
 *   Classic's grid.
 *
 * The layout (user_settings.dashboard_layout, synced across devices):
 * - order lists every card. hidden holds the cards turned off, shown the
 *   cards turned on; a card in neither follows its default for the style on
 *   screen. So a layout saved before a card existed renders as it did, with
 *   the new card off, and GoldLens (on in version 2 since it shipped, never
 *   on Classic) keeps both of those without anything being written.
 * - accounts: which accounts the dashboards list (DEFAULT_ACCOUNTS).
 * - upcomingDays: how far Upcoming looks ahead (DEFAULT_UPCOMING_DAYS).
 *
 * normalizeLayout(saved, accountIds?) reads a stored layout, or null, into
 * one with every field present and valid: unknown and repeated card ids
 * dropped, missing ones appended in catalogue order, `hidden` winning over
 * `shown`, a malformed field at its default, and hidden accounts that no
 * longer exist pruned. It spreads what was saved first, so a key a newer
 * build added survives this build's next save. It only reads: nothing goes
 * back to storage until the user changes something.
 *
 * isCardVisible / visibleCards / cardsOff, setCardVisible, moveCard and
 * resetCards work on a normalised layout; so do the account choices
 * (setAccountHidden, setHideEmpty, setAccountLimit, resetAccounts) and
 * setUpcomingDays. Each returns a new layout for useDashboardLayout's update.
 */

/** The two dashboards that arrange cards: Classic's grid and the version-2 one. */
export type DashboardStyle = "classic" | "v2";

export interface CardSpec {
  id: string;
  labelKey: string;
  descKey: string;
  defaultOn: Readonly<Record<DashboardStyle, boolean>>;
  nav?: string;
  route?: string;
  span: string;
}

function spec<Id extends string>(id: Id, rest: Omit<CardSpec, "id" | "labelKey" | "descKey">): CardSpec & { id: Id } {
  return { id, labelKey: `dashboard.card_${id}`, descKey: `dashboard.cardDesc_${id}`, ...rest };
}

const ON = { classic: true, v2: true } as const;

export const CARD_SPECS = [
  spec("net-worth", { defaultOn: ON, route: "/reports", span: "sm:col-span-1" }),
  spec("safe-to-spend", { defaultOn: ON, route: "/transactions", span: "sm:col-span-1" }),
  spec("cc-debt", { defaultOn: ON, route: "/cards", span: "sm:col-span-1" }),
  spec("victvs", { defaultOn: ON, nav: "/victvs", route: "/victvs", span: "sm:col-span-1" }),
  spec("accounts", { defaultOn: ON, route: "/accounts", span: "sm:col-span-1" }),
  spec("upcoming", { defaultOn: ON, route: "/transactions", span: "sm:col-span-2" }),
  spec("monthly-flow", { defaultOn: ON, route: "/reports", span: "sm:col-span-2" }),
  spec("budgets", { defaultOn: ON, route: "/reports", span: "sm:col-span-2 xl:col-span-1" }),
  // no route: a self-contained widget with its own modal (whose clicks would
  // bubble up into a whole-card link), and there is no goals page to open
  spec("goals", { defaultOn: ON, span: "sm:col-span-2 xl:col-span-1" }),
  spec("avg-spend", { defaultOn: ON, route: "/reports", span: "sm:col-span-2" }),
  // on in version 2 since it shipped; Classic never had it, so there it
  // starts off and waits to be turned on
  spec("gold-lens", { defaultOn: { classic: false, v2: true }, span: "sm:col-span-1" }),
] as const;

export type CardId = (typeof CARD_SPECS)[number]["id"];

export const CARD_IDS: readonly CardId[] = CARD_SPECS.map((s) => s.id);

const SPEC_BY_ID: ReadonlyMap<string, CardSpec> = new Map(CARD_SPECS.map((s) => [s.id, s]));

export const isCardId = (v: string): v is CardId => SPEC_BY_ID.has(v);

export function cardSpec(id: CardId): CardSpec {
  return SPEC_BY_ID.get(id)!;
}

export const UPCOMING_DAYS = [7, 14, 30] as const;
export type UpcomingDays = (typeof UPCOMING_DAYS)[number];
/** Upcoming's horizon before anyone picks one: the 30 days it always showed. */
export const DEFAULT_UPCOMING_DAYS: UpcomingDays = 30;

export const DEFAULT_ACCOUNTS: Readonly<DashboardAccounts> = { hidden: [], hideEmpty: false, limit: 5 };

/** A layout after normalizeLayout: every field there, every card id known. */
export interface NormalizedLayout extends DashboardLayout {
  order: CardId[];
  hidden: CardId[];
  shown: CardId[];
  accounts: DashboardAccounts;
  upcomingDays: UpcomingDays;
}

/** Known card ids from a stored list, each once, in the order given. */
function knownIds(list: unknown): CardId[] {
  if (!Array.isArray(list)) return [];
  const ids = new Set<CardId>();
  for (const value of list) if (typeof value === "string" && isCardId(value)) ids.add(value);
  return [...ids];
}

function normalizeAccounts(saved: unknown, accountIds?: Iterable<string>): DashboardAccounts {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Partial<DashboardAccounts>;
  // there's no foreign key on a jsonb list: an account deleted since is
  // dropped here, and the shorter list is written with the next change
  const exists = accountIds ? new Set(accountIds) : null;
  const hidden = Array.isArray(raw.hidden)
    ? [...new Set(raw.hidden.filter((id): id is string => typeof id === "string" && (!exists || exists.has(id))))]
    : [];
  const limit =
    raw.limit === null || (typeof raw.limit === "number" && Number.isInteger(raw.limit) && raw.limit > 0)
      ? raw.limit
      : DEFAULT_ACCOUNTS.limit;
  return {
    ...raw,
    hidden,
    hideEmpty: typeof raw.hideEmpty === "boolean" ? raw.hideEmpty : DEFAULT_ACCOUNTS.hideEmpty,
    limit,
  };
}

export function normalizeLayout(saved: DashboardLayout | null | undefined, accountIds?: Iterable<string>): NormalizedLayout {
  const raw: Partial<DashboardLayout> = saved && typeof saved === "object" ? saved : {};
  const order = knownIds(raw.order);
  for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
  const hidden = knownIds(raw.hidden);
  const shown = knownIds(raw.shown).filter((id) => !hidden.includes(id));
  const upcomingDays = UPCOMING_DAYS.find((d) => d === raw.upcomingDays) ?? DEFAULT_UPCOMING_DAYS;
  return { ...raw, order, hidden, shown, accounts: normalizeAccounts(raw.accounts, accountIds), upcomingDays };
}

/** Whether a card's page is in the menus (a card without one always is). */
export function navAllows(id: CardId, visibleHrefs: readonly string[]): boolean {
  const nav = cardSpec(id).nav;
  return !nav || visibleHrefs.includes(nav);
}

/** visibleHrefs: the pages the menus show (visibleNav in components/shell.nav.ts). */
export function isCardVisible(
  layout: NormalizedLayout,
  id: CardId,
  style: DashboardStyle,
  visibleHrefs: readonly string[]
): boolean {
  if (!navAllows(id, visibleHrefs) || layout.hidden.includes(id)) return false;
  return layout.shown.includes(id) || cardSpec(id).defaultOn[style];
}

/** The cards to draw, in order. */
export function visibleCards(layout: NormalizedLayout, style: DashboardStyle, visibleHrefs: readonly string[]): CardId[] {
  return layout.order.filter((id) => isCardVisible(layout, id, style, visibleHrefs));
}

/**
 * The cards not drawn that could be turned on here, in order: off by the
 * user or by default. A card whose page is hidden from the menus isn't one;
 * it comes back with its page.
 */
export function cardsOff(layout: NormalizedLayout, style: DashboardStyle, visibleHrefs: readonly string[]): CardId[] {
  return layout.order.filter((id) => navAllows(id, visibleHrefs) && !isCardVisible(layout, id, style, visibleHrefs));
}

/** An explicit choice, so it holds in every style whatever the card's defaults. */
export function setCardVisible(layout: NormalizedLayout, id: CardId, on: boolean): NormalizedLayout {
  const hidden = layout.hidden.filter((x) => x !== id);
  const shown = layout.shown.filter((x) => x !== id);
  return on ? { ...layout, hidden, shown: [...shown, id] } : { ...layout, hidden: [...hidden, id], shown };
}

/**
 * Moves `id` among the cards in `among` (those on screen, for the
 * dashboard's arrows and drag; every card, for a list of them all): one
 * place with −1 or +1, or onto another card's place, as a drop does. Cards
 * outside `among` keep their places in the order, so one turned off comes
 * back where it was. Past either end, or for a card not in `among`, the
 * layout comes back unchanged.
 */
export function moveCard(
  layout: NormalizedLayout,
  among: readonly CardId[],
  id: CardId,
  to: -1 | 1 | CardId
): NormalizedLayout {
  const list = layout.order.filter((x) => among.includes(x));
  const from = list.indexOf(id);
  const target = typeof to === "number" ? from + to : list.indexOf(to);
  if (from < 0 || target < 0 || target >= list.length || target === from) return layout;
  const moved = [...list];
  moved.splice(target, 0, ...moved.splice(from, 1));
  // the same slots in the order, filled in the new sequence
  let next = 0;
  const order = layout.order.map((x) => (among.includes(x) ? moved[next++] : x));
  return { ...layout, order };
}

/** Every card back to its default place and state; accounts and Upcoming's range stay. */
export function resetCards(layout: NormalizedLayout): NormalizedLayout {
  return { ...layout, order: [...CARD_IDS], hidden: [], shown: [] };
}

/* ------------------------------------------------------------- accounts */

/** One account on or off the dashboards' lists. */
export function setAccountHidden(layout: NormalizedLayout, accountId: string, hidden: boolean): NormalizedLayout {
  const rest = layout.accounts.hidden.filter((id) => id !== accountId);
  return { ...layout, accounts: { ...layout.accounts, hidden: hidden ? [...rest, accountId] : rest } };
}

export function setHideEmpty(layout: NormalizedLayout, hideEmpty: boolean): NormalizedLayout {
  return { ...layout, accounts: { ...layout.accounts, hideEmpty } };
}

/** Rows on Classic's Accounts card before "+N more"; null for all of them. */
export function setAccountLimit(layout: NormalizedLayout, limit: number | null): NormalizedLayout {
  return { ...layout, accounts: { ...layout.accounts, limit } };
}

/** Every account listed again, at the default limit; the cards stay as they are. */
export function resetAccounts(layout: NormalizedLayout): NormalizedLayout {
  return { ...layout, accounts: { ...layout.accounts, ...DEFAULT_ACCOUNTS, hidden: [] } };
}

export function setUpcomingDays(layout: NormalizedLayout, upcomingDays: UpcomingDays): NormalizedLayout {
  return { ...layout, upcomingDays };
}
