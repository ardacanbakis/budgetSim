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
  useVictvsPayouts,
  useVictvsSessions,
} from "@/lib/data/queries";
import { MarkPaidInput, NewVictvsSession } from "@/lib/data/repo";
import { VictvsSession } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { ParsedSession, parseVictvsPaste } from "@/lib/domain/victvsParser";
import { useI18n } from "@/lib/i18n";

type Filter = "unpaid" | "paid" | "all";

export default function VictvsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  const accounts = useAccounts();
  const rates = useRates();

  const [filter, setFilter] = useState<Filter>("unpaid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const victvsKeys = [KEYS.victvsSessions, KEYS.victvsPayouts, KEYS.transactions, KEYS.accounts];
  const createSessions = useAppMutation((inputs: NewVictvsSession[]) => repo.createVictvsSessions(inputs), [KEYS.victvsSessions]);
  const deleteSession = useAppMutation((id: string) => repo.deleteVictvsSession(id), [KEYS.victvsSessions]);
  const markPaid = useAppMutation((input: MarkPaidInput) => repo.markVictvsPaid(input), victvsKeys);
  const undoPayout = useAppMutation((id: string) => repo.unmarkVictvsPayout(id), victvsKeys);

  const list = useMemo(() => {
    const all = [...(sessions.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (filter === "all") return all;
    return all.filter((s) => s.status === filter);
  }, [sessions.data, filter]);

  const unpaidTotal = useMemo(
    () => sumAmounts("USD", (sessions.data ?? []).filter((s) => s.status === "unpaid").map((s) => s.amount)),
    [sessions.data]
  );

  const selectedSessions = useMemo(
    () => (sessions.data ?? []).filter((s) => selected.has(s.id) && s.status === "unpaid"),
    [sessions.data, selected]
  );
  const selectedTotal = sumAmounts("USD", selectedSessions.map((s) => s.amount));

  if (sessions.isLoading || accounts.isLoading) return <Spinner />;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("victvs.title")}</h1>
          <p className="text-sm text-zinc-500">
            {t("victvs.unpaid")}: <span className="font-semibold tabular-nums">{formatAmount(unpaidTotal, "USD", locale)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAddOpen(true)}>+ {t("victvs.addSession")}</Button>
          <Button variant="primary" onClick={() => setPasteOpen(true)}>
            ⎘ {t("victvs.pasteButton")}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {(["unpaid", "paid", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                filter === f ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500"
              }`}
            >
              {f === "all" ? t("common.all") : t(`victvs.${f}`)}
            </button>
          ))}
        </div>
        {selectedSessions.length > 0 ? (
          <Button variant="primary" onClick={() => setPayOpen(true)}>
            {t("victvs.markPaid")} · {formatAmount(selectedTotal, "USD", locale)}
          </Button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <EmptyState>{t("victvs.empty")}</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((s) => (
              <SessionRow key={s.id} session={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} onDelete={() => deleteSession.mutate(s.id)} />
            ))}
          </ul>
        </Card>
      )}

      {(payouts.data ?? []).length > 0 ? (
        <Card>
          <CardHeader title={t("victvs.payouts")} />
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(payouts.data ?? []).map((p) => {
              const account = (accounts.data ?? []).find((a) => a.id === p.accountId);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <span className="font-medium tabular-nums">{formatAmount(p.total, "USD", locale)}</span>
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
        onClose={() => setPasteOpen(false)}
        onSave={async (rows) => {
          await createSessions.mutateAsync(rows.map((r) => ({ date: r.date, sessionType: r.sessionType, amount: r.amount, source: "paste" as const })));
          setPasteOpen(false);
        }}
      />

      <AddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={async (input) => {
          await createSessions.mutateAsync([input]);
          setAddOpen(false);
        }}
      />

      <MarkPaidModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        sessions={selectedSessions}
        onConfirm={async (accountId, paymentDate, receivedAmount, categoryId) => {
          await markPaid.mutateAsync({
            sessionIds: selectedSessions.map((s) => s.id),
            accountId,
            paymentDate,
            receivedAmount,
            totalUsd: selectedTotal,
            categoryId,
            fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
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
    <li className="flex items-center gap-3 px-4 py-3">
      {unpaid ? (
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 accent-teal-600" aria-label={session.sessionType} />
      ) : (
        <span className="w-4" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{session.sessionType}</span>
          <Badge tone={unpaid ? "amber" : "green"}>{t(`victvs.${session.status}`)}</Badge>
        </div>
        <div className="text-xs text-zinc-500">{session.date}</div>
      </div>
      <div className="text-sm font-semibold tabular-nums">{formatAmount(session.amount, "USD", locale)}</div>
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
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (rows: ParsedSession[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedSession[] | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof parseVictvsPaste>["errors"]>([]);

  function preview() {
    const result = parseVictvsPaste(text);
    setRows(result.sessions);
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

  const reasonKey = { "no-date": "victvs.errorReasonNoDate", "no-amount": "victvs.errorReasonNoAmount", "bad-date": "victvs.errorReasonBadDate" } as const;

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
        <Textarea rows={6} placeholder={t("victvs.pastePlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
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
                          <Input value={r.sessionType} onChange={(e) => updateRow(i, { sessionType: e.target.value })} />
                        </td>
                        <td className="py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={r.amount}
                            onChange={(e) => updateRow(i, { amount: Number(e.target.value) })}
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
                  {t("common.total")}: {formatAmount(sumAmounts("USD", rows.map((r) => r.amount || 0)), "USD", locale)}
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
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: NewVictvsSession) => Promise<void>;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(todayISO());
  const [sessionType, setSessionType] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <Modal open={open} onClose={onClose} title={t("victvs.addSession")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({ date, sessionType: sessionType || "Session", amount: Number(amount), source: "manual" });
          setSessionType("");
          setAmount("");
        }}
      >
        <Field label={t("common.date")}>
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("victvs.sessionType")}>
          <Input value={sessionType} onChange={(e) => setSessionType(e.target.value)} placeholder="Pearson VUE Invigilation" />
        </Field>
        <Field label={`${t("common.amount")} (USD)`}>
          <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
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
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  sessions: VictvsSession[];
  onConfirm: (accountId: string, paymentDate: string, receivedAmount: number, categoryId: string | null) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);

  const totalUsd = sumAmounts("USD", sessions.map((s) => s.amount));
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const account = active.find((a) => a.id === (accountId || active.find((x) => x.currency === "USD")?.id || active[0]?.id));
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
          await onConfirm(account.id, paymentDate, Number(shownReceived), victvsCategory?.id ?? null);
          setReceivedTouched(false);
          setReceived("");
        }}
      >
        <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
          <div className="flex justify-between">
            <span className="text-zinc-500">{t("victvs.totalUsd")}</span>
            <span className="font-semibold tabular-nums">{formatAmount(totalUsd, "USD", locale)}</span>
          </div>
        </div>
        <Field label={t("victvs.depositAccount")}>
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
        <p className="text-xs text-zinc-400">{t("victvs.payoutCreated")}</p>
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
