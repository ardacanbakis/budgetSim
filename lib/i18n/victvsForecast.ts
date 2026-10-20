/**
 * Strings for editing the VICTVS forecast by hand (components/victvsForecast.tsx),
 * spread into victvs.* — English and Turkish side by side, so a key can't
 * exist in one and not the other. Every key starts with forecastOwn or
 * forecastEdit, so none can shadow one of the victvs block's own.
 */
export const en = {
  forecastEdit: "Edit",
  forecastEditMonth: "Edit {month}",
  forecastEditTitle: "{month} · your figure",
  forecastEditLabel: "What {month}'s work should earn (USD)",
  forecastEditHint: "In place of the forecast, wherever it's used: the Planner, the Timeline and the dashboard.",
  forecastEditInvalid: "Enter an amount of 0 or more.",
  forecastEditAuto: "The forecast says ~{amount}",
  forecastOwnFigure: "Your figure",
  forecastOwnBeside: "forecast ~{amount}",
  forecastOwnEdited: "edited",
  forecastOwnRevert: "Revert",
  forecastOwnRevertMonth: "Revert {month} to the forecast",
  forecastOwnRevertAll: "Revert all",
  forecastOwnCount: "Months with your own figure: {count}",
};

export const tr: typeof en = {
  forecastEdit: "Düzenle",
  forecastEditMonth: "{month} ayını düzenle",
  forecastEditTitle: "{month} · kendi rakamın",
  forecastEditLabel: "{month} ayındaki işin getirisi (USD)",
  forecastEditHint: "Tahminin yerine, kullanıldığı her yerde geçer: Planlayıcı, Zaman tüneli ve Özet.",
  forecastEditInvalid: "0 veya daha büyük bir tutar gir.",
  forecastEditAuto: "Tahmin: ~{amount}",
  forecastOwnFigure: "Senin rakamın",
  forecastOwnBeside: "tahmin ~{amount}",
  forecastOwnEdited: "düzenlendi",
  forecastOwnRevert: "Geri al",
  forecastOwnRevertMonth: "{month} ayını tahmine döndür",
  forecastOwnRevertAll: "Hepsini geri al",
  forecastOwnCount: "Kendi rakamın olan aylar: {count}",
};
