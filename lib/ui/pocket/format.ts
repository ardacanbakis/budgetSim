import { Currency, formatAmount } from "@/lib/domain/currencies";

/**
 * Money as Pocket writes it: the sign before the symbol ("−₺2,800.00", not
 * formatAmount's "₺-2,800.00"), a true minus sign, and never "−0" — anything
 * that rounds to zero at the currency's precision shows unsigned.
 */
export type MoneySign = "in" | "out" | "auto" | "none";

export function formatSigned(amount: number, currency: Currency, locale: string, sign: MoneySign = "auto"): string {
  const body = formatAmount(Math.abs(amount), currency, locale);
  const zero = formatAmount(0, currency, locale) === body;
  if (zero || sign === "none") return body;
  if (sign === "in") return `+${body}`;
  if (sign === "out") return `−${body}`;
  return amount < 0 ? `−${body}` : body;
}

/** The signed amount of a ledger row: income adds, expense takes away. */
export function formatRow(direction: "income" | "expense", amount: number, currency: Currency, locale: string): string {
  return formatSigned(amount, currency, locale, direction === "income" ? "in" : "out");
}

/**
 * Short form for the "≈" line under a native figure: "≈ $1.2K", "≈ ₺1,25 Mn".
 * Only ever secondary: the native figure above it is the exact one.
 */
export function formatCompact(amount: number, currency: Currency, locale: string): string {
  if (Math.abs(amount) < 10_000) return formatSigned(amount, currency, locale);
  const n = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? "−" : "";
  if (currency === "BTC") return `${sign}${n} ₿`;
  if (currency === "XAU_G") return `${sign}${n} g`;
  const symbol = formatAmount(0, currency, locale).replace(/[\d.,\s]/g, "");
  return `${sign}${symbol}${n}`;
}
