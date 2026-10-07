"use client";

import { Button, Input, Select } from "@/components/ui";
import { formatAmount } from "@/lib/domain/currencies";
import { GOLD_META, GOLD_TYPES, GoldHolding, GoldPrices, GoldType } from "@/lib/domain/gold";
import { useI18n } from "@/lib/i18n";

/** A holding as people say it: "2 Tam", "50 g Has gold". */
export function useHoldingLabel() {
  const { t, locale } = useI18n();
  return (h: GoldHolding) => {
    const qty = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 2 }).format(h.qty);
    const name = t(`gold.type_${h.type}`);
    return GOLD_META[h.type].unit === "g" ? `${qty} g ${name}` : `${qty} ${name}`;
  };
}

/** "2 Tam · 5 Çeyrek · +2", short enough for a list row. */
export function HoldingsSummary({ holdings, max = 2 }: { holdings: GoldHolding[]; max?: number }) {
  const label = useHoldingLabel();
  const shown = holdings.slice(0, max).map(label);
  const more = holdings.length - shown.length;
  return <>{more > 0 ? [...shown, `+${more}`].join(" · ") : shown.join(" · ")}</>;
}

/** Each holding with its price and what it's worth, for an account's detail. */
export function HoldingsList({ holdings, prices }: { holdings: GoldHolding[]; prices: GoldPrices | undefined }) {
  const { t, locale } = useI18n();
  const label = useHoldingLabel();
  return (
    <ul className="divide-y divide-[var(--edge-soft)] text-sm">
      {holdings.map((h, i) => {
        const price = prices?.[h.type];
        return (
          <li key={`${h.type}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2">
            <span>{label(h)}</span>
            <span className="text-right tabular-nums">
              {price != null ? (
                <>
                  <span className="block font-medium">{formatAmount(h.qty * price, "TRY", locale)}</span>
                  <span className="block text-[11px] text-zinc-400">
                    {GOLD_META[h.type].unit === "g"
                      ? t("gold.perGram", { amount: formatAmount(price, "TRY", locale) })
                      : t("gold.perPiece", { amount: formatAmount(price, "TRY", locale) })}
                  </span>
                </>
              ) : (
                <span className="text-xs text-zinc-400">{t("common.rateUnavailable")}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a gold account holds, edited as a list: a type, a quantity (grams or
 * pieces) and what it's worth today at a dealer's buying price.
 */
export function HoldingsEditor({
  value,
  onChange,
  prices,
}: {
  value: { type: GoldType; qty: string }[];
  onChange: (next: { type: GoldType; qty: string }[]) => void;
  prices: GoldPrices | undefined;
}) {
  const { t, locale } = useI18n();
  const set = (i: number, patch: Partial<{ type: GoldType; qty: string }>) =>
    onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const total = value.reduce((sum, row) => sum + (Number(row.qty) || 0) * (prices?.[row.type] ?? 0), 0);

  return (
    <div className="space-y-2">
      {value.map((row, i) => {
        const unit = GOLD_META[row.type].unit;
        const worth = (Number(row.qty) || 0) * (prices?.[row.type] ?? 0);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
            <Select
              aria-label={t("gold.type")}
              value={row.type}
              onChange={(e) => set(i, { type: e.target.value as GoldType })}
            >
              {GOLD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`gold.type_${type}`)}
                </option>
              ))}
            </Select>
            <div className="relative">
              <Input
                type="number"
                min="0"
                step={unit === "g" ? "any" : "1"}
                inputMode={unit === "g" ? "decimal" : "numeric"}
                aria-label={t("gold.quantity")}
                value={row.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
                className="pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-400">
                {unit === "g" ? "g" : t("gold.pcs")}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-label={t("common.delete")}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ✕
            </Button>
            {worth > 0 ? (
              <p className="col-span-3 -mt-1 text-right text-[11px] tabular-nums text-zinc-400">
                {formatAmount(worth, "TRY", locale)}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button type="button" onClick={() => onChange([...value, { type: "ceyrek", qty: "" }])}>
          {t("gold.add")}
        </Button>
        {total > 0 ? (
          <span className="text-sm tabular-nums text-zinc-500">
            {t("gold.worth", { amount: formatAmount(total, "TRY", locale) })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
