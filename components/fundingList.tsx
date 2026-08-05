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
  soldByAccount,
  leftByAccount,
  locale,
  onReorder,
  onToggle,
}: {
  accounts: Account[];
  disabled: string[];
  routine: string[];
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
          {accounts.map((account, i) => (
            <FundingRow
              key={account.id}
              account={account}
              rank={i + 1}
              off={disabled.includes(account.id)}
              isRoutine={routine.includes(account.id)}
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
  sold,
  left,
  locale,
  onToggle,
}: {
  account: Account;
  rank: number;
  off: boolean;
  isRoutine: boolean;
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
        className="cursor-grab touch-none px-0.5 text-zinc-400 active:cursor-grabbing"
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
      <span className={`min-w-0 flex-1 truncate text-sm ${off ? "text-zinc-400 line-through" : ""}`}>
        {account.name}
      </span>

      {!off ? (
        <button
          aria-label={t("planner.routineToggle", { name: account.name })}
          aria-pressed={isRoutine}
          title={t("planner.routineHint")}
          onClick={() => onToggle(account.id, "routine")}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isRoutine
              ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
              : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          {t("planner.routine")}
        </button>
      ) : null}

      {!off && sold ? (
        <span
          className={`hidden text-xs tabular-nums sm:inline ${isRoutine ? "text-zinc-400" : "text-amber-600"}`}
          title={t("planner.soldTotalHint")}
        >
          −{formatAmount(sold.amount, account.currency, locale)}
        </span>
      ) : null}
      {!off && left != null ? (
        <span
          data-source-left={Math.max(0, left).toFixed(4)}
          className={`text-xs tabular-nums ${left <= 0.005 ? "text-red-500" : "text-zinc-400"}`}
          title={t("planner.leftAtEnd")}
        >
          {formatAmount(Math.max(0, left), account.currency, locale)}
        </span>
      ) : null}
    </li>
  );
}
