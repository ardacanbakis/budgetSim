/**
 * Which provider serves which number.
 *
 * Kept apart from the fetching so the choice can be named, validated and
 * shown in Settings — "gold came from Truncgil at 16:45" is the difference
 * between trusting a figure and wondering about it.
 */

export const GOLD_SOURCES = ["auto", "truncgil", "genelpara", "collectapi"] as const;
export const FX_SOURCES = ["auto", "frankfurter", "truncgil", "genelpara"] as const;

export type GoldSourceId = (typeof GOLD_SOURCES)[number];
export type FxSourceId = (typeof FX_SOURCES)[number];

export const DEFAULT_GOLD_SOURCE: GoldSourceId = "auto";
export const DEFAULT_FX_SOURCE: FxSourceId = "auto";

export function isGoldSource(v: string): v is GoldSourceId {
  return (GOLD_SOURCES as readonly string[]).includes(v);
}

export function isFxSource(v: string): v is FxSourceId {
  return (FX_SOURCES as readonly string[]).includes(v);
}

/**
 * Order tried when the choice is "auto".
 *
 * Gold leads with the Turkish keyless providers: gram altın is quoted on the
 * Kapalıçarşı free market, which is the price anyone in Turkey actually pays,
 * and neither provider needs an account. CollectAPI stays last because it only
 * works for whoever has a key.
 *
 * The lira deliberately still leads with Frankfurter — that is the behaviour
 * the app already had, and silently swapping a reference rate for a free-market
 * one would move every historical conversion on the dashboard without anyone
 * asking for it. The Turkish sources are one click away in Settings for anyone
 * who wants the rate they'd really transact at.
 */
export const GOLD_CHAIN: Exclude<GoldSourceId, "auto">[] = ["truncgil", "genelpara", "collectapi"];
export const FX_CHAIN: Exclude<FxSourceId, "auto">[] = ["frankfurter", "truncgil", "genelpara"];

export function goldChain(pref: GoldSourceId): Exclude<GoldSourceId, "auto">[] {
  if (pref === "auto") return GOLD_CHAIN;
  // an explicit choice still falls back, otherwise picking a provider that has
  // a bad afternoon leaves you staring at the static fallback with no clue why
  return [pref, ...GOLD_CHAIN.filter((s) => s !== pref)];
}

export function fxChain(pref: FxSourceId): Exclude<FxSourceId, "auto">[] {
  if (pref === "auto") return FX_CHAIN;
  return [pref, ...FX_CHAIN.filter((s) => s !== pref)];
}

/** Endpoints, overridable without a code change if a provider moves. */
export const SOURCE_URLS = {
  truncgil: () => process.env.TRUNCGIL_URL || "https://finance.truncgil.com/api/today.json",
  genelparaGold: () => process.env.GENELPARA_GOLD_URL || "https://api.genelpara.com/embed/altin.json",
  genelparaFx: () => process.env.GENELPARA_FX_URL || "https://api.genelpara.com/embed/doviz.json",
  collectapi: () => process.env.COLLECT_API_GOLD_URL || "https://api.collectapi.com/economy/goldPrice",
};

/** What a provider is called on screen, and whether it needs setting up. */
export const SOURCE_META: Record<string, { label: string; turkish: boolean; needsKey: boolean }> = {
  truncgil: { label: "Truncgil", turkish: true, needsKey: false },
  genelpara: { label: "GenelPara", turkish: true, needsKey: false },
  collectapi: { label: "CollectAPI", turkish: true, needsKey: true },
  frankfurter: { label: "Frankfurter (ECB)", turkish: false, needsKey: false },
  coingecko: { label: "CoinGecko", turkish: false, needsKey: false },
  fallback: { label: "Offline fallback", turkish: false, needsKey: false },
  identity: { label: "—", turkish: false, needsKey: false },
};
