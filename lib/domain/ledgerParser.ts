/**
 * Tolerant parser for pasted statement rows — card payments, old expenses,
 * anything you want to load as history. Like the VICTVS parser it never drops
 * a data line: whatever can be read (date, description, amount) is put into a
 * preview row and the rest is left for you to fill or delete.
 *
 * Handles both decimal conventions, because a Turkish bank export writes
 * 1.250,50 where an international one writes 1,250.50.
 */

export interface ParsedLedgerRow {
  /** yyyy-mm-dd, or "" when no date could be read */
  date: string;
  description: string;
  /** null = no amount found on the line */
  amount: number | null;
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  oca: 1, sub: 2, şub: 2, mar_tr: 3, nis: 4, may_tr: 5, haz: 6,
  tem: 7, agu: 8, ağu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Read a date anywhere in the text; day-first, as every Turkish statement is. */
export function extractLedgerDate(text: string): string {
  // 15 Mar 2025 / 15 Mart 25
  let m = text.match(/\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\.?,?\s+(\d{2}|\d{4})\b/u);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const d = Number(m[1]);
      const yRaw = Number(m[3]);
      const y = yRaw < 100 ? 2000 + yRaw : yRaw;
      if (validDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  // yyyy-mm-dd
  m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  // dd/mm/yyyy and dd.mm.yy — day-first
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    if (validDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return "";
}

/**
 * Read a money amount, working out which separator is the decimal one:
 * whichever comes last wins, and a lone dot or comma before exactly three
 * digits is a thousands separator (1.250 → 1250, not 1.25).
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[^\d.,\-]/g, "");
  const m = cleaned.match(/-?\d[\d.,]*/);
  if (!m) return null;
  let token = m[0];
  const negative = token.startsWith("-");
  token = token.replace("-", "");

  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // both present: the rightmost is the decimal point
    const decimalAt = Math.max(lastDot, lastComma);
    const whole = token.slice(0, decimalAt).replace(/[.,]/g, "");
    normalized = `${whole}.${token.slice(decimalAt + 1)}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const tail = token.slice(at + 1);
    // exactly three trailing digits = thousands grouping, not a decimal
    normalized = /^\d{3}$/.test(tail) ? token.replace(/[.,]/g, "") : `${token.slice(0, at).replace(/[.,]/g, "")}.${tail}`;
  } else {
    normalized = token;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Split into cells on tabs, or runs of 2+ spaces (spreadsheet-style columns). */
function splitCells(rawLine: string): string[] {
  if (rawLine.includes("\t")) return rawLine.split("\t").map((c) => c.trim());
  const parts = rawLine.split(/\s{2,}/).map((c) => c.trim());
  return parts.length >= 2 ? parts : [];
}

/**
 * One row per non-empty line. A line only becomes a row when it yields a date
 * or an amount, so column headers and blank separators are skipped.
 */
export function parseLedgerPaste(text: string): { rows: ParsedLedgerRow[] } {
  const rows: ParsedLedgerRow[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const date = extractLedgerDate(line);
    const cells = splitCells(line);

    let amount: number | null = null;
    let description = "";

    if (cells.length >= 2) {
      // spreadsheet paste: the amount is the rightmost cell that reads as money
      for (let i = cells.length - 1; i >= 0; i--) {
        if (extractLedgerDate(cells[i]) && cells[i].replace(/[^\d]/g, "").length <= 8) continue;
        const parsed = parseMoney(cells[i]);
        if (parsed != null && parsed !== 0) {
          amount = parsed;
          description = cells.filter((_, j) => j !== i && !extractLedgerDate(cells[j])).join(" ").trim();
          break;
        }
      }
      if (amount == null) description = cells.filter((c) => !extractLedgerDate(c)).join(" ").trim();
    } else {
      // free text: strip the date, then take the last money-looking token
      const withoutDate = date ? line.replace(/\b[\d]{1,2}[-/.][\d]{1,2}[-/.][\d]{2,4}\b|\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,}\.?,?\s+\d{2,4}\b/u, " ") : line;
      const moneyMatch = [...withoutDate.matchAll(/-?[₺$€]?\s?\d[\d.,]*/g)];
      const last = moneyMatch.at(-1);
      if (last) {
        amount = parseMoney(last[0]);
        description = withoutDate.replace(last[0], " ").replace(/\s+/g, " ").trim();
      } else {
        description = withoutDate.replace(/\s+/g, " ").trim();
      }
    }

    // header rows and noise carry neither a date nor a number
    if (!date && amount == null) continue;
    rows.push({ date, description: description.replace(/\s+/g, " ").trim(), amount, raw: line });
  }

  return { rows };
}
