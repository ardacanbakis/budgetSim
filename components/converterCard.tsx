"use client";

import { useState } from "react";
import { Button, Card, CardHeader, Field, Input, Select, Skeleton } from "@/components/ui";
import { Icon } from "@/components/pocket/icons";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, usePinnedConversions, useRates } from "@/lib/data/queries";
import {
  availableUnits,
  ConverterUnit,
  convertUnits,
  DEFAULT_FROM,
  DEFAULT_TO,
  formatRate,
  formatUnitAmount,
  isConverterUnit,
} from "@/lib/domain/converter";
import { isCurrency } from "@/lib/domain/currencies";
import { parseTypedAmount } from "@/lib/domain/money";
import { isStaleTable } from "@/lib/rates/fallback";
import { useI18n } from "@/lib/i18n";
import { useUnitLabels } from "@/lib/ui/useUnitLabels";

/**
 * Any amount of one unit in another, on the same rate table every account is
 * valued with (/api/rates): the five currencies, and each kind of gold the
 * feed priced today (lib/domain/converter.ts). Starts at dollars to lira;
 * the button between the sides switches them. Below it, the same amount in
 * every other unit, each a click away from being the "to" side. Conversions
 * used often can be pinned: they sit over the form, live, a click from
 * loading back into it.
 */
export function ConverterCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const rates = useRates();
  const repo = useRepo();
  const pins = usePinnedConversions();
  const { short, long } = useUnitLabels();
  const [text, setText] = useState("100");
  const [from, setFrom] = useState<ConverterUnit>(DEFAULT_FROM);
  const [to, setTo] = useState<ConverterUnit>(DEFAULT_TO);

  const table = rates.data;
  const units = availableUnits(table);
  const amount = text.trim() === "" ? 0 : parseTypedAmount(text, 8);
  const valid = Number.isFinite(amount);

  const pin = useAppMutation(
    () => repo.createPinnedConversion({ fromUnit: from, toUnit: to, amount }),
    [KEYS.pinnedConversions]
  );
  const unpin = useAppMutation((id: string) => repo.deletePinnedConversion(id), [KEYS.pinnedConversions]);
  const alreadyPinned = (pins.data ?? []).some((p) => p.fromUnit === from && p.toUnit === to && p.amount === amount);
  // a pin of a unit today's feed doesn't price (a coin it skipped) waits until it does
  const pinned = (pins.data ?? []).filter((p) => isConverterUnit(p.fromUnit) && isConverterUnit(p.toUnit));

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const picker = (value: ConverterUnit, onChange: (u: ConverterUnit) => void, label: string) => {
    const currencies = units.filter((u) => isCurrency(u));
    const gold = units.filter((u) => !isCurrency(u));
    return (
      <Select
        aria-label={label}
        value={value}
        onChange={(e) => {
          if (isConverterUnit(e.target.value)) onChange(e.target.value);
        }}
      >
        <optgroup label={t("gadgets.groupCurrencies")}>
          {currencies.map((u) => (
            <option key={u} value={u}>
              {long(u)}
            </option>
          ))}
        </optgroup>
        {gold.length ? (
          <optgroup label={t("gadgets.groupGold")}>
            {gold.map((u) => (
              <option key={u} value={u}>
                {long(u)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    );
  };

  const result = table && valid ? convertUnits(amount, from, to, table) : null;
  const forward = table ? convertUnits(1, from, to, table) : null;
  const back = table ? convertUnits(1, to, from, table) : null;

  return (
    <Card className={className}>
      <CardHeader
        title={t("gadgets.converter")}
        action={
          <Button
            variant="ghost"
            disabled={!table || !valid || !(amount > 0) || from === to || alreadyPinned || pin.isPending}
            onClick={() => pin.mutate(undefined as never)}
          >
            ☆ {t("gadgets.pin")}
          </Button>
        }
      />
      <div className="space-y-4 p-[var(--ui-card-pad-x)]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.converterHint")}</p>
        {!table ? (
          <Skeleton rows={4} />
        ) : (
          <>
            {pinned.length ? (
              <ul aria-label={t("gadgets.pinned")} className="flex flex-wrap gap-2">
                {pinned.map((p) => {
                  const f = p.fromUnit as ConverterUnit;
                  const u = p.toUnit as ConverterUnit;
                  const value = convertUnits(p.amount, f, u, table);
                  const label = `${formatUnitAmount(p.amount, f, locale)} ${short(f)} → ${short(u)}`;
                  return (
                    <li
                      key={p.id}
                      data-pin
                      className="flex items-stretch overflow-hidden rounded-lg border border-[var(--edge)] text-xs"
                    >
                      <button
                        type="button"
                        aria-label={t("gadgets.openPin", { label })}
                        onClick={() => {
                          setFrom(f);
                          setTo(u);
                          setText(String(p.amount));
                        }}
                        className="px-2.5 py-1.5 text-left hover:bg-[var(--edge-soft)]"
                      >
                        <span className="block text-zinc-500 dark:text-zinc-400">
                          {formatUnitAmount(p.amount, f, locale)} {short(f)}
                        </span>
                        <span className="tnum block font-semibold text-zinc-900 dark:text-zinc-100">
                          {value == null ? "—" : formatUnitAmount(value, u, locale)} {short(u)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={t("gadgets.unpin", { label })}
                        title={t("gadgets.unpin", { label })}
                        onClick={() => unpin.mutate(p.id)}
                        className="border-l border-[var(--edge-soft)] px-2 text-zinc-400 hover:bg-[var(--edge-soft)] hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="space-y-2">
                <Field label={t("gadgets.amount")} error={valid ? undefined : t("gadgets.notAnAmount")}>
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="tnum text-base"
                  />
                </Field>
                <Field label={t("gadgets.from")}>{picker(from, setFrom, t("gadgets.from"))}</Field>
              </div>
              <div className="flex justify-center sm:pb-1">
                <button
                  type="button"
                  onClick={swap}
                  aria-label={t("gadgets.swap")}
                  title={t("gadgets.swap")}
                  className="rounded-full border border-[var(--edge)] bg-[var(--surface)] p-2 text-teal-700 hover:bg-[var(--edge-soft)] dark:text-teal-300"
                >
                  <Icon name="swap" size={18} className="rotate-90 sm:rotate-0" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("gadgets.result")}</span>
                  <output
                    data-converter-result
                    aria-live="polite"
                    className="tnum block truncate rounded-lg border border-[var(--edge)] bg-[var(--edge-soft)] px-3 py-2 text-base font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    {result == null ? "—" : formatUnitAmount(result, to, locale)}
                  </output>
                </div>
                <Field label={t("gadgets.to")}>{picker(to, setTo, t("gadgets.to"))}</Field>
              </div>
            </div>

            <div className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {forward != null && back != null ? (
                <>
                  <p data-converter-rate className="tnum">
                    {t("gadgets.rate", { from: short(from), rate: formatRate(forward, locale), to: short(to) })}
                  </p>
                  <p className="tnum">{t("gadgets.rate", { from: short(to), rate: formatRate(back, locale), to: short(from) })}</p>
                </>
              ) : (
                <p>{t("gadgets.noRate")}</p>
              )}
              <p>{t("gadgets.ratesAsOf", { time: new Date(table.fetchedAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-US") })}</p>
              {isStaleTable(table) ? <p className="text-amber-600 dark:text-amber-400">{t("gadgets.staleRates")}</p> : null}
            </div>

            {valid ? (
              <div>
                <h3 className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t("gadgets.inEvery", { amount: formatUnitAmount(amount, from, locale), unit: short(from) })}
                </h3>
                <ul className="divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
                  {units
                    .filter((u) => u !== from)
                    .map((u) => {
                      const value = convertUnits(amount, from, u, table);
                      return (
                        <li key={u}>
                          <button
                            type="button"
                            onClick={() => setTo(u)}
                            aria-pressed={u === to}
                            className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-[var(--edge-soft)] ${
                              u === to ? "font-semibold text-teal-700 dark:text-teal-300" : "text-zinc-700 dark:text-zinc-200"
                            }`}
                          >
                            <span className="min-w-0 truncate">{long(u)}</span>
                            <span className="tnum shrink-0">{value == null ? "—" : formatUnitAmount(value, u, locale)}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
