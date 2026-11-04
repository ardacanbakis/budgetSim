"use client";

import { useCallback } from "react";
import { ConverterUnit, goldTypeOf } from "@/lib/domain/converter";
import { isCurrency } from "@/lib/domain/currencies";
import { useI18n } from "@/lib/i18n";

/**
 * What a converter unit is called: `short` next to a figure ("USD",
 * "Çeyrek", "Gold (gram)"), `long` in a picker ("USD · US Dollar").
 */
export function useUnitLabels() {
  const { t } = useI18n();
  const short = useCallback(
    (unit: ConverterUnit) => {
      const type = goldTypeOf(unit);
      if (type) return t(`gold.type_${type}`);
      return unit === "XAU_G" ? t("currency.XAU_G") : unit;
    },
    [t]
  );
  const long = useCallback(
    (unit: ConverterUnit) => (isCurrency(unit) && unit !== "XAU_G" ? `${unit} · ${t(`currency.${unit}`)}` : short(unit)),
    [short, t]
  );
  return { short, long };
}
