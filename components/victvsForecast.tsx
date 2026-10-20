"use client";

import { FormEvent, useId, useMemo, useState } from "react";
import { PocketSheet } from "@/components/pocket/sheet";
import { Icon } from "@/components/pocket/icons";
import { Button } from "@/components/ui";
import { useVictvsPayouts, useVictvsSessions } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { amountForEditing, parseTypedAmount } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { forecastVictvs, VictvsForecast, VictvsMonthForecast } from "@/lib/domain/victvsForecast";
import { useI18n } from "@/lib/i18n";
import { usePocket } from "@/lib/ui/usePocket";
import { useVictvsForecastOverrides, useVictvsOverrides } from "@/lib/ui/useVictvsForecastOverrides";

/**
 * The VICTVS forecast (lib/domain/victvsForecast.ts) as a list of the months
 * ahead: what each should earn, its range across earlier years, the months it
 * stands on, and when the money should land. Shared by the VICTVS page (both
 * layouts), the Planner and the dashboard's VICTVS outlook; the caller
 * supplies the card around it.
 *
 * Where it's `editable` (the VICTVS page and the Planner), each month can
 * take your own figure: Edit opens an amount field in the row (a sheet on
 * Pocket), typed as you'd write it ("1.250,50" or "1,250.50"). A month you've
 * set shows "Your figure" with the forecast's own beside it and a Revert;
 * Revert all puts every month back. The figures are saved in the settings
 * (useVictvsForecastOverrides), so each device and every screen built on
 * the forecast (the Planner's flows, the Timeline's expected payouts) uses
 * them. Read-only, a month you've set is marked "edited".
 */

/** The forecast from the sessions and payouts on record and your own figures, null while they load. */
export function useVictvsForecast(months: number): VictvsForecast | null {
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  const overrides = useVictvsOverrides();
  return useMemo(
    () =>
      sessions.data && payouts.data
        ? forecastVictvs({ sessions: sessions.data, payouts: payouts.data, today: todayISO(), months, overrides })
        : null,
    [sessions.data, payouts.data, months, overrides]
  );
}

/** `rows` months, of which the first `initialRows` show until "Show N months" is tapped. */
export function VictvsForecastView({
  forecast,
  rows = 6,
  initialRows = rows,
  editable = false,
}: {
  forecast: VictvsForecast;
  rows?: number;
  initialRows?: number;
  /** each month can take your own figure (the VICTVS page and the Planner) */
  editable?: boolean;
}) {
  const { t, locale } = useI18n();
  const pocket = usePocket();
  const edits = useVictvsForecastOverrides();
  const [expanded, setExpanded] = useState(false);
  // the month whose figure is being typed, in the row (Classic) or a sheet (Pocket)
  const [editing, setEditing] = useState<string | null>(null);
  const usd = (n: number) => formatAmount(n, "USD", locale);
  const tag = locale === "tr" ? "tr-TR" : "en-GB";
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(tag, { month: "short", year: "numeric" });
  const shown = forecast.earnings.slice(0, expanded ? rows : Math.min(rows, initialRows));
  const top = Math.max(1, ...shown.map((e) => Math.max(e.high, e.soFar, e.auto?.high ?? 0)));
  // what the forecast itself stands on, whatever you've set over it
  const autoBases = new Set(shown.map((e) => (e.auto ?? e).basis));
  const editedCount = Object.keys(edits.overrides).length;
  const editingRow = editing ? forecast.earnings.find((e) => e.month === editing) ?? null : null;

  if (autoBases.size === 1 && autoBases.has("none") && !shown.some((e) => e.auto)) {
    return <p className="text-sm text-zinc-500" data-victvs-forecast="none">{t("victvs.forecastNone")}</p>;
  }

  const payouts = forecast.cash.slice(0, rows).filter((c) => c.expected > 0);
  const save = (month: string, amount: number) => {
    edits.set(month, amount);
    setEditing(null);
  };
  const revert = (month: string) => {
    edits.revert(month);
    setEditing(null);
  };

  return (
    <div className="space-y-3" data-victvs-forecast>
      <p className="text-xs text-zinc-500">
        {autoBases.has("recent") ? t("victvs.forecastRecent") : t("victvs.forecastSeasonal", { months: forecast.historyMonths })}
      </p>
      <ul className="space-y-2.5">
        {shown.map((e, i) => {
          const auto = e.auto ?? e;
          const own = e.basis === "manual";
          const name = monthName(e.month);
          return (
            <li key={e.month} data-forecast-month={e.month} data-edited={own ? "" : undefined}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {name}
                  {own && !editable ? (
                    <span className="ml-1.5 whitespace-nowrap rounded bg-violet-100 px-1.5 py-px text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      {t("victvs.forecastOwnEdited")}
                    </span>
                  ) : null}
                </span>
                <span className="text-right tabular-nums">
                  {own ? (
                    <>
                      {editable ? (
                        <span className="mr-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">{t("victvs.forecastOwnFigure")}</span>
                      ) : null}
                      <span className="font-semibold" data-amount data-own-figure>
                        {usd(e.expected)}
                      </span>
                      <span className="ml-1.5 text-xs text-zinc-400" data-amount data-auto-figure>
                        {t("victvs.forecastOwnBeside", { amount: usd(auto.expected) })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold" data-amount>
                        ~{usd(e.expected)}
                      </span>
                      {e.high > e.low ? (
                        <span className="ml-1.5 text-xs text-zinc-400" data-amount>
                          {usd(e.low)}–{usd(e.high)}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
              {/* the range as a pale band, the expected amount as the bar (violet when
                  it's your figure, over the forecast's own range), work so far as a line */}
              <div className="relative mt-1 h-2 rounded-full bg-[var(--edge-soft)]" aria-hidden>
                <div
                  className="absolute inset-y-0 rounded-full bg-sky-200 dark:bg-sky-900"
                  style={{ left: `${(auto.low / top) * 100}%`, width: `${((auto.high - auto.low) / top) * 100}%` }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${own ? "bg-violet-500" : "bg-sky-500"}`}
                  style={{ width: `${(e.expected / top) * 100}%`, opacity: 0.85 }}
                />
                {i === 0 && e.soFar > 0 ? (
                  <div className="absolute -inset-y-0.5 w-0.5 rounded bg-emerald-600" style={{ left: `${Math.min(100, (e.soFar / top) * 100)}%` }} />
                ) : null}
              </div>
              <div className="mt-0.5 flex items-start justify-between gap-2">
                <p className="text-xs text-zinc-400">
                  {i === 0 && e.soFar > 0 ? (
                    <span className="text-emerald-700 dark:text-emerald-400" data-amount>
                      {t("victvs.forecastSoFar", { amount: usd(e.soFar) })} ·{" "}
                    </span>
                  ) : null}
                  {/* the same months behind each row; the recent-months note once, as it's the same for all */}
                  {auto.basis === "seasonal"
                    ? auto.samples.map((s) => `${s.month.slice(0, 4)} ${usd(s.amount)}`).join(" · ")
                    : auto.basis === "recent" && (i === 0 || (shown[i - 1].auto ?? shown[i - 1]).basis !== "recent")
                      ? t("victvs.forecastFromRecent", { count: auto.samples.length })
                      : null}
                </p>
                {editable && editing !== e.month ? (
                  <span className="flex shrink-0 items-center gap-1">
                    {own ? (
                      <button
                        type="button"
                        onClick={() => revert(e.month)}
                        aria-label={t("victvs.forecastOwnRevertMonth", { month: name })}
                        className="rounded-md px-1.5 py-0.5 text-xs font-medium text-teal-700 hover:bg-[var(--edge-soft)] pocket:min-h-[44px] pocket:px-3 dark:text-teal-300"
                      >
                        {t("victvs.forecastOwnRevert")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditing(e.month)}
                      aria-label={t("victvs.forecastEditMonth", { month: name })}
                      aria-haspopup={pocket ? "dialog" : undefined}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:bg-[var(--edge-soft)] hover:text-zinc-800 pocket:min-h-[44px] pocket:px-3 dark:hover:text-zinc-200"
                    >
                      <Icon name="edit" size={14} />
                      {t("victvs.forecastEdit")}
                    </button>
                  </span>
                ) : null}
              </div>
              {editable && !pocket && editing === e.month ? (
                <InlineFigureForm
                  row={e}
                  monthName={name}
                  onSave={(amount) => save(e.month, amount)}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {!expanded && rows > initialRows && forecast.earnings.length > initialRows ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-[44px] w-full items-center justify-center rounded-lg text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("victvs.forecastMore", { count: rows })}
        </button>
      ) : null}
      {editable && editedCount > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-violet-50 px-3 py-1.5 text-xs text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
          <span>{t("victvs.forecastOwnCount", { count: editedCount })}</span>
          <button
            type="button"
            onClick={() => {
              edits.revertAll();
              setEditing(null);
            }}
            className="rounded-md px-2 py-1 font-medium hover:bg-violet-100 pocket:min-h-[44px] dark:hover:bg-violet-900"
          >
            {t("victvs.forecastOwnRevertAll")}
          </button>
        </div>
      ) : null}
      <div className="border-t border-[var(--edge-soft)] pt-2 text-xs text-zinc-500">
        <p>
          {forecast.lagDays == null
            ? t("victvs.forecastLagAssumed")
            : t("victvs.forecastLagDays", { days: Math.round(forecast.lagDays) })}
          {forecast.unpaid > 0 ? (
            <>
              {" "}
              <span data-amount>{t("victvs.forecastWaiting", { amount: usd(forecast.unpaid) })}</span>
            </>
          ) : null}
        </p>
        {payouts.length ? (
          <p className="mt-1">
            {t("victvs.forecastPayouts")}:{" "}
            {payouts.map((c, i) => (
              <span key={c.month} data-amount>
                {i > 0 ? " · " : null}
                {monthName(c.month)} ~{usd(c.expected)}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {editable && pocket && editingRow ? (
        <FigureSheet
          key={editingRow.month}
          row={editingRow}
          monthName={monthName(editingRow.month)}
          onSave={(amount) => save(editingRow.month, amount)}
          onRevert={() => revert(editingRow.month)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The typed figure for a month: starts from what the month expects now (your
 * figure, or the forecast's), read with parseTypedAmount, valid at 0 or more.
 */
function useFigureDraft(row: VictvsMonthForecast) {
  const { locale } = useI18n();
  const [text, setText] = useState(() => amountForEditing(row.expected, "USD", locale));
  const [touched, setTouched] = useState(false);
  const amount = parseTypedAmount(text, 2);
  const valid = Number.isFinite(amount) && amount >= 0;
  return {
    text,
    amount,
    valid,
    showError: touched && !valid,
    onChange: (value: string) => {
      setText(value);
      setTouched(true);
    },
    touch: () => setTouched(true),
  };
}

function InlineFigureForm({
  row,
  monthName,
  onSave,
  onCancel,
}: {
  row: VictvsMonthForecast;
  monthName: string;
  onSave: (amount: number) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const draft = useFigureDraft(row);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    draft.touch();
    if (draft.valid) onSave(draft.amount);
  };
  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="mt-2 space-y-1 rounded-lg border border-[var(--edge)] p-2"
      data-forecast-edit={row.month}
    >
      <label htmlFor={id} className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {t("victvs.forecastEditLabel", { month: monthName })}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={draft.text}
          onChange={(event) => draft.onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          aria-invalid={draft.showError}
          aria-describedby={`${id}-hint`}
          className="w-32 rounded-lg border border-[var(--edge)] bg-[var(--field)] px-3 py-1.5 text-sm tabular-nums text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100"
        />
        <Button type="submit" variant="primary" className="py-1.5">
          {t("common.save")}
        </Button>
        <Button type="button" onClick={onCancel} className="py-1.5">
          {t("common.cancel")}
        </Button>
      </div>
      <p id={`${id}-hint`} className={`text-xs ${draft.showError ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`}>
        {draft.showError
          ? t("victvs.forecastEditInvalid")
          : t("victvs.forecastEditAuto", { amount: formatAmount((row.auto ?? row).expected, "USD", locale) })}
      </p>
    </form>
  );
}

function FigureSheet({
  row,
  monthName,
  onSave,
  onRevert,
  onClose,
}: {
  row: VictvsMonthForecast;
  monthName: string;
  onSave: (amount: number) => void;
  onRevert: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const draft = useFigureDraft(row);
  const id = useId();
  const formId = `${id}-form`;
  const auto = row.auto ?? row;
  const usd = (n: number) => formatAmount(n, "USD", locale);
  return (
    <PocketSheet
      open
      onClose={onClose}
      title={t("victvs.forecastEditTitle", { month: monthName })}
      footer={
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-[var(--edge)] text-[15px] font-medium active:bg-[var(--edge-soft)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form={formId}
              className="flex min-h-[48px] flex-[2] items-center justify-center rounded-xl bg-teal-600 px-3 text-[15px] font-semibold text-white active:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950"
            >
              {t("common.save")}
            </button>
          </div>
          {row.auto ? (
            <button
              type="button"
              onClick={onRevert}
              className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl text-[15px] font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              <Icon name="undo" size={18} />
              {t("victvs.forecastOwnRevertMonth", { month: monthName })}
            </button>
          ) : null}
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        data-forecast-edit={row.month}
        onSubmit={(event) => {
          event.preventDefault();
          draft.touch();
          if (draft.valid) onSave(draft.amount);
        }}
      >
        <div className="rounded-[var(--ui-card-radius)] bg-[var(--edge-soft)] px-4 py-3 text-sm">
          <p className="font-medium" data-amount>
            {t("victvs.forecastEditAuto", { amount: usd(auto.expected) })}
            {auto.high > auto.low ? (
              <span className="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                {usd(auto.low)}–{usd(auto.high)}
              </span>
            ) : null}
          </p>
          {auto.basis === "seasonal" ? (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400" data-amount>
              {auto.samples.map((s) => `${s.month.slice(0, 4)} ${usd(s.amount)}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={id} className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("victvs.forecastEditLabel", { month: monthName })}
          </label>
          <input
            id={id}
            data-autofocus
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={draft.showError}
            aria-describedby={`${id}-hint`}
            value={draft.text}
            onChange={(event) => draft.onChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="h-12 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-base tabular-nums text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100"
          />
          <p id={`${id}-hint`} className={`text-xs ${draft.showError ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"}`}>
            {draft.showError ? t("victvs.forecastEditInvalid") : t("victvs.forecastEditHint")}
          </p>
        </div>
      </form>
    </PocketSheet>
  );
}
