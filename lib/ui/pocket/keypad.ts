import { Currency, CURRENCY_META } from "@/lib/domain/currencies";
import { parseTypedAmount, roundTo } from "@/lib/domain/money";

/**
 * The add sheet's calculator keypad, as pure functions over a string.
 *
 * The expression is stored in one canonical shape: digits, "." for the
 * decimal mark whatever the language, and the operators + − × ÷ (true minus,
 * times and divide signs). Only the display swaps in the locale's mark, so
 * "12,5" on a Turkish keypad is "12.5" here.
 *
 * Nothing is ever passed to eval: tokenize() splits the string and evaluate()
 * does × and ÷ before + and −, then rounds to the currency's precision.
 */

export type Op = "+" | "−" | "×" | "÷";
export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type KeypadKey = Digit | "." | Op | "back" | "clear";

export type Token = { kind: "num"; text: string } | { kind: "op"; op: Op };

export type Evaluation =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "divZero" | "invalid" | "tooBig" };

export const OPS: readonly Op[] = ["+", "−", "×", "÷"];

/** numeric(20,8) holds 12 integer digits (see parseTypedAmount) */
const MAX_INTEGER_DIGITS = 12;
const MAX_AMOUNT = 1e12;
/** long enough for any sum a person types on a phone */
const MAX_LENGTH = 48;

const OP_ALIASES: Record<string, Op> = {
  "+": "+",
  "−": "−",
  "-": "−",
  "–": "−",
  "×": "×",
  "*": "×",
  x: "×",
  X: "×",
  "÷": "÷",
  "/": "÷",
};

/** What the decimal key shows: "," in Turkish, "." otherwise. It always stores ".". */
export function decimalMark(locale: string): "," | "." {
  return locale === "tr" ? "," : ".";
}

const isOp = (c: string): c is Op => (OPS as readonly string[]).includes(c);

/**
 * The expression's numbers and operators, in order. Accepts the ASCII
 * lookalikes (- * / x) too. Null when it holds anything else.
 */
export function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let num = "";
  for (const ch of expr.replace(/\s+/g, "")) {
    const op = OP_ALIASES[ch];
    if (op) {
      if (num) tokens.push({ kind: "num", text: num });
      num = "";
      tokens.push({ kind: "op", op });
    } else if (/[\d.]/.test(ch)) {
      num += ch;
    } else {
      return null;
    }
  }
  if (num) tokens.push({ kind: "num", text: num });
  return tokens;
}

/** True once the expression has an operator between two numbers: worth showing "= result". */
export function hasOperator(expr: string): boolean {
  const tokens = tokenize(expr);
  if (!tokens) return false;
  return tokens.some((t, i) => t.kind === "op" && i > 0 && i < tokens.length - 1);
}

function numberOf(text: string): number {
  if (text === ".") return 0;
  if (!/^\d*\.?\d*$/.test(text)) return Number.NaN;
  return Number(text);
}

/**
 * The expression's value in the currency's precision (8 decimals for BTC,
 * 2 for everything else). A trailing operator is ignored while it waits for
 * its number, so "120+" reads as 120. Dividing by zero is refused, not
 * Infinity.
 */
export function evaluate(expr: string, currency: Currency): Evaluation {
  const tokens = tokenize(expr);
  if (!tokens) return { ok: false, reason: "invalid" };
  // a dangling operator is still being typed
  while (tokens.length && tokens[tokens.length - 1].kind === "op") tokens.pop();
  if (tokens.length === 0) return { ok: false, reason: "empty" };
  if (tokens[0].kind !== "num") return { ok: false, reason: "invalid" };

  // first pass: × and ÷ fold into the term they belong to
  const terms: number[] = [];
  const signs: Array<"+" | "−"> = [];
  let current = numberOf((tokens[0] as { text: string }).text);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const next = tokens[i + 1];
    if (op.kind !== "op" || !next || next.kind !== "num") return { ok: false, reason: "invalid" };
    const value = numberOf(next.text);
    if (op.op === "×") current *= value;
    else if (op.op === "÷") {
      if (value === 0) return { ok: false, reason: "divZero" };
      current /= value;
    } else {
      terms.push(current);
      signs.push(op.op);
      current = value;
    }
  }
  terms.push(current);

  // second pass: + and − left to right
  let total = terms[0];
  for (let i = 1; i < terms.length; i++) total = signs[i - 1] === "+" ? total + terms[i] : total - terms[i];
  if (!Number.isFinite(total)) return { ok: false, reason: "invalid" };
  if (Math.abs(total) >= MAX_AMOUNT) return { ok: false, reason: "tooBig" };
  const rounded = roundTo(total, currency);
  return { ok: true, value: Object.is(rounded, -0) ? 0 : rounded };
}

/** Each number cut to the currency's decimals: "12.345" → "12.34" for lira. */
export function clampDecimals(expr: string, currency: Currency): string {
  const decimals = CURRENCY_META[currency].decimals;
  return expr.replace(/(\d*)\.(\d*)/g, (_, whole: string, frac: string) => `${whole}.${frac.slice(0, decimals)}`);
}

/** The number being typed at the end of the expression ("" right after an operator). */
function lastNumber(expr: string): string {
  const match = /[\d.]*$/.exec(expr);
  return match ? match[0] : "";
}

/**
 * One key press. Keys that would make the expression unreadable do nothing:
 * a second decimal mark, a digit past the currency's precision, an operator
 * at the start. A second operator in a row replaces the first.
 */
export function press(expr: string, key: KeypadKey, currency: Currency): string {
  if (key === "clear") return "";
  if (key === "back") return expr.slice(0, -1);

  const decimals = CURRENCY_META[currency].decimals;
  const current = lastNumber(expr);
  const head = expr.slice(0, expr.length - current.length);

  if (isOp(key)) {
    if (expr === "") return expr;
    // "5." then + is "5+"
    const trimmed = current.endsWith(".") ? expr.slice(0, -1) : expr;
    const last = trimmed.slice(-1);
    if (isOp(last)) return trimmed.slice(0, -1) + key;
    if (trimmed === "") return trimmed;
    return trimmed.length >= MAX_LENGTH ? trimmed : trimmed + key;
  }

  if (expr.length >= MAX_LENGTH) return expr;

  if (key === ".") {
    if (decimals === 0 || current.includes(".")) return expr;
    return head + (current === "" ? "0." : current + ".");
  }

  // a digit
  const dot = current.indexOf(".");
  if (dot >= 0) {
    if (current.length - dot - 1 >= decimals) return expr;
    return expr + key;
  }
  if (current === "0") return head + key;
  if (current.length >= MAX_INTEGER_DIGITS) return expr;
  return expr + key;
}

/**
 * Free typing (the "Type instead" field, a paste) into the canonical
 * expression. Each number is read by parseTypedAmount, so "12.465,50",
 * "12,465.50" and "₺1.250" mean what they mean on the Classic forms, and
 * * / x - work as the keypad's operators. Null when it can't be read.
 */
export function normalizeDecimal(text: string, currency: Currency): string | null {
  const decimals = CURRENCY_META[currency].decimals;
  const compact = text.trim();
  if (compact === "") return "";
  const parts = compact.split(/([+\-−–×*xX÷/])/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (i % 2 === 1) {
      out += OP_ALIASES[part];
      continue;
    }
    // "120+" is fine while typing; an empty piece anywhere else is not
    if (part === "") {
      if (i === parts.length - 1 && i > 0) continue;
      return null;
    }
    const value = parseTypedAmount(part, decimals);
    if (!Number.isFinite(value) || value < 0) return null;
    out += plain(value, decimals);
  }
  return out;
}

/** A number as digits and ".", never in exponent form, without trailing zeros. */
function plain(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * The expression as the person reads it: thousands grouped and the
 * locale's decimal mark ("12.465,5 + 45" in Turkish), keeping exactly the
 * digits typed, so a trailing "," or "0" stays visible while typing.
 */
export function displayExpression(expr: string, locale: string): string {
  const tokens = tokenize(expr);
  if (!tokens) return expr;
  const group = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 0 });
  const mark = decimalMark(locale);
  return tokens
    .map((t) => {
      if (t.kind === "op") return ` ${t.op} `;
      const [whole, frac] = t.text.split(".");
      const grouped = whole === "" ? "0" : group.format(Number(whole));
      return frac === undefined ? grouped : `${grouped}${mark}${frac}`;
    })
    .join("")
    .trim();
}

/** The expression as plain text for the "Type instead" field: no grouping, the locale's mark. */
export function typedFromExpression(expr: string, locale: string): string {
  return locale === "tr" ? expr.replace(/\./g, ",") : expr;
}
