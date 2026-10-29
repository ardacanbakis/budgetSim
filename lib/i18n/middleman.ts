/**
 * Strings for converting through a middleman (components/middlemanModal.tsx),
 * under middleman.* — dollars handed over at the rate they give that day,
 * lira arriving in a lira account. English and Turkish side by side so a key
 * can't exist in one and not the other.
 */
export const en = {
  button: "Convert via middleman",
  title: "Convert {from} via middleman",
  hint: "What you handed over, at the rate they gave you, and what arrived. The market rate is kept beside it, so Reports shows the middleman's cut.",
  to: "Arrives in",
  sent: "Sent ({currency})",
  rate: "Their rate ({from} → {to})",
  received: "Arrived ({currency})",
  receivedHint: "Sent × their rate, until you type what actually arrived.",
  market: "Market: 1 {from} = {rate} {to}",
  cut: "their cut {pct}% · {amount}",
  description: "Middleman conversion @ {rate}",
};

export const tr: typeof en = {
  button: "Aracıyla çevir",
  title: "{from} aracıyla çevir",
  hint: "Verdiğin, o gün verdikleri kurla, ve gelen. Piyasa kuru yanında tutulur; Raporlar aracının kesintisini gösterir.",
  to: "Geldiği hesap",
  sent: "Verilen ({currency})",
  rate: "Verdikleri kur ({from} → {to})",
  received: "Gelen ({currency})",
  receivedHint: "Gerçekte gelen yazılana kadar verilen × kur.",
  market: "Piyasa: 1 {from} = {rate} {to}",
  cut: "kesinti %{pct} · {amount}",
  description: "Aracıyla çevrim @ {rate}",
};
