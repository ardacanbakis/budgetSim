/**
 * Tolerant parser for VICTVS session lines pasted from confirmation emails or
 * spreadsheets. It NEVER drops a data line: whatever can be pulled (date,
 * session number, amount, and a recognized type) is placed into a preview
 * row, and anything it can't recognize is left blank for the user to fill or
 * delete in the preview grid.
 *
 * Recognized types: IWCF (V3 / ONLINE lines), CIPS OR, CIPS CR, CIPS Webinar
 * (CIPS WEB…), FIFA. Anything else (center names like "Petrotech", "ARI") is
 * left with a blank type.
 *
 * Two shapes are handled:
 *  - Tab/multi-space columns (spreadsheet paste): Date | Center/Type | No | $
 *      23 Jan 25	V3 - ONLINE	69930	60
 *      02 Mar 25	ARI	70829	60           (type left blank)
 *      02 May 25	CIPS WEBINAR	CIPSWEB-RIMAY25	15
 *  - Free-form email lines:
 *      CIPS OR Exam 37324 - Wed 15 Jul 26
 *
 * Pure noise (month headers like "J A N U A R Y '25", the header row) is
 * skipped — a line only becomes a row when it yields a date, a session
 * number, or an amount.
 */

export interface ParsedSession {
  /** yyyy-mm-dd, or "" when no date could be read */
  date: string;
  /** one of the recognized types, or "" when unrecognized (user fills it) */
  sessionType: string;
  /** exam/session number(s) as written, e.g. "37324" or "70345 + 70495" */
  sessionNo: string;
  /** null = no amount on the line; caller may apply the per-type default */
  amount: number | null;
  raw: string;
}

export interface ParseResult {
  sessions: ParsedSession[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  oca: 1, sub: 2, şub: 2, nis: 4, haz: 6,
  tem: 7, agu: 8, ağu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
};

function monthFromName(name: string): number | undefined {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Recognize a session type from any text; "" when unknown. */
function detectType(text: string): string {
  if (/CIPS\s*WEB/i.test(text)) return "CIPS Webinar";
  if (/CIPS\s*OR/i.test(text)) return "CIPS OR";
  if (/CIPS\s*CR/i.test(text)) return "CIPS CR";
  if (/\bFIFA\b/i.test(text)) return "FIFA";
  if (/\bV3\b|IWCF|\bONLINE\b/i.test(text)) return "IWCF";
  return "";
}

/** Read a date anywhere in the text; supports 2- and 4-digit years and weekday prefixes. */
function extractDate(text: string): string {
  // 15 Jul 26 / 03 July 2025 (month name, 2- or 4-digit year)
  let m = text.match(/\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\.?,?\s+(\d{2}|\d{4})\b/u);
  if (m) {
    const mo = monthFromName(m[2]);
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
  // dd/mm/yyyy (day-first)
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return "";
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$€£]/g, " ").trim();
  const m = cleaned.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Split into cells on tabs, or runs of 2+ spaces (spreadsheet-style columns). */
function splitCells(rawLine: string): string[] {
  if (rawLine.includes("\t")) return rawLine.split("\t").map((c) => c.trim());
  const parts = rawLine.split(/\s{2,}/).map((c) => c.trim());
  return parts.length >= 3 ? parts : [];
}

function parseColumns(cells: string[], raw: string): ParsedSession | null {
  const [dateCell = "", centerCell = "", sessionCell = "", amountCell = ""] = cells;
  const date = extractDate(dateCell) || extractDate(raw);
  const sessionType = detectType(centerCell) || detectType(raw);
  // session number = the session column as written; falls back to a digit run in the line
  let sessionNo = sessionCell.trim();
  if (!/\d/.test(sessionNo)) sessionNo = raw.match(/\b\d{4,6}\b/)?.[0] ?? sessionNo;
  const amount = parseAmount(amountCell) ?? (sessionType === "CIPS Webinar" ? 15 : null);
  // only a session number that actually contains digits proves this is a data row
  if (!date && !/\d/.test(sessionNo) && amount == null) return null; // header/noise line
  return { date, sessionType, sessionNo, amount, raw };
}

function parseFreeform(rawLine: string): ParsedSession | null {
  const sessionType = detectType(rawLine);
  const date = extractDate(rawLine);
  // strip the date + type keywords so they can't be misread as number/amount
  let rest = rawLine;
  const dateMatch = rawLine.match(/\b\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,}\.?,?\s+\d{2,4}\b/u)
    ?? rawLine.match(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/)
    ?? rawLine.match(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/);
  if (dateMatch) rest = rest.replace(dateMatch[0], " ");
  rest = rest
    .replace(/\bV3\b/gi, " ")
    .replace(/CIPS\s*(OR|CR|WEB\w*)/gi, " ")
    .replace(/\b(IWCF|FIFA|ONLINE|Exam|Webinar)\b/gi, " ")
    // drop a trailing HHMM start time
    .replace(/[-\s]+([01]\d|2[0-3])[0-5]\d\s*$/, " ");

  const noMatch = rest.match(/\b(\d{4,6})\b/);
  const sessionNo = noMatch?.[1] ?? "";
  if (noMatch) rest = rest.replace(noMatch[0], " ");

  let amount: number | null = null;
  const amountMatches = [...rest.matchAll(/(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)(?![\d.,])/g)];
  for (let i = amountMatches.length - 1; i >= 0; i--) {
    const value = Number(amountMatches[i][1].replace(",", "."));
    if (Number.isFinite(value) && value > 0 && value <= 500) {
      amount = value;
      break;
    }
  }
  if (amount == null && sessionType === "CIPS Webinar") amount = 15;

  if (!date && !sessionNo && amount == null) return null;
  return { date, sessionType, sessionNo, amount, raw: rawLine };
}

export function parseVictvsPaste(text: string): ParseResult {
  const sessions: ParsedSession[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cells = splitCells(rawLine);
    const parsed = cells.length >= 2 ? parseColumns(cells, rawLine) : parseFreeform(rawLine);
    if (parsed) sessions.push(parsed);
  }
  return { sessions };
}
