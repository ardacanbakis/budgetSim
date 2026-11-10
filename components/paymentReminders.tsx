"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CardHeader, Select, Spinner } from "@/components/ui";
import { useTxLookup } from "@/components/pocket/dayList";
import { useAccounts } from "@/lib/data/queries";
import { buildIcs, CalendarAlarm, CalendarInclude, paymentEntries } from "@/lib/domain/calendar";
import { addMonthsClamped } from "@/lib/domain/recurrence";
import { useLocalChoice, useLocalToggle } from "@/lib/prefs";
import { useI18n } from "@/lib/i18n";
import { useTimeline } from "@/lib/useTimeline";

/**
 * Getting the payment days off the screen and onto the phone.
 *
 * A browser cannot wake itself on the 16th. Web push needs a server and a
 * subscription, and the APIs that would schedule a notification without one
 * are behind a flag on Chrome and absent on iOS — so a reminder that only
 * fires while the app is open is not a reminder.
 *
 * Two honest things instead:
 *
 * - A calendar file. One download, no server, no permission, and the same
 *   on both platforms: each payment is an all-day event with an alarm, and
 *   the phone's own calendar does the reminding from then on. Re-exporting
 *   updates the same events rather than doubling them, because each uid is
 *   derived from the payment rather than from the moment of export.
 * - A notification when you open the app with something due. It is honest
 *   about what it is — a nudge on opening, not a schedule — and it is off
 *   until asked for, since nobody should be asked for notification
 *   permission by a page they were only reading.
 */

const ALARMS: CalendarAlarm[] = ["both", "dayBefore", "onDay", "none"];
const SPANS = [3, 6, 12] as const;
const KINDS: CalendarInclude[] = ["cards", "debts", "other"];

const NOTIFY_KEY = "renovator-notify-on-open";
const CAL_ALARM_KEY = "renovator-cal-alarm";

export function PaymentRemindersCard() {
  const { t, locale } = useI18n();
  const accounts = useAccounts();
  const lookup = useTxLookup();
  const timeline = useTimeline(lookup.book, false);
  const [months, setMonths] = useState<(typeof SPANS)[number]>(12);
  const [kinds, setKinds] = useState<Set<CalendarInclude>>(() => new Set(KINDS));
  const alarm = useLocalChoice<CalendarAlarm>(CAL_ALARM_KEY, ALARMS, "both");
  const notify = useLocalToggle(NOTIFY_KEY, false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    // after paint, as every other device-read here does: the permission is
    // a browser fact, unknowable while prerendering
    queueMicrotask(() => setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  }, []);

  const entries = useMemo(() => {
    if (timeline.loading) return [];
    return paymentEntries({
      events: timeline.events,
      accounts: accounts.data ?? [],
      today: timeline.today,
      to: addMonthsClamped(timeline.today, months),
      include: kinds,
      locale,
    });
  }, [timeline.events, timeline.loading, timeline.today, accounts.data, months, kinds, locale]);

  const toggleKind = (kind: CalendarInclude) => {
    const next = new Set(kinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setKinds(next);
  };

  const download = () => {
    const ics = buildIcs({ entries, name: t("reminders.calendarName"), alarm: alarm.value, now: timeline.today });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `budgetsim-payments-${timeline.today}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ask = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    notify.setValue(result === "granted");
  };

  if (timeline.loading) return <Spinner />;

  return (
    <Card>
      <CardHeader title={t("reminders.title")} />
      <div className="space-y-4 p-4">
        <p className="text-xs text-zinc-500">{t("reminders.intro")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            {t("flow.horizon")}
            <Select value={String(months)} onChange={(e) => setMonths(Number(e.target.value) as (typeof SPANS)[number])} className="w-28">
              {SPANS.map((n) => (
                <option key={n} value={n}>
                  {t("cards.matrixMonths", { count: n })}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            {t("reminders.alarm")}
            <Select value={alarm.value} onChange={(e) => alarm.setValue(e.target.value as CalendarAlarm)} className="w-40">
              {ALARMS.map((a) => (
                <option key={a} value={a}>
                  {t(`reminders.alarm_${a}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          {KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={kinds.has(kind)}
                onChange={() => toggleKind(kind)}
                className="h-4 w-4 accent-teal-600"
                data-cal-kind={kind}
              />
              {t(`realTerms.group${kind === "cards" ? "Cards" : kind === "debts" ? "Debts" : "Other"}`)}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={download} disabled={entries.length === 0} data-cal-download>
            ⬇ {t("reminders.download", { count: entries.length })}
          </Button>
          <span className="text-xs text-zinc-500">{t("reminders.downloadHint")}</span>
        </div>

        <div className="space-y-2 rounded-lg border border-[var(--edge)] p-3">
          <p className="text-sm font-medium">{t("reminders.onOpen")}</p>
          <p className="text-xs text-zinc-500">{t("reminders.onOpenHint")}</p>
          {permission === "unsupported" ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("reminders.unsupported")}</p>
          ) : permission === "denied" ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("reminders.denied")}</p>
          ) : permission === "granted" ? (
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                role="switch"
                checked={notify.value}
                onChange={(e) => notify.setValue(e.target.checked)}
                className="h-4 w-4 accent-teal-600"
                data-notify-on-open
              />
              {t("reminders.onOpenSwitch")}
            </label>
          ) : (
            <Button onClick={ask} data-notify-ask>
              {t("reminders.allow")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The nudge itself, mounted once by the shell: on opening the app, one
 * notification for whatever a card or a bill wants today. Once a day at
 * most, and only with the switch on and permission already given — this
 * never asks for anything.
 */
export function useOpeningNudge(count: number, body: string): void {
  const notify = useLocalToggle(NOTIFY_KEY, false);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || !notify.loaded || !notify.value || count === 0) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (window.localStorage.getItem("renovator-notified-on") === today) return;
      window.localStorage.setItem("renovator-notified-on", today);
    } catch {
      // no storage: better to nudge twice than never
    }
    fired.current = true;
    new Notification(body, { tag: "budgetsim-due", body });
  }, [notify.loaded, notify.value, count, body]);
}
