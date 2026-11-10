/**
 * Strings for payment reminders (components/paymentReminders.tsx), under
 * reminders.* — English and Turkish side by side, so a key can't exist in
 * one and not the other.
 */
export const en = {
  title: "Payment reminders",
  intro:
    "A browser can't wake itself on the 16th: scheduling a notification without a server is behind a flag on Chrome and missing on iOS. A calendar is the part of your phone whose whole job is this — download the payment days once and it reminds you from then on, with no account and no permission. Exporting again updates the same events rather than adding them twice.",
  calendarName: "BudgetSim payments",
  alarm: "Remind me",
  alarm_both: "Day before and on the day",
  alarm_dayBefore: "The day before, 9am",
  alarm_onDay: "On the day, 9am",
  alarm_none: "No alarm",
  download: "Download {count} payment days",
  downloadHint: "Open the file on your phone to add it to your calendar.",
  onOpen: "A nudge when you open the app",
  onOpenHint:
    "Not a schedule — the page has to be open for this to fire. It's worth having as well as the calendar, never instead of it.",
  onOpenSwitch: "Notify me when something is due",
  allow: "Allow notifications",
  denied: "Notifications are blocked for this site. Your browser's site settings can let them back in.",
  unsupported: "This browser has no notifications.",
  nudge: "{count} payments are due",
};

export const tr: typeof en = {
  title: "Ödeme hatırlatmaları",
  intro:
    "Bir tarayıcı ayın 16'sında kendi kendine uyanamaz: sunucusuz bildirim zamanlama Chrome'da bayrak arkasında, iOS'ta ise yok. Telefonundaki takvim tam olarak bunun için var — ödeme günlerini bir kez indir, gerisini o hatırlatsın; hesap da izin de gerekmez. Tekrar dışa aktarmak aynı kayıtları günceller, ikinci kez eklemez.",
  calendarName: "BudgetSim ödemeleri",
  alarm: "Hatırlat",
  alarm_both: "Bir gün önce ve o gün",
  alarm_dayBefore: "Bir gün önce, 09:00",
  alarm_onDay: "O gün, 09:00",
  alarm_none: "Alarm yok",
  download: "{count} ödeme gününü indir",
  downloadHint: "Dosyayı telefonunda açarsan takvimine eklenir.",
  onOpen: "Uygulamayı açınca bir dürtme",
  onOpenHint:
    "Bu bir zamanlama değil — çalışması için sayfanın açık olması gerekir. Takvimin yerine değil, yanında işe yarar.",
  onOpenSwitch: "Ödenecek bir şey varsa bildir",
  allow: "Bildirimlere izin ver",
  denied: "Bu site için bildirimler engellenmiş. Tarayıcının site ayarlarından geri açabilirsin.",
  unsupported: "Bu tarayıcıda bildirim yok.",
  nudge: "{count} ödeme bekliyor",
};
