"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Fieldset, Input, Modal, Skeleton } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useTimers } from "@/lib/data/queries";
import { DateTimer } from "@/lib/data/types";
import {
  localMoment,
  momentParts,
  sortTimers,
  TIMER_UNITS,
  TimerKind,
  TimerPhase,
  timerState,
  TimerUnit,
  totalIn,
  unitDecimals,
} from "@/lib/domain/countdown";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";
import { useLocalChoice } from "@/lib/prefs";

const segment = (on: boolean) =>
  `flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
  }`;

const PHASE_TONE: Record<TimerPhase, "teal" | "sky" | "zinc" | "amber"> = {
  counting: "teal",
  elapsed: "sky",
  reached: "zinc",
  pending: "amber",
};

/** The clock every timer reads, ticking once a second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Countdowns to a moment ahead and counts of the time since one
 * (lib/domain/countdown.ts), stored in the timers table so every device
 * shows the same ones. Each ticks every second.
 */
export function TimersCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const timers = useTimers();
  const now = useNow();
  const [editing, setEditing] = useState<DateTimer | "new" | null>(null);

  const list = sortTimers(timers.data ?? [], now);

  return (
    <Card className={className}>
      <CardHeader
        title={t("gadgets.timers")}
        action={
          <Button variant="ghost" onClick={() => setEditing("new")}>
            + {t("gadgets.newTimer")}
          </Button>
        }
      />
      <div className="space-y-3 p-[var(--ui-card-pad-x)]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.timersHint")}</p>
        {timers.isLoading ? (
          <Skeleton rows={3} />
        ) : list.length === 0 ? (
          <EmptyState action={<Button onClick={() => setEditing("new")}>+ {t("gadgets.newTimer")}</Button>}>{t("gadgets.empty")}</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((timer) => (
              <TimerTile key={timer.id} timer={timer} now={now} onEdit={() => setEditing(timer)} />
            ))}
          </ul>
        )}
      </div>
      <TimerModal editing={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function TimerTile({ timer, now, onEdit }: { timer: DateTimer; now: number; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const formatDate = useFormatDate();
  const state = timerState(timer.kind, timer.targetAt, now);
  const parts = momentParts(timer.targetAt);
  const when = parts.time === "00:00" ? formatDate(parts.date) : `${formatDate(parts.date)} ${parts.time}`;
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const n = (v: number) => new Intl.NumberFormat(intl).format(v);
  // how this timer is shown is a view setting, so it stays on the device
  const { value: unit, setValue: setUnit } = useLocalChoice<TimerUnit>(`renovator-timer-unit-${timer.id}`, TIMER_UNITS, "parts");
  const target = Date.parse(timer.targetAt);
  const units = [
    { key: "days", value: n(state.span.days) },
    { key: "hours", value: String(state.span.hours).padStart(2, "0") },
    { key: "minutes", value: String(state.span.minutes).padStart(2, "0") },
    { key: "seconds", value: String(state.span.seconds).padStart(2, "0") },
  ];
  const calendar = state.calendar
    ? [
        state.calendar.years ? t("gadgets.years", { n: state.calendar.years }) : null,
        state.calendar.months ? t("gadgets.months", { n: state.calendar.months }) : null,
        state.calendar.days ? t("gadgets.daysShort", { n: state.calendar.days }) : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const muted = state.phase === "reached" || state.phase === "pending";

  return (
    <li data-timer className="rounded-lg border border-[var(--edge)] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 text-left text-sm font-semibold text-zinc-800 hover:text-teal-600 dark:text-zinc-100"
          aria-label={`${t("gadgets.editTimer")}: ${timer.name}`}
        >
          <span className="block truncate">{timer.name}</span>
        </button>
        <Badge tone={PHASE_TONE[state.phase]}>{t(`gadgets.badge_${state.phase}`)}</Badge>
      </div>
      {unit === "parts" ? (
        <div className={`mt-2 grid grid-cols-4 gap-1.5 ${muted ? "opacity-60" : ""}`} aria-live="off">
          {units.map((u) => (
            <div key={u.key} className="rounded-md bg-[var(--edge-soft)] px-1 py-1.5 text-center">
              <div data-unit={u.key} className="tnum text-lg font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
                {u.value}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t(`gadgets.${u.key}`)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`mt-2 rounded-md bg-[var(--edge-soft)] px-2 py-1.5 text-center ${muted ? "opacity-60" : ""}`} aria-live="off">
          <div data-total={unit} className="tnum truncate text-lg font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
            {new Intl.NumberFormat(intl, {
              minimumFractionDigits: unitDecimals(unit),
              maximumFractionDigits: unitDecimals(unit),
            }).format(totalIn(unit, now, target))}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t(`gadgets.${unit}`)}</div>
        </div>
      )}
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`gadgets.phase_${state.phase}`, { date: when })}
          {calendar ? <span className="block">{t("gadgets.calendar", { span: calendar })}</span> : null}
        </p>
        <select
          aria-label={`${t("gadgets.showAs")}: ${timer.name}`}
          title={t("gadgets.showAs")}
          value={unit}
          onChange={(e) => setUnit(e.target.value as TimerUnit)}
          className="shrink-0 rounded-md border border-[var(--edge)] bg-[var(--field)] px-1.5 py-0.5 text-xs text-zinc-600 focus:border-teal-500 focus:outline-none dark:text-zinc-300"
        >
          {TIMER_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(`gadgets.unit_${u}`)}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

function TimerModal({ editing, onClose }: { editing: DateTimer | "new" | null; onClose: () => void }) {
  const { t } = useI18n();
  const repo = useRepo();
  const open = editing != null;
  const initial = editing === "new" ? null : editing;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TimerKind>("until");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<"name" | "date" | null>(null);
  const [initialized, setInitialized] = useState<string | null>(null);

  // Forget the last form once closed, so the next open starts from `initial`
  // again instead of the previous entry's leftovers.
  const formKey = initial?.id ?? (open ? "new" : "closed");
  if (!open && initialized !== null) setInitialized(null);
  if (open && initialized !== formKey) {
    setInitialized(formKey);
    const parts = initial ? momentParts(initial.targetAt) : null;
    setName(initial?.name ?? "");
    setKind(initial?.kind ?? "until");
    setDate(parts?.date ?? "");
    setTime(parts && parts.time !== "00:00" ? parts.time : "");
    setError(null);
  }

  const save = useAppMutation(async (input: { name: string; kind: TimerKind; targetAt: string }) => {
    if (initial) await repo.updateTimer(initial.id, input);
    else await repo.createTimer(input);
  }, [KEYS.timers]);
  const remove = useAppMutation((id: string) => repo.deleteTimer(id), [KEYS.timers]);

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("gadgets.editTimer") : t("gadgets.newTimer")}>
      <form
        className="space-y-3"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError("name");
          const targetAt = localMoment(date, time);
          if (!targetAt) return setError("date");
          await save.mutateAsync({ name: name.trim(), kind, targetAt });
          onClose();
        }}
      >
        <Field label={t("gadgets.name")} error={error === "name" ? t("gadgets.nameRequired") : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("gadgets.namePlaceholder")} maxLength={80} />
        </Field>
        <Fieldset label={t("gadgets.kind")} hint={t(`gadgets.kindDesc_${kind}`)}>
          <div role="group" aria-label={t("gadgets.kind")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {(["until", "since"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={segment(kind === k)} onClick={() => setKind(k)}>
                {t(`gadgets.kind_${k}`)}
              </button>
            ))}
          </div>
        </Fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("gadgets.date")} error={error === "date" ? t("gadgets.dateRequired") : undefined}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`${t("gadgets.time")} (${t("common.optional")})`} hint={t("gadgets.timeHint")}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {initial ? (
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={async () => {
                if (!window.confirm(t("gadgets.confirmDelete", { name: initial.name }))) return;
                await remove.mutateAsync(initial.id);
                onClose();
              }}
            >
              {t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
