"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/** one grid row, in pixels — a card's height is a whole number of these */
const ROW_PX = 128;
export const GRID_COLUMNS = 4;
const MAX_ROWS = 12;
/** matches the grid `gap-4` — needed to work a cell size back out of a rect */
const GAP_PX = 16;

export interface CardSize {
  /** columns spanned, 1–4 */
  w: number;
  /** rows spanned, 1–12 */
  h: number;
}

export interface GridLayout {
  order: string[];
  hidden: string[];
  size: Record<string, CardSize>;
}

export interface GridBlock {
  id: string;
  title: string;
  node: ReactNode;
  /** used the first time this card is placed */
  defaultSize: CardSize;
}

const LAYOUT_KEY = "renovator-planner-grid-v1";

const clampW = (n: number) => Math.min(GRID_COLUMNS, Math.max(1, n));
const clampH = (n: number) => Math.min(MAX_ROWS, Math.max(1, n));

/**
 * The custom Planner arrangement, kept on this device: which cards are shown,
 * in what order, and how many grid cells each one takes. A layout only exists
 * once you've made one, which is what lets the page default to it.
 */
export function usePlannerGrid() {
  const [layout, setLayout] = useState<GridLayout | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(LAYOUT_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as GridLayout;
          if (Array.isArray(saved.order)) {
            setLayout({ order: saved.order, hidden: saved.hidden ?? [], size: saved.size ?? {} });
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

  /** start from the current default arrangement rather than an empty canvas */
  function start(blocks: GridBlock[]) {
    save({
      order: blocks.map((b) => b.id),
      hidden: [],
      size: Object.fromEntries(blocks.map((b) => [b.id, b.defaultSize])),
    });
  }

  function reset() {
    window.localStorage.removeItem(LAYOUT_KEY);
    setLayout(null);
  }

  return { layout, loaded, save, start, reset };
}

/** Cards the layout doesn't mention yet (added by a later version) go last. */
function resolve(blocks: GridBlock[], layout: GridLayout) {
  const known = new Set(layout.order);
  const order = [...layout.order.filter((id) => blocks.some((b) => b.id === id))];
  for (const b of blocks) if (!known.has(b.id)) order.push(b.id);
  return order;
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = new Map(blocks.map((b) => [b.id, b]));

  const order = resolve(blocks, layout);
  const hidden = new Set(layout.hidden);
  const visible = order.filter((id) => !hidden.has(id));
  const sizeOf = (id: string): CardSize => layout.size[id] ?? byId.get(id)?.defaultSize ?? { w: 2, h: 2 };

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = visible.indexOf(String(active.id));
    const to = visible.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = arrayMove(visible, from, to);
    // hidden cards keep their place at the end so unhiding is predictable
    onChange({ ...layout, order: [...moved, ...order.filter((id) => hidden.has(id))] });
  }

  function resize(id: string, next: CardSize) {
    onChange({
      ...layout,
      size: { ...layout.size, [id]: { w: clampW(next.w), h: clampH(next.h) } },
    });
  }

  const grid = (
    <div
      className="relative grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW_PX}px`,
      }}
    >
      {/* while editing, show the columns you're snapping to */}
      {editing ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 grid gap-4"
          style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: GRID_COLUMNS }, (_, i) => (
            <div key={i} className="rounded-xl border border-dashed border-[var(--edge)]" />
          ))}
        </div>
      ) : null}
      {visible.map((id) => {
        const block = byId.get(id);
        if (!block) return null;
        return (
          <GridCard
            key={id}
            id={id}
            title={block.title}
            size={sizeOf(id)}
            editing={editing}
            onResize={(next) => resize(id, next)}
            onHide={() => onChange({ ...layout, hidden: [...layout.hidden, id] })}
          >
            {block.node}
          </GridCard>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {editing ? (
        <p className="text-xs text-zinc-500">{t("plannerGrid.hint")}</p>
      ) : null}

      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : (
        grid
      )}

      {editing && hidden.size > 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--edge)] p-3">
          <p className="text-xs font-medium text-zinc-500">{t("layout.hiddenCards")}</p>
          <div className="flex flex-wrap gap-2">
            {order
              .filter((id) => hidden.has(id))
              .map((id) => (
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
  size,
  editing,
  children,
  onResize,
  onHide,
}: {
  id: string;
  title: string;
  size: CardSize;
  editing: boolean;
  children: ReactNode;
  onResize: (next: CardSize) => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });
  const box = useRef<HTMLDivElement | null>(null);
  // the size being dragged towards, so the card previews it under the cursor
  const [ghost, setGhost] = useState<CardSize | null>(null);
  const shown = ghost ?? size;

  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      box.current = node;
      setNodeRef(node);
    },
    [setNodeRef]
  );

  /** Size the card to exactly the height its content wants. */
  function fitHeight() {
    const content = box.current?.querySelector("[data-grid-card]");
    const card = box.current;
    if (!content || !card) return;
    const chrome = card.getBoundingClientRect().height - content.getBoundingClientRect().height;
    const wanted = content.scrollHeight + chrome;
    onResize({ ...size, h: clampH(Math.ceil((wanted + GAP_PX) / (ROW_PX + GAP_PX))) });
  }

  /** Drag the corner: the card resizes in whole cells, live, under the cursor. */
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    // a cell is the card's span minus the gaps between the cells it covers
    const cellW = (rect.width + GAP_PX) / size.w;
    const cellH = (rect.height + GAP_PX) / size.h;
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = size;

    const move = (ev: PointerEvent) => {
      const next = {
        w: clampW(Math.round((rect.width + (ev.clientX - startX) + GAP_PX) / cellW)),
        h: clampH(Math.round((rect.height + (ev.clientY - startY) + GAP_PX) / cellH)),
      };
      if (next.w !== latest.w || next.h !== latest.h) {
        latest = next;
        setGhost(next);
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setGhost(null);
      if (latest.w !== size.w || latest.h !== size.h) onResize(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  return (
    <div
      ref={attachRef}
      data-card={id}
      data-size={`${shown.w}x${shown.h}`}
      style={{
        gridColumn: `span ${shown.w}`,
        gridRow: `span ${shown.h}`,
        transform: CSS.Transform.toString(transform),
        transition: ghost ? "none" : transition,
        zIndex: isDragging || ghost ? 30 : undefined,
      }}
      className={`relative flex min-h-0 min-w-0 flex-col ${isDragging ? "opacity-70" : ""} ${
        ghost ? "ring-2 ring-teal-500" : ""
      }`}
    >
      {editing ? (
        <div className="mb-1 flex items-center gap-0.5 rounded-lg bg-[var(--edge-soft)] pr-1">
          {/* the whole strip drags, not a four-pixel glyph */}
          <button
            {...attributes}
            {...listeners}
            aria-label={t("plannerGrid.move", { title })}
            className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 px-2 py-1.5 text-left active:cursor-grabbing"
          >
            <span className="text-zinc-400">⠿</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</span>
          </button>
          <span className="px-1 text-[10px] text-zinc-400 tabular-nums">
            {shown.w}×{shown.h}
          </span>
          <button
            aria-label={t("plannerGrid.narrower", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={size.w <= 1}
            onClick={() => onResize({ ...size, w: size.w - 1 })}
          >
            ←
          </button>
          <button
            aria-label={t("plannerGrid.wider", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={size.w >= GRID_COLUMNS}
            onClick={() => onResize({ ...size, w: size.w + 1 })}
          >
            →
          </button>
          <button
            aria-label={t("plannerGrid.fit", { title })}
            title={t("plannerGrid.fit", { title })}
            className="px-1 text-zinc-500"
            onClick={fitHeight}
          >
            ⇕
          </button>
          <button
            aria-label={t("plannerGrid.shorter", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={size.h <= 1}
            onClick={() => onResize({ ...size, h: size.h - 1 })}
          >
            ↑
          </button>
          <button
            aria-label={t("plannerGrid.taller", { title })}
            className="px-1 text-zinc-500 disabled:opacity-30"
            disabled={size.h >= MAX_ROWS}
            onClick={() => onResize({ ...size, h: size.h + 1 })}
          >
            ↓
          </button>
          <button aria-label={t("plannerGrid.hideCard", { title })} className="px-1 text-zinc-500" onClick={onHide}>
            ✕
          </button>
        </div>
      ) : null}

      {/* the card owns the cell: anything taller than its rows scrolls inside */}
      <div data-grid-card className="min-h-0 flex-1 overflow-auto">{children}</div>

      {editing ? (
        <button
          aria-label={t("plannerGrid.resize", { title })}
          onPointerDown={startResize}
          className="absolute -bottom-1 -right-1 z-10 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-md bg-[var(--surface)] text-[11px] leading-none text-zinc-400 shadow ring-1 ring-[var(--edge)] hover:text-teal-600"
        >
          ⟋
        </button>
      ) : null}
    </div>
  );
}
