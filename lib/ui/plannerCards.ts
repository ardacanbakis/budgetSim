/**
 * The Plan page's one size system. Pure, so the rules can be checked without
 * a page; components/plannerCard.tsx draws the frame and
 * components/plannerGrid.tsx the custom canvas.
 *
 * Every card sits on the same fixed row unit (ROW_PX tall, GAP_PX between
 * rows) and declares one of a few presets instead of a size of its own:
 * - strip: the full width, one row — the headline tiles;
 * - S: a quarter of the canvas, two rows — a single control or a short list;
 * - M: half the canvas, three rows — a list you add to;
 * - L: half the canvas, four rows — the chart, the tables.
 * The reading layouts use only a preset's height (a card is a whole column
 * there); the custom canvas uses both, and its editor steps through
 * CARD_WIDTHS and CARD_HEIGHTS rather than any whole number, so whatever you
 * arrange still lines up with what the presets would have given.
 *
 * Content taller than its card scrolls inside it (with a fade and a Show all
 * button) instead of making the card taller, so the sizes hold.
 *
 * normalizeBoxes reads a canvas saved before the presets existed (any width
 * from 1 to 4, any height from 1 to 16) onto the nearest allowed size, then
 * moves down whatever the change made overlap. readingRows pairs the cards
 * of the two-column layout so cards in a row share a height.
 */

/** one row of the canvas, in pixels */
export const ROW_PX = 128;
/** between rows and columns — the grid's `gap-4` */
export const GAP_PX = 16;
export const GRID_COLUMNS = 4;

/** a quarter, half or all of the canvas */
export const CARD_WIDTHS = [1, 2, 4] as const;
/** strip, S, M, L, and one taller step for the custom canvas */
export const CARD_HEIGHTS = [1, 2, 3, 4, 6] as const;

export type CardSize = "strip" | "S" | "M" | "L";

export const CARD_SIZES: Record<CardSize, { w: number; h: number }> = {
  strip: { w: 4, h: 1 },
  S: { w: 1, h: 2 },
  M: { w: 2, h: 3 },
  L: { w: 2, h: 4 },
};

export interface CardBox {
  /** column, 0-based */
  x: number;
  /** row, 0-based */
  y: number;
  /** columns spanned: one of CARD_WIDTHS */
  w: number;
  /** rows spanned: one of CARD_HEIGHTS */
  h: number;
}

/** the height of `rows` rows, gaps included */
export function rowsToPx(rows: number): number {
  return rows * ROW_PX + Math.max(0, rows - 1) * GAP_PX;
}

/** the pixel height a preset gives a card */
export function cardHeightPx(size: CardSize): number {
  return rowsToPx(CARD_SIZES[size].h);
}

/**
 * The allowed width nearest `w` that still fits from column `x`. A tie goes
 * to the narrower, which can't run into a neighbour.
 */
export function snapWidth(w: number, x = 0): number {
  const room = Math.max(1, GRID_COLUMNS - Math.max(0, Math.min(GRID_COLUMNS - 1, x)));
  const fits = CARD_WIDTHS.filter((c) => c <= room);
  return fits.reduce((best, c) => (Math.abs(c - w) < Math.abs(best - w) ? c : best), fits[0]);
}

/** The allowed height nearest `h`. A tie goes to the taller, which hides less. */
export function snapHeight(h: number): number {
  return CARD_HEIGHTS.reduce((best, c) => (Math.abs(c - h) <= Math.abs(best - h) ? c : best), CARD_HEIGHTS[0] as number);
}

/** The smallest allowed height that holds `px` of content (the tallest if none does). */
export function heightFor(px: number): number {
  return CARD_HEIGHTS.find((h) => rowsToPx(h) >= px - 0.5) ?? CARD_HEIGHTS[CARD_HEIGHTS.length - 1];
}

/** The next allowed width up or down from `w`, or `w` itself at the end of the range or the canvas. */
export function stepWidth(w: number, by: 1 | -1, x = 0): number {
  const room = GRID_COLUMNS - x;
  const next = by > 0 ? CARD_WIDTHS.find((c) => c > w) : [...CARD_WIDTHS].reverse().find((c) => c < w);
  return next != null && next <= room ? next : w;
}

/** The next allowed height up or down from `h`, or `h` itself at the end of the range. */
export function stepHeight(h: number, by: 1 | -1): number {
  const next = by > 0 ? CARD_HEIGHTS.find((c) => c > h) : [...CARD_HEIGHTS].reverse().find((c) => c < h);
  return next ?? h;
}

const overlaps = (a: CardBox, b: CardBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const whole = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback);

/**
 * A saved canvas, onto the presets: every box at an allowed width that fits
 * where it starts and an allowed height, anything malformed dropped (it gets
 * placed again below, like a card the canvas has never seen). Cards are then
 * settled top to bottom, left to right: one that now overlaps a card above it
 * moves down just far enough to clear it. Gaps you left stay where they are.
 */
export function normalizeBoxes(saved: Record<string, unknown>): Record<string, CardBox> {
  const boxes: Record<string, CardBox> = {};
  for (const [id, raw] of Object.entries(saved ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<CardBox>;
    const x = Math.max(0, Math.min(GRID_COLUMNS - 1, whole(r.x, 0)));
    const y = Math.max(0, whole(r.y, 0));
    boxes[id] = { x, y, w: snapWidth(whole(r.w, 2), x), h: snapHeight(whole(r.h, 3)) };
  }
  const order = Object.keys(boxes).sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
  const placed: CardBox[] = [];
  for (const id of order) {
    const box = { ...boxes[id] };
    for (let hit = placed.find((p) => overlaps(p, box)); hit; hit = placed.find((p) => overlaps(p, box))) {
      box.y = hit.y + hit.h;
    }
    boxes[id] = box;
    placed.push(box);
  }
  return boxes;
}

/**
 * Lay cards out top to bottom in the order given, packing them across the
 * columns at their preset sizes. Seeds a fresh canvas from the reading order.
 */
export function packBoxes(cards: { id: string; size: CardSize }[]): Record<string, CardBox> {
  const boxes: Record<string, CardBox> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const { id, size } of cards) {
    const { w, h } = CARD_SIZES[size];
    if (x + w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    boxes[id] = { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return boxes;
}

/**
 * The two-column layout's rows. A strip has a row to itself; any other card
 * takes the next card of its own height as its partner, so a row's two cards
 * are the same size. A card left without one sits alone in its row rather
 * than stretching to a taller neighbour — and pulling a mismatched partner
 * forward would only push the mismatch on to the rows after it.
 */
export function readingRows(cards: { id: string; size: CardSize }[]): string[][] {
  const rest = [...cards];
  const rows: string[][] = [];
  while (rest.length > 0) {
    const card = rest.shift()!;
    if (card.size === "strip") {
      rows.push([card.id]);
      continue;
    }
    const height = CARD_SIZES[card.size].h;
    const partner = rest.findIndex((c) => c.size !== "strip" && CARD_SIZES[c.size].h === height);
    rows.push(partner < 0 ? [card.id] : [card.id, rest.splice(partner, 1)[0].id]);
  }
  return rows;
}

/** the height a row of the two-column layout gives its cards: its tallest preset */
export function rowHeightPx(sizes: CardSize[]): number {
  return Math.max(...sizes.map(cardHeightPx));
}
