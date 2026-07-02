export const CURRENCIES = ["TRY", "USD", "EUR", "BTC", "XAU_G"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type CurrencyKind = "fiat" | "crypto" | "gold";

export interface CurrencyMeta {
  code: Currency;
  decimals: number;
  symbol: string;
  kind: CurrencyKind;
  /** English display name; UI translates via i18n key `currency.<code>` */
  name: string;
}

export const CURRENCY_META: Record<Currency, CurrencyMeta> = {
  TRY: { code: "TRY", decimals: 2, symbol: "₺", kind: "fiat", name: "Turkish Lira" },
  USD: { code: "USD", decimals: 2, symbol: "$", kind: "fiat", name: "US Dollar" },
  EUR: { code: "EUR", decimals: 2, symbol: "€", kind: "fiat", name: "Euro" },
  BTC: { code: "BTC", decimals: 8, symbol: "₿", kind: "crypto", name: "Bitcoin" },
  XAU_G: { code: "XAU_G", decimals: 2, symbol: "g", kind: "gold", name: "Gold (gram)" },
};

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Format an amount in its own currency, e.g. "₺1.234,56", "$1,234.56", "0.05000000 ₿", "20.00 g" */
export function formatAmount(amount: number, currency: Currency, locale: string = "en"): string {
  const meta = CURRENCY_META[currency];
  const formatted = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: Math.min(meta.decimals, 2),
    maximumFractionDigits: meta.decimals,
  }).format(amount);
  if (currency === "BTC") return `${formatted} ${meta.symbol}`;
  if (currency === "XAU_G") return `${formatted} g`;
  return `${meta.symbol}${formatted}`;
}
