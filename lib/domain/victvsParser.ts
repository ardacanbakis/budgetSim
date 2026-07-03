import { VictvsType } from "@/lib/data/types";

/**
 * Tolerant parser for VICTVS session lines pasted from confirmation emails or
 * spreadsheets. Recognized session types: IWCF (V3 lines), CIPS OR, CIPS CR,
 * FIFA. Supported shapes:
 *
 *   CIPS OR Exam 37324 - Wed 15 Jul 26
 *   CIPS CR Exam 36951 - Tue 21 Jul 26
 *   V3 - ONLINE - 83849, PTS, 788, Jakarta, Indonesia - 08 Jul 26 - 1500
 *   21 Jan 26 <tab> CIPS OR Exam <tab> 32138 <tab> 37.5
 *   22 Jan 26 <tab> V3 - ONLINE Al Muntazah <tab> 79668 <tab> 60
 *
 * Trailing 4-digit HHMM tokens are start times and dropped; location chatter
 * (PTS, 788, Jakarta…) is ignored. Lines without an amount get `amount: null`
 * so the UI can prefill the per-type default. Unrecognized lines are returned
 * as errors — never silently dropped.
 */

export interface ParsedSession {
  date: string; // yyyy-mm-dd
  sessionType: VictvsType;
  sessionNo: string;
  /** null = no amount on the line; caller applies the per-type default */
  amount: number | null;
  raw: string;
}

export interface ParseError {
  line: number;
  raw: string;
  reason: "no-date" | "bad-date" | "no-type";
}

export interface ParseResult {
  sessions: ParsedSession[];
  errors: ParseError[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  oca: 1, sub: 2, şub: 2, mar_: 3, nis: 4, may_: 5, haz: 6,
  tem: 7, agu: 8, ağu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
};

function monthFromName(name: string): number | undefined {
  const key = name.slice(0, 3).toLowerCase();
  return MONTHS[key];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function detectType(line: string): VictvsType | null {
  if (/CIPS\s*OR/i.test(line)) return "CIPS OR";
  if (/CIPS\s*CR/i.test(line)) return "CIPS CR";
  if (/\bV3\b|IWCF/i.test(line)) return "IWCF";
  if (/FIFA/i.test(line)) return "FIFA";
  return null;
}

/** Find a date; supports `15 Jul 26`, `08 Jul 2026`, `2026-07-15`, `15/07/2026`, weekday prefixes ignored. */
function extractDate(line: string): { iso: string; match: string } | "bad" | null {
  // 15 Jul 26 / 15 Jul 2026 (month names, 2- or 4-digit year)
  let m = line.match(/\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\.?,?\s+(\d{2}|\d{4})\b/u);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo) {
      const d = Number(m[1]);
      const yRaw = Number(m[3]);
      const y = yRaw < 100 ? 2000 + yRaw : yRaw;
      return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
    }
  }
  // yyyy-mm-dd
  m = line.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
  }
  // dd/mm/yyyy (day-first)
  m = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] } : "bad";
  }
  return null;
}

export function parseVictvsPaste(text: string): ParseResult {
  const sessions: ParsedSession[] = [];
  const errors: ParseError[] = [];

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    let line = rawLine.trim();
    if (!line) return;
    // header-ish lines without digits are noise, not errors
    if (!/\d/.test(line)) return;

    const sessionType = detectType(line);
    if (!sessionType) {
      errors.push({ line: idx + 1, raw: rawLine, reason: "no-type" });
      return;
    }

    // trailing HHMM start time (e.g. "- 1500") is dropped
    line = line.replace(/[-\s]+([01]\d|2[0-3])[0-5]\d\s*$/, "");

    const date = extractDate(line);
    if (date === "bad") {
      errors.push({ line: idx + 1, raw: rawLine, reason: "bad-date" });
      return;
    }
    if (date === null) {
      errors.push({ line: idx + 1, raw: rawLine, reason: "no-date" });
      return;
    }
    let rest = line
      .replace(date.match, " ")
      // strip type keywords so "V3" can't be misread as an amount
      .replace(/\bV3\b/gi, " ")
      .replace(/CIPS\s*(OR|CR)/gi, " ")
      .replace(/\b(IWCF|FIFA|ONLINE|Exam)\b/gi, " ");

    // session/exam number: first standalone 4-6 digit token
    const noMatch = rest.match(/\b(\d{4,6})\b/);
    const sessionNo = noMatch?.[1] ?? "";
    if (noMatch) rest = rest.replace(noMatch[0], " ");

    // amount: last small numeric token (1-3 digits, optional decimals)
    let amount: number | null = null;
    const amountMatches = [...rest.matchAll(/(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)(?![\d.,])/g)];
    for (let i = amountMatches.length - 1; i >= 0; i--) {
      const value = Number(amountMatches[i][1].replace(",", "."));
      // skip location noise like ", 788," — only trust decimals or values ≤ 500
      if (Number.isFinite(value) && value > 0 && value <= 500) {
        amount = value;
        break;
      }
    }

    sessions.push({ date: date.iso, sessionType, sessionNo, amount, raw: rawLine });
  });

  return { sessions, errors };
}
