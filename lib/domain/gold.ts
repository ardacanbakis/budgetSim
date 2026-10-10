/**
 * Gold the way it's held in Turkey: gram gold, has altın and bilezik by the
 * gram, coins by the piece. A gold account can hold a mix (2 tam, 5 çeyrek,
 * 50 g has, 20 g bilezik) as a list of holdings on the account.
 *
 * The account itself stays in gram gold (XAU_G), so every conversion,
 * snapshot and projection works unchanged. A holding counts as the grams of
 * gram gold it would fetch: its quantity × its price ÷ the gram price, both
 * at a dealer's buying price (alış, what you'd get selling today).
 */

export const GOLD_TYPES = [
  "gram",
  "has",
  "ayar22",
  "ayar18",
  "ayar14",
  "ceyrek",
  "yarim",
  "tam",
  "cumhuriyet",
  "ata",
  "resat",
  "hamit",
  "ikibucuk",
  "besli",
  "gremse",
] as const;

export type GoldType = (typeof GOLD_TYPES)[number];

export interface GoldHolding {
  type: GoldType;
  /** grams for gram, has and ayar gold; pieces for coins */
  qty: number;
}

/** TRY per unit (gram or piece), at a dealer's buying price */
export type GoldPrices = Partial<Record<GoldType, number>>;

export const GOLD_META: Record<
  GoldType,
  {
    unit: "g" | "pcs";
    /** the key in Truncgil's feed */
    truncgil: string;
    /**
     * a unit's buying price in grams of gram gold, from Truncgil on 6 Oct
     * 2026. Stands in when no live price is to hand: the ratios move far
     * less than the prices, since they mostly follow weight and purity.
     */
    ratio: number;
  }
> = {
  gram: { unit: "g", truncgil: "GRA", ratio: 1 },
  has: { unit: "g", truncgil: "HAS", ratio: 0.995 },
  ayar22: { unit: "g", truncgil: "YIA", ratio: 0.9158 },
  ayar18: { unit: "g", truncgil: "18AYARALTIN", ratio: 0.7331 },
  ayar14: { unit: "g", truncgil: "14AYARALTIN", ratio: 0.5724 },
  ceyrek: { unit: "pcs", truncgil: "CEYREKALTIN", ratio: 1.6067 },
  yarim: { unit: "pcs", truncgil: "YARIMALTIN", ratio: 3.2034 },
  tam: { unit: "pcs", truncgil: "TAMALTIN", ratio: 6.4268 },
  cumhuriyet: { unit: "pcs", truncgil: "CUMHURIYETALTINI", ratio: 6.6573 },
  ata: { unit: "pcs", truncgil: "ATAALTIN", ratio: 6.6277 },
  resat: { unit: "pcs", truncgil: "RESATALTIN", ratio: 6.6277 },
  hamit: { unit: "pcs", truncgil: "HAMITALTIN", ratio: 6.6277 },
  ikibucuk: { unit: "pcs", truncgil: "IKIBUCUKALTIN", ratio: 16.067 },
  besli: { unit: "pcs", truncgil: "BESLIALTIN", ratio: 32.5358 },
  gremse: { unit: "pcs", truncgil: "GREMSEALTIN", ratio: 16.067 },
};

export function isGoldType(value: unknown): value is GoldType {
  return typeof value === "string" && (GOLD_TYPES as readonly string[]).includes(value);
}

/** A holdings list as stored, with anything unreadable dropped. */
export function readHoldings(value: unknown): GoldHolding[] | null {
  if (!Array.isArray(value)) return null;
  const list = value
    .filter((h): h is { type: unknown; qty: unknown } => h != null && typeof h === "object")
    .filter((h) => isGoldType(h.type) && typeof h.qty === "number" && Number.isFinite(h.qty) && h.qty > 0)
    .map((h) => ({ type: h.type as GoldType, qty: h.qty as number }));
  return list.length ? list : null;
}

export type GoldRatios = Record<GoldType, number>;

/**
 * Each type's price in grams of gram gold: live where both prices are known,
 * else the stand-in. `gramTry` is the gram price the account itself is valued
 * at, so a mix adds up to exactly the sum of its holdings at their own
 * prices; without it, the feed's own gram price is used.
 */
export function goldRatios(prices: GoldPrices | undefined, gramTry?: number): GoldRatios {
  const gram = gramTry ?? prices?.gram;
  const ratios = {} as GoldRatios;
  for (const type of GOLD_TYPES) {
    const price = prices?.[type];
    ratios[type] = gram && gram > 0 && price && price > 0 ? price / gram : GOLD_META[type].ratio;
  }
  return ratios;
}

/** goldRatios for a rate table: its type prices, against the gram price it values gold at. */
export function goldRatiosOf(table: { usdPer: Partial<Record<string, number | null>>; goldTry?: GoldPrices } | undefined): GoldRatios {
  const gram = table?.usdPer.XAU_G;
  const lira = table?.usdPer.TRY;
  return goldRatios(table?.goldTry, gram && lira ? gram / lira : undefined);
}

/** What a list of holdings is worth in grams of gram gold. */
export function holdingsInGrams(holdings: GoldHolding[] | null | undefined, ratios: GoldRatios = goldRatios(undefined)): number {
  let grams = 0;
  for (const h of holdings ?? []) grams += h.qty * ratios[h.type];
  return grams;
}
