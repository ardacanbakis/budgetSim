"use client";

import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Account } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { useI18n } from "@/lib/i18n";

export interface SoldTotal {
  amount: number;
  value: number;
}

/**
 * The order assets get sold in, dragged rather than nudged. Each row also says
 * whether money routinely passes through that account on its way to a bill —
 * turning dollars into lira to pay a lira bill is cash management, not a raid
 * on savings, and shouldn't make a month look like trouble.
 */
export function FundingList({
  accounts,
  disabled,
  routine,
  startByAccount,
  soldByAccount,
  leftByAccount,
  locale,
  onReorder,
  onToggle,
}: {
  accounts: Account[];
  disabled: string[];
  routine: string[];
  startByAccount: Map<string, number>;
  soldByAccount: Map<string, SoldTotal>;
  leftByAccount: Record<string, number>;
  locale: string;
  onReorder: (ids: string[]) => void;
  onToggle: (id: string, key: "disabled" | "routine") => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = accounts.map((a) => a.id);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-[var(--edge-soft)]">
          {/* three numbers per row, so say which is which */}
          <li className="flex items-center gap-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            <span className="w-3.5" />
            <span className="w-4" />
            <span className="w-4" />
            <span className="min-w-0 flex-1" />
            <span className="hidden w-20 text-right sm:block">{t("planner.colStart")}</span>
            <span className="hidden w-20 text-right sm:block">{t("planner.colSold")}</span>
            <span className="w-20 text-right">{t("planner.colLeft")}</span>
          </li>
          {accounts.map((account, i) => (
            <FundingRow
              key={account.id}
              account={account}
              rank={i + 1}
              off={disabled.includes(account.id)}
              isRoutine={routine.includes(account.id)}
              start={startByAccount.get(account.id) ?? 0}
              sold={soldByAccount.get(account.id)}
              left={leftByAccount[account.id]}
              locale={locale}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </SortableContext>
      <p className="pt-1 text-[11px] text-zinc-400">{t("planner.routineHint")}</p>
    </DndContext>
  );
}

function FundingRow({
  account,
  rank,
  off,
  isRoutine,
  start,
  sold,
  left,
  locale,
  onToggle,
}: {
  account: Account;
  rank: number;
  off: boolean;
  isRoutine: boolean;
  start: number;
  sold: SoldTotal | undefined;
  left: number | undefined;
  locale: string;
  onToggle: (id: string, key: "disabled" | "routine") => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 py-2 ${isDragging ? "opacity-60" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={t("planner.reorderSource", { name: account.name })}
        className="w-3.5 cursor-grab touch-none text-zinc-400 active:cursor-grabbing"
      >
        ⠿
      </button>
      <input
        type="checkbox"
        aria-label={account.name}
        className="h-4 w-4 accent-teal-600"
        checked={!off}
        onChange={() => onToggle(account.id, "disabled")}
      />
      <span className="w-4 text-center text-xs text-zinc-400 tabular-nums">{rank}</span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={`min-w-0 truncate text-sm ${off ? "text-zinc-400 line-through" : ""}`}>
          {account.name}
        </span>
        {!off ? (
          <button
            aria-label={t("planner.routineToggle", { name: account.name })}
            aria-pressed={isRoutine}
            title={t("planner.routineHint")}
            onClick={() => onToggle(account.id, "routine")}
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              isRoutine
                ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            {t("planner.routine")}
          </button>
        ) : null}
      </span>

      {/* start → sold → left, always in the same three columns */}
      <span
        className="hidden w-20 text-right text-xs tabular-nums text-zinc-500 sm:block"
        title={t("planner.colStartHint")}
      >
        {formatAmount(start, account.currency, locale)}
      </span>
      <span
        className={`hidden w-20 text-right text-xs tabular-nums sm:block ${
          !off && sold ? (isRoutine ? "text-zinc-400" : "text-amber-600") : "text-zinc-300 dark:text-zinc-700"
        }`}
        title={t("planner.soldTotalHint")}
      >
        {!off && sold ? `−${formatAmount(sold.amount, account.currency, locale)}` : "—"}
      </span>
      <span
        data-source-left={left != null ? Math.max(0, left).toFixed(4) : undefined}
        className={`w-20 text-right text-xs tabular-nums ${
          off ? "text-zinc-300 dark:text-zinc-700" : left != null && left <= 0.005 ? "text-red-500" : "text-zinc-500"
        }`}
        title={t("planner.leftAtEnd")}
      >
        {off || left == null ? "—" : formatAmount(Math.max(0, left), account.currency, locale)}
      </span>
    </li>
  );
}
