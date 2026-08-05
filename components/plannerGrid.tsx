"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/** one grid row, in pixels — a card's height is a whole number of these */
const ROW_PX = 128;
export const GRID_COLUMNS = 4;
const MAX_ROWS = 16;
/** matches the grid `gap-4` — needed to work a cell size back out of a rect */
const GAP_PX = 16;

export interface CardBox {
  /** column, 0-based */
  x: number;
  /** row, 0-based */
  y: number;
  /** columns spanned, 1–4 */
  w: number;
  /** rows spanned, 1–16 */
  h: number;
}

export interface GridLayout {
  /** where each card sits; absence means it has never been placed */
  boxes: Record<string, CardBox>;
  hidden: string[];
}

export interface GridBlock {
  id: string;
  title: string;
  node: ReactNode;
  /** used the first time this card is placed */
  defaultSize: { w: number; h: number };
}

const LAYOUT_KEY = "renovator-planner-grid-v2";

const clampW = (n: number) => Math.min(GRID_COLUMNS, Math.max(1, n));
const clampH = (n: number) => Math.min(MAX_ROWS, Math.max(1, n));
const overlaps = (a: CardBox, b: CardBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Lay cards out top-to-bottom in the order given, packing them across the
 * columns. Used to seed a fresh canvas from the reading layout's order.
 */
function pack(blocks: GridBlock[]): Record<string, CardBox> {
  const boxes: Record<string, CardBox> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const b of blocks) {
    const w = clampW(b.defaultSize.w);
    const h = clampH(b.defaultSize.h);
    if (x + w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    boxes[b.id] = { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return boxes;
}

/**
 * Settle a canvas after one card moved: anything the moved card now sits on
 * top of slides down far enough to clear it, cascading. Space you deliberately
 * left empty stays empty — nothing is pulled up to fill it.
 */
export function resolveCollisions(
  boxes: Record<string, CardBox>,
  movedId: string
): Record<string, CardBox> {
  const next = { ...boxes };
  // settle in reading order so a push lands somewhere predictable
  const settle = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const others = Object.keys(next).filter((k) => k !== id);
    for (const other of others) {
      if (!overlaps(next[id], next[other])) continue;
      next[other] = { ...next[other], y: next[id].y + next[id].h };
      settle(other, seen);
    }
  };
  settle(movedId, new Set());
  return next;
}

export function usePlannerGrid() {
  const [layout, setLayout] = useState<GridLayout | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(LAYOUT_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as GridLayout;
          if (saved.boxes && typeof saved.boxes === "object") {
            setLayout({ boxes: saved.boxes, hidden: saved.hidden ?? [] });
          }
        }
      } catch {
        // unreadable → no custom layout yet
      }
      setLoaded(true);
    });
  }, []);

  function save(next: GridLayout) {
    setLayout(next);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  }

  /** start from the reading layout's arrangement rather than an empty canvas */
  function start(blocks: GridBlock[]) {
    save({ boxes: pack(blocks), hidden: [] });
  }

  function reset() {
    window.localStorage.removeItem(LAYOUT_KEY);
    setLayout(null);
  }

  return { layout, loaded, save, start, reset };
}

export function PlannerGrid({
  blocks,
  layout,
  editing,
  onChange,
}: {
  blocks: GridBlock[];
  layout: GridLayout;
  editing: boolean;
  onChange: (next: GridLayout) => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLDivElement | null>(null);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const hidden = new Set(layout.hidden);

  // a card the layout has never seen goes below everything already placed
  const boxes: Record<string, CardBox> = { ...layout.boxes };
  let floor = Object.values(boxes).reduce((m, b) => Math.max(m, b.y + b.h), 0);
  for (const b of blocks) {
    if (boxes[b.id] || hidden.has(b.id)) continue;
    boxes[b.id] = { x: 0, y: floor, w: clampW(b.defaultSize.w), h: clampH(b.defaultSize.h) };
    floor += boxes[b.id].h;
  }
  const visible = blocks.map((b) => b.id).filter((id) => !hidden.has(id));
  const rows = Math.max(1, ...visible.map((id) => boxes[id].y + boxes[id].h));

  /** the size of one cell, measured from the canvas so it survives any width */
  function cell() {
    const rect = canvas.current?.getBoundingClientRect();
    const width = rect ? (rect.width + GAP_PX) / GRID_COLUMNS : 200;
    return { w: width, h: ROW_PX + GAP_PX };
  }

  function place(id: string, box: CardBox) {
    onChange({ ...layout, boxes: resolveCollisions({ ...boxes, [id]: box }, id) });
  }

  return (
    <div className="space-y-3">
      {editing ? <p className="text-xs text-zinc-500">{t("plannerGrid.hint")}</p> : null}

      <div
        ref={canvas}
        className="relative grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_PX}px`,
        }}
      >
        {/* while editing, show the cells you're snapping to */}
        {editing
          ? Array.from({ length: GRID_COLUMNS * rows }, (_, i) => (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none rounded-xl border border-dashed border-[var(--edge)]"
                style={{ gridColumn: `${(i % GRID_COLUMNS) + 1}`, gridRow: `${Math.floor(i / GRID_COLUMNS) + 1}` }}
              />
            ))
          : null}

        {visible.map((id) => {
          const block = byId.get(id)!;
          return (
            <GridCard
              key={id}
              id={id}
              title={block.title}
              box={boxes[id]}
              editing={editing}
              cell={cell}
              onPlace={(next) => place(id, next)}
              onHide={() => onChange({ ...layout, hidden: [...layout.hidden, id] })}
            >
              {block.node}
            </GridCard>
          );
        })}
      </div>

      {editing && hidden.size > 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--edge)] p-3">
          <p className="text-xs font-medium text-zinc-500">{t("layout.hiddenCards")}</p>
          <div className="flex flex-wrap gap-2">
            {[...hidden].map((id) => (
              <Button
                key={id}
                onClick={() => onChange({ ...layout, hidden: layout.hidden.filter((h) => h !== id) })}
              >
                + {byId.get(id)?.title ?? id}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GridCard({
  id,
  title,
  box,
  editing,
  cell,
  children,
  onPlace,
  onHide,
}: {
  id: string;
  title: string;
  box: CardBox;
  editing: boolean;
  cell: () => { w: number; h: number };
  children: ReactNode;
  onPlace: (next: CardBox) => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement | null>(null);
  // where the card is being dragged towards, so it previews under the cursor
  const [ghost, setGhost] = useState<CardBox | null>(null);
  const shown = ghost ?? box;

  /** One pointer gesture, snapping to cells and committing on release. */
  const gesture = useCallback(
    (e: React.PointerEvent, compute: (dx: number, dy: number, size: { w: number; h: number }) => CardBox) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const size = cell();
      let latest = box;

      const move = (ev: PointerEvent) => {
        const next = compute(ev.clientX - startX, ev.clientY - startY, size);
        if (next.x !== latest.x || next.y !== latest.y || next.w !== latest.w || next.h !== latest.h) {
          latest = next;
          setGhost(next);
        }
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        setGhost(null);
        onPlace(latest);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [box, cell, onPlace]
  );

  const startMove = (e: React.PointerEvent) =>
    gesture(e, (dx, dy, size) => ({
      ...box,
      x: Math.max(0, Math.min(GRID_COLUMNS - box.w, box.x + Math.round(dx / size.w))),
      y: Math.max(0, box.y + Math.round(dy / size.h)),
    }));

  const startResize = (e: React.PointerEvent) =>
    gesture(e, (dx, dy, size) => ({
      ...box,
      w: Math.min(GRID_COLUMNS - box.x, clampW(box.w + Math.round(dx / size.w))),
      h: clampH(box.h + Math.round(dy / size.h)),
    }));

  /** Size the card to exactly the height its content wants. */
  function fitHeight() {
    const content = el.current?.querySelector("[data-grid-card]");
    const card = el.current;
    if (!content || !card) return;
    const chrome = card.getBoundingClientRect().height - content.getBoundingClientRect().height;
    const wanted = content.scrollHeight + chrome;
    onPlace({ ...box, h: clampH(Math.ceil((wanted + GAP_PX) / (ROW_PX + GAP_PX))) });
  }

  return (
    <div
      ref={el}
      data-card={id}
      data-box={`${shown.x},${shown.y},${shown.w},${shown.h}`}
      style={{
        gridColumn: `${shown.x + 1} / span ${shown.w}`,
        gridRow: `${shown.y + 1} / span ${shown.h}`,
      }}
      className={`relative z-0 flex min-h-0 min-w-0 flex-col ${ghost ? "z-30 ring-2 ring-teal-500" : ""}`}
    >
      {editing ? (
        <div className="mb-1 flex items-center gap-0.5 rounded-lg bg-[var(--edge-soft)] pr-1">
          <button
            onPointerDown={startMove}
            aria-label={t("plannerGrid.move", { title })}
            className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 px-2 py-1.5 text-left active:cursor-grabbing"
          >
            <span className="text-zinc-400">⠿</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</span>
          </button>
          <span className="px-1 text-[10px] text-zinc-400 tabular-nums">
            {shown.w}×{shown.h}
          </span>
          <button
            aria-label={t("plannerGrid.fit", { title })}
            title={t("plannerGrid.fit", { title })}
            className="px-1 text-zinc-500"
            onClick={fitHeight}
          >
            ⇕
          </button>
          <button
            aria-label={t("plannerGrid.narrower", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={box.w <= 1}
            onClick={() => onPlace({ ...box, w: box.w - 1 })}
          >
            ←
          </button>
          <button
            aria-label={t("plannerGrid.wider", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={box.x + box.w >= GRID_COLUMNS}
            onClick={() => onPlace({ ...box, w: box.w + 1 })}
          >
            →
          </button>
          <button
            aria-label={t("plannerGrid.shorter", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={box.h <= 1}
            onClick={() => onPlace({ ...box, h: box.h - 1 })}
          >
            ↑
          </button>
          <button
            aria-label={t("plannerGrid.taller", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={box.h >= MAX_ROWS}
            onClick={() => onPlace({ ...box, h: box.h + 1 })}
          >
            ↓
          </button>
          <button aria-label={t("plannerGrid.hideCard", { title })} className="px-1 text-zinc-500" onClick={onHide}>
            ✕
          </button>
        </div>
      ) : null}

      {/* the card owns the cell: anything taller than its rows scrolls inside */}
      <div data-grid-card className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>

      {editing ? (
        <button
          aria-label={t("plannerGrid.resize", { title })}
          onPointerDown={startResize}
          className="absolute -bottom-1 -right-1 z-10 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-md bg-[var(--surface)] text-[11px] leading-none text-zinc-400 shadow ring-1 ring-[var(--edge)] hover:text-teal-600"
        >
          ⟋
        </button>
      ) : null}
    </div>
  );
}
