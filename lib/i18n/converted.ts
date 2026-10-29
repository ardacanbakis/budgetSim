/**
 * Strings for converted income (lib/domain/convertedIncome.ts), under
 * converted.* — a salary paid in one currency that a middleman converts into
 * another account. English and Turkish side by side so a key can't exist in
 * one and not the other.
 */
export const en = {
  convertTo: "Converted into",
  convertNone: "Not converted",
  convertHint: "Paid in {currency} and converted into another account? Each payday asks how much arrived there; the plan and the timeline count it there, less the usual cut.",
  pendingTitle: "How much arrived?",
  pendingLine: "{name}: {amount} on {date}, converted into {account}",
  record: "Record what arrived",
  modalTitle: "{name} → {account}",
  paid: "Paid: {amount} on {date}",
  arrived: "Arrived in {account} ({currency})",
  arrivedOn: "Arrived on",
  hintCut: "Suggested: today's rate less the usual cut, {pct}%, from your last {count} conversions.",
  hintCutOne: "Suggested: today's rate less the cut your last conversion lost, {pct}%.",
  hintMarket: "Suggested: today's rate. No earlier conversions to learn the middleman's cut from yet.",
  later: "Later",
  middleman: "Middleman's cut ({from} → {to})",
  middlemanLine: "average {pct} · {amount} this year",
};

export const tr: typeof en = {
  convertTo: "Çevrildiği hesap",
  convertNone: "Çevrilmiyor",
  convertHint: "{currency} olarak ödenip başka bir hesaba mı çevriliyor? Her ödeme gününde oraya ne kadar geldiği sorulur; plan ve zaman tüneli onu, olağan kesinti düşülerek orada sayar.",
  pendingTitle: "Ne kadar geldi?",
  pendingLine: "{name}: {date} tarihinde {amount}, {account} hesabına çevriliyor",
  record: "Geleni kaydet",
  modalTitle: "{name} → {account}",
  paid: "Ödenen: {date} tarihinde {amount}",
  arrived: "{account} hesabına gelen ({currency})",
  arrivedOn: "Geldiği tarih",
  hintCut: "Öneri: bugünkü kur eksi olağan kesinti, %{pct}; son {count} çevriminden.",
  hintCutOne: "Öneri: bugünkü kur eksi son çevriminde kaybedilen, %{pct}.",
  hintMarket: "Öneri: bugünkü kur. Aracının kesintisini öğrenecek önceki çevrim henüz yok.",
  later: "Sonra",
  middleman: "Aracının kesintisi ({from} → {to})",
  middlemanLine: "ortalama {pct} · bu yıl {amount}",
};
