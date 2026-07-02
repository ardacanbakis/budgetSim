/**
 * Tolerant parser for VICTVS session lines pasted from confirmation emails or
 * spreadsheets. Each pasted line should carry a date, an amount (USD) and
 * whatever is left becomes the session type/description. Unrecognized lines
 * are returned as errors — never silently dropped — and the UI shows an
 * editable preview grid before anything is saved.
 */

export interface ParsedSession {
  date: string; // yyyy-mm-dd
  sessionType: string;
  amount: number;
  raw: string;
}

export interface ParseError {
  line: number;
  raw: string;
  reason: "no-date" | "no-amount" | "bad-date";
}

export interface ParseResult {
  sessions: ParsedSession[];
  errors: ParseError[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5, haziran: 6,
  temmuz: 7, agustos: 8, ağustos: 8, eylul: 9, eylül: 9, ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Try to find a date in the line; returns ISO date and the matched substring. */
function extractDate(line: string): { iso: string; match: string } | "bad" | null {
  // yyyy-mm-dd or yyyy/mm/dd
  let m = line.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
  }
  // dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy (day-first, TR/UK convention)
  m = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
  }
  // 12 Jan 2026 / 12 January 2026 / 12 Ocak 2026
  m = line.match(/\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\.?,?\s+(\d{4})\b/u);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()] ?? MONTHS[m[2].toLowerCase()];
    if (mo) {
      const [d, y] = [Number(m[1]), Number(m[3])];
      return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
    }
  }
  // Jan 12, 2026
  m = line.match(/\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) {
      const [d, y] = [Number(m[2]), Number(m[3])];
      return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
    }
  }
  return null;
}

/** Find an amount: $120, 120.50, 120,50, USD 120, 120 USD. Returns value and matched substring. */
function extractAmount(line: string): { value: number; match: string } | null {
  const patterns = [
    /(?:\$|usd\s*)\s*(\d+(?:[.,]\d{1,2})?)/i, // $120, USD 120.50
    /(\d+(?:[.,]\d{1,2})?)\s*(?:\$|usd\b)/i, // 120$, 120 USD
    /(?<![\d.,/-])(\d+(?:[.,]\d{1,2})?)(?![\d.,/-])/, // bare number not part of a date
  ];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) {
      const value = Number(m[1].replace(",", "."));
      if (Number.isFinite(value) && value > 0) return { value, match: m[0] };
    }
  }
  return null;
}

export function parseVictvsPaste(text: string): ParseResult {
  const sessions: ParsedSession[] = [];
  const errors: ParseError[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    // Header-ish lines with no digits at all are noise, not errors.
    if (!/\d/.test(line)) return;

    const date = extractDate(line);
    if (date === "bad") {
      errors.push({ line: idx + 1, raw: rawLine, reason: "bad-date" });
      return;
    }
    if (date === null) {
      errors.push({ line: idx + 1, raw: rawLine, reason: "no-date" });
      return;
    }
    const rest = line.replace(date.match, " ");
    const amount = extractAmount(rest);
    if (amount === null) {
      errors.push({ line: idx + 1, raw: rawLine, reason: "no-amount" });
      return;
    }
    const sessionType = rest
      .replace(amount.match, " ")
      .replace(/[\t|;]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,.:–—-]+|[\s,.:–—-]+$/g, "")
      .trim();
    sessions.push({
      date: date.iso,
      sessionType: sessionType || "Session",
      amount: amount.value,
      raw: rawLine,
    });
  });

  return { sessions, errors };
}
