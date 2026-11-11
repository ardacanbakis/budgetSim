"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { CardSpendSettings } from "@/lib/domain/cardSpend";
import { useCardSpendSettings, useTypicalSpend } from "@/lib/useCardSpend";
import { useI18n } from "@/lib/i18n";

/**
 * Typical card spend: what each card costs you beyond its installments, and
 * whether the plan carries it into the months ahead.
 *
 * The figure is measured, not stored, so it follows your spending without
 * being maintained; the card shows the months behind it so the number is
 * never a black box. Carrying it is off until turned on, because it is an
 * assumption about the future and the rest of the app is not.
 */

const LOOKBACKS = [3, 6, 12] as const;

export function CardSpendCard() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const settings = useCardSpendSettings();
  const rows = useTypicalSpend();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const save = useAppMutation((patch: CardSpendSettings) => repo.saveUserSettings({ cardSpend: patch }), [KEYS.userSettings]);
  const set = (patch: Partial<CardSpendSettings>) => save.mutate({ ...settings, ...patch });
  const setOverride = (id: string, value: number | null) => {
    const overrides = { ...settings.overrides };
    if (value == null) delete overrides[id];
    else overrides[id] = value;
    set({ overrides });
  };

  const carried = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <Card>
      <CardHeader
        title={t("cardSpend.title")}
        action={
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              role="switch"
              checked={settings.on}
              disabled={save.isPending}
              onChange={(e) => set({ on: e.target.checked })}
              className="h-4 w-4 accent-teal-600"
              data-card-spend-on
            />
            {t("cardSpend.carry")}
          </label>
        }
      />
      <div className="space-y-3 p-4">
        <p className="text-xs text-zinc-500">{t("cardSpend.intro")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">{t("cardSpend.lookback")}</span>
          <div role="group" aria-label={t("cardSpend.lookback")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {LOOKBACKS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={settings.lookback === n}
                onClick={() => set({ lookback: n })}
                className={`rounded-md px-2 py-1 text-xs tnum transition-colors ${
                  settings.lookback === n
                    ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                    : "text-zinc-500 hover:bg-[var(--edge-soft)]"
                }`}
              >
                {t("cardSpend.statements", { count: n })}
              </button>
            ))}
          </div>
          {save.isPending ? <Spinner /> : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState>{t("cardSpend.empty")}</EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--edge-soft)]">
            {rows.map((row) => {
              const currency = row.account.currency;
              const money = (n: number) => formatAmount(n, currency, locale);
              const open = editing === row.account.id;
              return (
                <li key={row.account.id} className="space-y-1 py-2" data-card-spend={row.account.name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{row.account.name}</span>
                    <span className="flex items-center gap-2">
                      {row.override != null ? <Badge tone="sky">{t("cardSpend.yours")}</Badge> : null}
                      {row.value <= 0.005 ? <Badge tone="zinc">{t("cardSpend.none")}</Badge> : null}
                      <span className="font-semibold tnum">{money(row.value)}</span>
                      <Button
                        onClick={() => {
                          setEditing(open ? null : row.account.id);
                          setDraft(row.override != null ? String(row.override) : row.measured != null ? String(row.measured) : "");
                        }}
                      >
                        {open ? t("common.close") : t("cardSpend.setOwn")}
                      </Button>
                    </span>
                  </div>
                  {/* the months behind the figure, so it's never a black box */}
                  {row.months.length > 0 ? (
                    <p className="text-xs text-zinc-500">
                      {t("cardSpend.measuredFrom", {
                        list: row.months
                          .map((m) => `${m.month} ${money(m.ordinary)}`)
                          .join(" · "),
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400">{t("cardSpend.noStatements")}</p>
                  )}
                  {open ? (
                    <form
                      className="flex flex-wrap items-center gap-2 pt-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = Number(draft);
                        if (!Number.isFinite(value) || value < 0) return;
                        setOverride(row.account.id, value);
                        setEditing(null);
                      }}
                    >
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        autoFocus
                        inputMode="decimal"
                        aria-label={`${t("cardSpend.setOwn")} — ${row.account.name}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="w-32"
                      />
                      <Button type="submit" variant="primary">
                        {t("common.save")}
                      </Button>
                      {row.override != null ? (
                        <Button
                          onClick={() => {
                            setOverride(row.account.id, null);
                            setEditing(null);
                          }}
                        >
                          {t("cardSpend.useMeasured")}
                        </Button>
                      ) : null}
                      <span className="text-xs text-zinc-500">{t("cardSpend.zeroHint")}</span>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className={`text-xs ${settings.on ? "text-zinc-500" : "text-amber-600 dark:text-amber-400"}`}>
          {settings.on
            ? t("cardSpend.onHint", { amount: formatAmount(carried, rows[0]?.account.currency ?? "TRY", locale) })
            : t("cardSpend.offHint")}
        </p>
      </div>
    </Card>
  );
}
