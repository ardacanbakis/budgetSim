"use client";

import { useCallback } from "react";
import { useUserSettings } from "@/lib/data/queries";
import { DEFAULT_DATE_FORMAT, formatDate } from "@/lib/domain/dates";
import { useI18n } from "@/lib/i18n";

/**
 * Returns a formatter that renders yyyy-mm-dd strings in the user's chosen
 * date format (Settings → Preferences), localized for the long variant.
 * Falls back to ISO until settings load.
 */
export function useFormatDate(): (iso: string | null | undefined) => string {
  const settings = useUserSettings();
  const { locale } = useI18n();
  const format = settings.data?.dateFormat ?? DEFAULT_DATE_FORMAT;
  return useCallback((iso: string | null | undefined) => formatDate(iso, format, locale), [format, locale]);
}
