"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useCategories,
  useRates,
  useUserSettings,
  useVictvsPayouts,
  useVictvsSessions,
} from "@/lib/data/queries";
import { MarkPaidInput, NewVictvsSession } from "@/lib/data/repo";
import { DEFAULT_VICTVS_AMOUNTS, VictvsSession, victvsTypeList } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { ParsedSession, parseVictvsPaste } from "@/lib/domain/victvsParser";
import { useI18n } from "@/lib/i18n";

type Filter = "unpaid" | "paid" | "all";

const VICTVS_KEYS = [KEYS.victvsSessions, KEYS.victvsPayouts, KEYS.transactions, KEYS.accounts];

function typeBadgeTone(type: string): "sky" | "green" | "amber" | "zinc" {
  switch (type) {
    case "IWCF":
      return "sky";
    case "CIPS OR":
      return "green";
    case "CIPS CR":
      return "amber";
    default:
      return "zinc";
  }
}

export default function VictvsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  const accounts = useAccounts();
  const rates = useRates();
  const settings = useUserSettings();

  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [latestFirst, setLatestFirst] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const createSessions = useAppMutation((inputs: NewVictvsSession[]) => repo.createVictvsSessions(inputs), [KEYS.victvsSessions]);
  const deleteSession = useAppMutation((id: string) => repo.deleteVictvsSession(id), [KEYS.victvsSessions]);
  const markPaid = useAppMutation((input: MarkPaidInput) => repo.markVictvsPaid(input), VICTVS_KEYS);
  const markUnpaid = useAppMutation((ids: string[]) => repo.markVictvsUnpaid(ids), [KEYS.victvsSessions]);
  const undoPayout = useAppMutation((id: string) => repo.unmarkVictvsPayout(id), VICTVS_KEYS);

  const defaults: Record<string, number> = { ...DEFAULT_VICTVS_AMOUNTS, ...(settings.data?.victvsDefaults ?? {}) };

  // year → month grouping, both levels sortable and collapsible
  const groups = useMemo(() => {
    let all = sessions.data ?? [];
    if (filter !== "all") all = all.filter((s) => s.status === filter);
    const byMonth = new Map<string, VictvsSession[]>();
    for (const s of all) {
      const key = s.date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
    }
    const months = [...byMonth.entries()]
      .map(([month, items]) => ({
        month,
        items: items.sort((a, b) => (latestFirst ? (a.date < b.date ? 1 : -1) : a.date > b.date ? 1 : -1)),
      }))
      .sort((a, b) => (latestFirst ? (a.month < b.month ? 1 : -1) : a.month > b.month ? 1 : -1));
    const byYear = new Map<string, typeof months>();
    for (const m of months) {
      const year = m.month.slice(0, 4);
      byYear.set(year, [...(byYear.get(year) ?? []), m]);
    }
    return [...byYear.entries()].sort((a, b) => (latestFirst ? (a[0] < b[0] ? 1 : -1) : a[0] > b[0] ? 1 : -1));
  }, [sessions.data, filter, latestFirst]);

  const unpaidTotal = sumAmounts("USD", (sessions.data ?? []).filter((s) => s.status === "unpaid").map((s) => s.amount));
  const selectedSessions = (sessions.data ?? []).filter((s) => selected.has(s.id));
  const selectedUnpaid = selectedSessions.filter((s) => s.status === "unpaid");
  const selectedPaid = selectedSessions.filter((s) => s.status === "paid");
  const selectedTotal = sumAmounts("USD", selectedUnpaid.map((s) => s.amount));

  if (sessions.isLoading || accounts.isLoading || settings.isLoading) return <Spinner />;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** select all sessions in [from,to] day range of a month (toggles off when all already selected) */
  const selectRange = (items: VictvsSession[], fromDay: number, toDay: number) => {
    const targets = items.filter((s) => {
      const day = Number(s.date.slice(8, 10));
      return day >= fromDay && day <= toDay;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = targets.every((s) => next.has(s.id));
      for (const s of targets) {
        if (allIn) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long" });

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("victvs.title")}</h1>
          <p className="text-sm text-zinc-500">
            {t("victvs.unpaid")}: <span className="font-semibold text-green-600 tabular-nums">{formatAmount(unpaidTotal, "USD", locale)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAddOpen(true)}>+ {t("victvs.addSession")}</Button>
          <Button variant="primary" onClick={() => setPasteOpen(true)}>
            ⎘ {t("victvs.pasteButton")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-[var(--edge-soft)] p-1">
            {(["unpaid", "paid", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${filter === f ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"}`}
              >
                {f === "all" ? t("common.all") : t(`victvs.${f}`)}
              </button>
            ))}
          </div>
          <button onClick={() => setLatestFirst(!latestFirst)} className="text-xs text-teal-600 hover:underline">
            {latestFirst ? t("portfolio.sortLatest") : t("portfolio.sortOldest")} ⇅
          </button>
        </div>
        <div className="flex gap-2">
          {selectedPaid.length > 0 ? (
            <Button
              onClick={() => {
                markUnpaid.mutate(selectedPaid.map((s) => s.id));
                setSelected(new Set());
              }}
            >
              {t("victvs.markUnpaid")} ({selectedPaid.length})
            </Button>
          ) : null}
          {selectedUnpaid.length > 0 ? (
            <Button variant="primary" onClick={() => setPayOpen(true)}>
              {t("victvs.markPaid")} · {formatAmount(selectedTotal, "USD", locale)}
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState>{t("victvs.empty")}</EmptyState>
      ) : (
        groups.map(([year, months]) => {
          const yearCollapsed = collapsed.has(year);
          const yearTotal = sumAmounts("USD", months.flatMap((m) => m.items.map((s) => s.amount)));
          return (
            <div key={year} className="space-y-3">
              <button onClick={() => toggleCollapsed(year)} className="flex w-full items-center gap-2 text-left">
                <span className="text-lg font-bold">{yearCollapsed ? "▸" : "▾"} {year}</span>
                <span className="text-sm text-zinc-400 tabular-nums">{formatAmount(yearTotal, "USD", locale)}</span>
              </button>
              {yearCollapsed
                ? null
                : months.map(({ month, items }) => {
                    const monthCollapsed = collapsed.has(month);
                    const monthTotal = sumAmounts("USD", items.map((s) => s.amount));
                    const monthUnpaid = items.filter((s) => s.status === "unpaid");
                    return (
                      <Card key={month}>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--edge-soft)] px-4 py-2.5">
                          <button onClick={() => toggleCollapsed(month)} className="flex items-center gap-2 text-sm font-semibold">
                            <span>{monthCollapsed ? "▸" : "▾"}</span>
                            {monthLabel(month)}
                            <span className="font-normal text-zinc-400">
                              {items.length} {t("victvs.sessions")} · <span className="tabular-nums">{formatAmount(monthTotal, "USD", locale)}</span>
                            </span>
                            {monthUnpaid.length > 0 ? <Badge tone="amber">{monthUnpaid.length} {t("victvs.unpaid").toLowerCase()}</Badge> : null}
                          </button>
                          {!monthCollapsed ? (
                            <div className="flex gap-1.5">
                              <Button variant="ghost" onClick={() => selectRange(items, 1, 15)}>
                                {t("victvs.firstHalf")}
                              </Button>
                              <Button variant="ghost" onClick={() => selectRange(items, 16, 31)}>
                                {t("victvs.secondHalf")}
                              </Button>
                              <Button variant="ghost" onClick={() => selectRange(items, 1, 31)}>
                                {t("common.all")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {monthCollapsed ? null : (
                          <ul className="divide-y divide-[var(--edge-soft)]">
                            {items.map((s) => (
                              <SessionRow key={s.id} session={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} onDelete={() => deleteSession.mutate(s.id)} />
                            ))}
                          </ul>
                        )}
                      </Card>
                    );
                  })}
            </div>
          );
        })
      )}

      {(payouts.data ?? []).length > 0 ? (
        <Card>
          <CardHeader title={t("victvs.payouts")} />
          <ul className="divide-y divide-[var(--edge-soft)]">
            {(payouts.data ?? []).map((p) => {
              const account = (accounts.data ?? []).find((a) => a.id === p.accountId);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <span className="font-medium text-green-600 tabular-nums">+{formatAmount(p.total, "USD", locale)}</span>
                    <span className="ml-2 text-zinc-500">
                      {p.sessionCount} {t("victvs.sessions")} → {account?.name ?? "?"} · {p.paymentDate}
                    </span>
                  </div>
                  <Button variant="ghost" onClick={() => window.confirm(t("common.confirmDelete")) && undoPayout.mutate(p.id)}>
                    {t("victvs.undoPayout")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <PasteModal
        open={pasteOpen}
        defaults={defaults}
        onClose={() => setPasteOpen(false)}
        onSave={async (rows) => {
          await createSessions.mutateAsync(
            rows.map((r) => ({
              date: r.date,
              sessionType: r.sessionType,
              sessionNo: r.sessionNo,
              amount: r.amount ?? defaults[r.sessionType] ?? 0,
              source: "paste" as const,
            }))
          );
          setPasteOpen(false);
        }}
      />

      <AddModal
        open={addOpen}
        defaults={defaults}
        onClose={() => setAddOpen(false)}
        onSave={async (input) => {
          await createSessions.mutateAsync([input]);
          setAddOpen(false);
        }}
      />

      <MarkPaidModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        sessions={selectedUnpaid}
        defaultAccountId={settings.data?.victvsAccountId ?? null}
        onConfirm={async (accountId, paymentDate, receivedAmount, categoryId, legacy) => {
          await markPaid.mutateAsync({
            sessionIds: selectedUnpaid.map((s) => s.id),
            accountId,
            paymentDate,
            receivedAmount,
            totalUsd: selectedTotal,
            categoryId,
            fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
            legacy,
          });
          setSelected(new Set());
          setPayOpen(false);
        }}
      />
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onToggle,
  onDelete,
}: {
  session: VictvsSession;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const unpaid = session.status === "unpaid";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 accent-teal-600" aria-label={session.sessionType} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={typeBadgeTone(session.sessionType)}>{session.sessionType}</Badge>
          {session.sessionNo ? <span className="font-mono text-xs text-zinc-400">#{session.sessionNo}</span> : null}
          <Badge tone={unpaid ? "amber" : "green"}>{t(`victvs.${session.status}`)}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">{session.date}</div>
      </div>
      <div className="text-sm font-semibold text-green-600 tabular-nums">{formatAmount(session.amount, "USD", locale)}</div>
      {unpaid ? (
        <Button variant="ghost" aria-label={t("common.delete")} onClick={() => window.confirm(t("common.confirmDelete")) && onDelete()}>
          ✕
        </Button>
      ) : null}
    </li>
  );
}

function PasteModal({
  open,
  defaults,
  onClose,
  onSave,
}: {
  open: boolean;
  defaults: Record<string, number>;
  onClose: () => void;
  onSave: (rows: ParsedSession[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedSession[] | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof parseVictvsPaste>["errors"]>([]);

  function preview() {
    const result = parseVictvsPaste(text);
    setRows(result.sessions.map((s) => ({ ...s, amount: s.amount ?? defaults[s.sessionType] ?? null })));
    setErrors(result.errors);
  }

  function updateRow(i: number, patch: Partial<ParsedSession>) {
    setRows((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : prev));
  }

  function reset() {
    setText("");
    setRows(null);
    setErrors([]);
  }

  const reasonKey = {
    "no-date": "victvs.errorReasonNoDate",
    "bad-date": "victvs.errorReasonBadDate",
    "no-type": "victvs.errorReasonNoType",
  } as const;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("victvs.pasteTitle")}
      wide
    >
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("victvs.pasteHint")}</p>
        <Textarea rows={6} placeholder={"CIPS OR Exam 37324 - Wed 15 Jul 26\nV3 - ONLINE - 83849, PTS, 788, Jakarta, Indonesia - 08 Jul 26 - 1500"} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-end">
          <Button onClick={preview} disabled={!text.trim()}>
            {t("victvs.parse")}
          </Button>
        </div>

        {rows != null ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="green">{t("victvs.parsedCount", { count: rows.length })}</Badge>
              {errors.length > 0 ? <Badge tone="red">{t("victvs.errorCount", { count: errors.length })}</Badge> : null}
            </div>
            {errors.length > 0 ? (
              <ul className="space-y-1 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                {errors.map((e) => (
                  <li key={e.line} className="truncate">
                    #{e.line} — {t(reasonKey[e.reason])}: <span className="font-mono">{e.raw}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-400">
                      <th className="py-1 pr-2 font-medium">{t("common.date")}</th>
                      <th className="py-1 pr-2 font-medium">{t("victvs.sessionType")}</th>
                      <th className="py-1 pr-2 font-medium">{t("victvs.sessionNo")}</th>
                      <th className="py-1 font-medium">{t("common.amount")} ($)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <Input type="date" value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} />
                        </td>
                        <td className="py-1 pr-2">
                          <Select
                            value={r.sessionType}
                            onChange={(e) =>
                              updateRow(i, {
                                sessionType: e.target.value,
                                amount: defaults[e.target.value] ?? r.amount,
                              })
                            }
                          >
                            {victvsTypeList(defaults).map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1 pr-2">
                          <Input value={r.sessionNo} onChange={(e) => updateRow(i, { sessionNo: e.target.value })} className="!w-24 font-mono" />
                        </td>
                        <td className="py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={r.amount ?? ""}
                            onChange={(e) => updateRow(i, { amount: e.target.value === "" ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td className="py-1 pl-1">
                          <Button variant="ghost" onClick={() => setRows((prev) => prev!.filter((_, idx) => idx !== i))}>
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-1 text-right text-xs text-zinc-500">
                  {t("common.total")}:{" "}
                  {formatAmount(sumAmounts("USD", rows.map((r) => r.amount ?? 0)), "USD", locale)}
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={rows.length === 0}
                onClick={async () => {
                  await onSave(rows);
                  reset();
                }}
              >
                {t("victvs.saveSessions", { count: rows.length })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AddModal({
  open,
  defaults,
  onClose,
  onSave,
}: {
  open: boolean;
  defaults: Record<string, number>;
  onClose: () => void;
  onSave: (input: NewVictvsSession) => Promise<void>;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(todayISO());
  const [sessionType, setSessionType] = useState<string>("IWCF");
  const [sessionNo, setSessionNo] = useState("");
  const [amount, setAmount] = useState("");

  const effectiveAmount = amount === "" ? String(defaults[sessionType] ?? "") : amount;

  return (
    <Modal open={open} onClose={onClose} title={t("victvs.addSession")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({ date, sessionType, sessionNo, amount: Number(effectiveAmount), source: "manual" });
          setSessionNo("");
          setAmount("");
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.date")}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("victvs.sessionType")}>
            <Select
              value={sessionType}
              onChange={(e) => {
                setSessionType(e.target.value);
                setAmount("");
              }}
            >
              {victvsTypeList(defaults).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("victvs.sessionNo")}>
            <Input value={sessionNo} onChange={(e) => setSessionNo(e.target.value)} placeholder="37324" className="font-mono" />
          </Field>
          <Field label={`${t("common.amount")} (USD)`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={effectiveAmount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MarkPaidModal({
  open,
  onClose,
  sessions,
  defaultAccountId,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  sessions: VictvsSession[];
  defaultAccountId: string | null;
  onConfirm: (accountId: string, paymentDate: string, receivedAmount: number, categoryId: string | null, legacy: boolean) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [legacy, setLegacy] = useState(false);

  const totalUsd = sumAmounts("USD", sessions.map((s) => s.amount));
  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const account =
    active.find((a) => a.id === accountId) ??
    active.find((a) => a.id === defaultAccountId) ??
    active.find((a) => a.currency === "USD") ??
    active[0];
  const victvsCategory = (categories.data ?? []).find((c) => c.direction === "income" && c.name.toLowerCase().includes("victvs"));

  const marketReceived = account && rates.data ? convert(totalUsd, "USD", account.currency, rates.data.usdPer) : null;
  const shownReceived = receivedTouched ? received : marketReceived != null ? String(marketReceived) : "";

  return (
    <Modal open={open} onClose={onClose} title={t("victvs.markPaidTitle", { count: sessions.length })}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!account) return;
          await onConfirm(account.id, paymentDate, Number(shownReceived), victvsCategory?.id ?? null, legacy);
          setReceivedTouched(false);
          setReceived("");
          setLegacy(false);
        }}
      >
        <div className="rounded-lg bg-[var(--edge-soft)] p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">{t("victvs.totalUsd")}</span>
            <span className="font-semibold text-green-600 tabular-nums">{formatAmount(totalUsd, "USD", locale)}</span>
          </div>
        </div>
        <Field label={t("victvs.depositAccount")} hint={t("victvs.defaultAccountHint")}>
          <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("victvs.paymentDate")}>
          <Input type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
        <Field
          label={`${t("victvs.receivedAmount")} ${account ? `(${account.currency})` : ""}`}
          hint={account && account.currency !== "USD" ? t("victvs.receivedHint") : undefined}
        >
          <Input
            type="number"
            step="any"
            min="0"
            required
            inputMode="decimal"
            value={shownReceived}
            onChange={(e) => {
              setReceivedTouched(true);
              setReceived(e.target.value);
            }}
          />
        </Field>
        <label className="flex items-start gap-2 rounded-lg bg-[var(--edge-soft)] p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">{t("legacy.completeAs")}</span>
            <span className="block text-xs text-zinc-500">{t("legacy.victvsPayoutHint")}</span>
          </span>
        </label>
        <p className="text-xs text-zinc-400">{legacy ? t("legacy.victvsPayoutLegacy") : t("victvs.payoutCreated")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!account || Number(shownReceived) <= 0}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
