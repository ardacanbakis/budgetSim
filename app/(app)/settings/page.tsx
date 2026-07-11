"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { THEMES, Theme, useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useBudgets, useCategories, useRates, useTransactions, useUserSettings } from "@/lib/data/queries";
import { isBackupFile } from "@/lib/data/repo";
import { DEFAULT_VICTVS_AMOUNTS, TxDirection, VICTVS_TYPES, victvsTypeList } from "@/lib/data/types";
import { NAV, orderedNav } from "@/components/shell";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { parseVictvsPaste } from "@/lib/domain/victvsParser";
import { DATE_FORMATS, DATE_FORMAT_SAMPLE, DateFormat, DEFAULT_DATE_FORMAT, formatDate } from "@/lib/domain/dates";
import { useFormatDate } from "@/lib/useFormatDate";
import { Locale, useI18n } from "@/lib/i18n";

const SETTINGS_TABS = ["preferences", "categories", "victvs", "data", "account"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];
const TAB_ICON: Record<SettingsTab, string> = {
  preferences: "⚙",
  categories: "🏷",
  victvs: "✓",
  data: "⇅",
  account: "👤",
};

export default function SettingsPage() {
  const { t } = useI18n();
  const { session, signOut, resetDemo } = useApp();
  const repo = useRepo();
  const categories = useCategories();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatDirection, setNewCatDirection] = useState<TxDirection>("expense");
  const [tab, setTab] = useState<SettingsTab>("preferences");

  useEffect(() => {
    queueMicrotask(() => {
      const saved = window.localStorage.getItem("renovator-settings-tab");
      if (saved && (SETTINGS_TABS as readonly string[]).includes(saved)) setTab(saved as SettingsTab);
    });
  }, []);
  const switchTab = (v: SettingsTab) => {
    setTab(v);
    window.localStorage.setItem("renovator-settings-tab", v);
  };

  const createCategory = useAppMutation(
    (input: { name: string; direction: TxDirection; color: string }) => repo.createCategory(input),
    [KEYS.categories]
  );
  const deleteCategory = useAppMutation((id: string) => repo.deleteCategory(id), [KEYS.categories, KEYS.transactions]);
  const deleteAll = useAppMutation(() => repo.deleteAllData(), Object.values(KEYS));

  if (categories.isLoading) return <Spinner />;

  const isDemo = session.status === "ready" && session.repo.mode === "demo";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-zinc-500">{t("settings.subtitle")}</p>
      </div>

      {/* tab bar — scrollable on narrow screens */}
      <div className="sticky top-14 z-30 -mx-1 overflow-x-auto bg-[var(--page)]/95 px-1 py-1 backdrop-blur md:top-16">
        <div className="flex w-max min-w-full gap-1 rounded-xl bg-[var(--edge-soft)] p-1">
          {SETTINGS_TABS.map((v) => (
            <button
              key={v}
              onClick={() => switchTab(v)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === v ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <span className="text-xs">{TAB_ICON[v]}</span>
              {t(`settings.tab_${v}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === "preferences" ? (
        <>
          <PreferencesCard />
          <AppearanceCard />
          <SidebarOrderCard />
        </>
      ) : null}

      {tab === "categories" ? (
        <>
        <Card>
          <CardHeader title={t("settings.categories")} />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-1.5">
              {(categories.data ?? []).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: c.color }}
                >
                  {c.name}
                  <button
                    aria-label={t("common.delete")}
                    onClick={() => window.confirm(t("common.confirmDelete")) && deleteCategory.mutate(c.id)}
                    className="opacity-70 hover:opacity-100"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCatName.trim()) return;
                const colors = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#16a34a", "#ec4899", "#64748b"];
                await createCategory.mutateAsync({
                  name: newCatName.trim(),
                  direction: newCatDirection,
                  color: colors[Math.floor(Math.random() * colors.length)],
                });
                setNewCatName("");
              }}
            >
              <div className="min-w-40 flex-1">
                <Field label={t("settings.newCategory")}>
                  <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
                </Field>
              </div>
              <Select className="!w-auto" value={newCatDirection} onChange={(e) => setNewCatDirection(e.target.value as TxDirection)}>
                <option value="expense">{t("tx.expense")}</option>
                <option value="income">{t("tx.income")}</option>
              </Select>
              <Button type="submit">{t("common.add")}</Button>
            </form>
          </div>
        </Card>
        <BudgetsEditor />
        </>
      ) : null}

      {tab === "victvs" ? <VictvsSettingsCard /> : null}

      {tab === "data" ? (
        <>
          <ExportsCard />
          <LegacyCard />
        </>
      ) : null}

      {tab === "account" ? (
        <>
          <Card>
            <CardHeader title={t("settings.account")} />
            <div className="space-y-3 p-4 text-sm">
              {session.status === "ready" && session.email ? (
                <p>
                  {t("settings.signedInAs")}: <span className="font-medium">{session.email}</span>
                </p>
              ) : null}
              {isDemo ? (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => resetDemo()}>{t("auth.resetDemo")}</Button>
                  <Button onClick={() => signOut().then(() => router.replace("/login"))}>{t("auth.exitDemo")}</Button>
                </div>
              ) : (
                <Button onClick={() => signOut().then(() => router.replace("/login"))}>{t("nav.logout")}</Button>
              )}
            </div>
          </Card>

          <Card className="border-red-200 dark:border-red-900">
            <CardHeader title={<span className="text-red-600">{t("settings.dangerZone")}</span>} />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-500">{t("settings.deleteAllConfirm")}</p>
              <div className="flex gap-2">
                <Input className="max-w-40" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
                <Button
                  variant="danger"
                  disabled={confirmText !== "DELETE" || deleteAll.isPending}
                  onClick={async () => {
                    await deleteAll.mutateAsync(undefined as never);
                    setConfirmText("");
                  }}
                >
                  {t("settings.deleteAll")}
                </Button>
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function BudgetsEditor() {
  const { t } = useI18n();
  const repo = useRepo();
  const categories = useCategories();
  const budgets = useBudgets();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const setBudget = useAppMutation(
    (v: { categoryId: string; limit: number | null; currency: Currency }) =>
      repo.setBudget(v.categoryId, v.limit, v.currency),
    [KEYS.budgets]
  );

  const expense = (categories.data ?? []).filter((c) => c.direction === "expense");
  const budgetByCategory = new Map((budgets.data ?? []).map((b) => [b.categoryId, b]));

  return (
    <Card>
      <CardHeader title={t("budgets.title")} />
      <div className="space-y-2 p-4">
        {expense.map((c) => {
          const budget = budgetByCategory.get(c.id);
          const draft = drafts[c.id] ?? (budget ? String(budget.monthlyLimit) : "");
          return (
            <div key={c.id} className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </span>
              <Input
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder={t("budgets.limit")}
                className="!w-32 text-right"
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                onBlur={() => {
                  const value = Number(draft);
                  const limit = draft.trim() === "" || !(value > 0) ? null : value;
                  const current = budget?.monthlyLimit ?? null;
                  if (limit !== current) {
                    setBudget.mutate({ categoryId: c.id, limit, currency: budget?.currency ?? "TRY" });
                  }
                }}
              />
              <span className="w-9 text-xs text-zinc-400">{budget?.currency ?? "TRY"}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PreferencesCard() {
  const { t, locale, setLocale } = useI18n();
  const { displayCurrency, setDisplayCurrency } = useApp();
  const repo = useRepo();
  const settings = useUserSettings();
  const save = useAppMutation(
    (patch: Parameters<typeof repo.saveUserSettings>[0]) => repo.saveUserSettings(patch),
    [KEYS.userSettings]
  );

  const dateFormat = settings.data?.dateFormat ?? DEFAULT_DATE_FORMAT;
  const showQuickAdd = settings.data?.showQuickAdd ?? true;

  return (
    <Card>
      <CardHeader title={t("settings.preferences")} />
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={t("settings.displayCurrency")} hint={t("settings.displayHint")}>
          <Select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {t(`currency.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.language")}>
          <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </Select>
        </Field>
        <Field label={t("settings.dateFormat")} hint={`${t("settings.dateFormatHint")}: ${formatDate(DATE_FORMAT_SAMPLE, dateFormat, locale)}`}>
          <Select value={dateFormat} onChange={(e) => save.mutate({ dateFormat: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatDate(DATE_FORMAT_SAMPLE, f, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-2 self-end rounded-lg bg-[var(--edge-soft)] p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-teal-600"
            checked={showQuickAdd}
            onChange={(e) => save.mutate({ showQuickAdd: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium">{t("settings.quickAdd")}</span>
            <span className="block text-xs text-zinc-500">{t("settings.quickAddHint")}</span>
          </span>
        </label>
      </div>
    </Card>
  );
}

function AppearanceCard() {
  const { t } = useI18n();
  const { theme, setTheme, compact, setCompact } = useApp();
  return (
    <Card>
      <CardHeader title={t("theme.title")} />
      <div className="space-y-3 p-4">
        <Field label={t("theme.theme")}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {THEMES.map(({ id, preview }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id as Theme)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs capitalize transition-colors ${
                  theme === id ? "border-teal-500 ring-1 ring-teal-500/50" : "border-[var(--edge)] hover:border-teal-500/40"
                }`}
              >
                <span
                  className="flex h-8 w-full items-center justify-center rounded-md border border-black/10"
                  style={{ backgroundColor: preview.bg }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: preview.accent }} />
                </span>
                {id === "system" || id === "light" || id === "dark" ? t(`theme.${id}`) : id}
              </button>
            ))}
          </div>
        </Field>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-teal-600"
            checked={compact}
            onChange={(e) => setCompact(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">{t("theme.compact")}</span>
            <span className="block text-xs text-zinc-500">{t("theme.compactHint")}</span>
          </span>
        </label>
      </div>
    </Card>
  );
}

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

function ExportsCard() {
  const { t } = useI18n();
  const repo = useRepo();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  async function exportJson() {
    const backup = await repo.exportAll();
    downloadFile(`renovator-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json");
  }

  async function exportCsv(table: "transactions" | "accounts" | "purchases" | "victvsSessions") {
    const backup = await repo.exportAll();
    downloadFile(`renovator-${table}-${stamp}.csv`, toCsv(backup[table] as unknown as Record<string, unknown>[]), "text/csv");
  }

  async function restore(file: File) {
    setMessage(null);
    try {
      const data = JSON.parse(await file.text());
      if (!isBackupFile(data)) {
        setMessage(t("exports.invalidFile"));
        return;
      }
      await repo.importAll(data);
      queryClient.clear();
      setMessage(t("exports.restored"));
      setRestoreConfirm("");
    } catch {
      setMessage(t("exports.invalidFile"));
    }
  }

  return (
    <Card>
      <CardHeader title={t("exports.title")} />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={exportJson}>
            ⬇ {t("exports.downloadJson")}
          </Button>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">{t("exports.csv")}</p>
          <div className="flex flex-wrap gap-2">
            {(["transactions", "accounts", "purchases", "victvsSessions"] as const).map((table) => (
              <Button key={table} onClick={() => exportCsv(table)}>
                {table}.csv
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-xs text-amber-800 dark:text-amber-200">{t("exports.restoreWarning")}</p>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-40" value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} placeholder="RESTORE" />
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) restore(file);
                e.target.value = "";
              }}
            />
            <Button disabled={restoreConfirm !== "RESTORE"} onClick={() => fileRef.current?.click()}>
              ⬆ {t("exports.restoreJson")}
            </Button>
          </div>
          {message ? <p className="text-xs font-medium">{message}</p> : null}
        </div>
      </div>
    </Card>
  );
}

function VictvsSettingsCard() {
  const { t } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const settings = useUserSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newType, setNewType] = useState("");
  const [newTypeAmount, setNewTypeAmount] = useState("");

  const save = useAppMutation(
    (patch: Parameters<typeof repo.saveUserSettings>[0]) => repo.saveUserSettings(patch),
    [KEYS.userSettings]
  );

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const defaults: Record<string, number> = { ...DEFAULT_VICTVS_AMOUNTS, ...(settings.data?.victvsDefaults ?? {}) };

  return (
    <Card>
      <CardHeader title={t("victvs.settingsTitle")} />
      <div className="space-y-4 p-4">
        <Field label={t("victvs.settingsAccount")} hint={t("victvs.settingsAccountHint")}>
          <Select
            value={settings.data?.victvsAccountId ?? ""}
            onChange={(e) => save.mutate({ victvsAccountId: e.target.value || null })}
          >
            <option value="">{t("common.none")}</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">{t("victvs.settingsDefaults")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {victvsTypeList(defaults).map((type) => {
              const isCustom = !(VICTVS_TYPES as readonly string[]).includes(type);
              return (
                <label key={type} className="block space-y-1">
                  <span className="flex items-center gap-1 text-xs text-zinc-400">
                    {type}
                    {isCustom ? (
                      <button
                        type="button"
                        aria-label={t("common.delete")}
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() => {
                          const next = { ...defaults };
                          delete next[type];
                          save.mutate({ victvsDefaults: next });
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                  </span>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={drafts[type] ?? String(defaults[type] ?? "")}
                    onChange={(e) => setDrafts((d) => ({ ...d, [type]: e.target.value }))}
                    onBlur={() => {
                      const value = Number(drafts[type]);
                      if (drafts[type] != null && value > 0 && value !== defaults[type]) {
                        save.mutate({ victvsDefaults: { ...defaults, [type]: value } });
                      }
                    }}
                  />
                </label>
              );
            })}
          </div>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newType.trim();
              const amount = Number(newTypeAmount);
              if (!name || !(amount > 0) || defaults[name] != null) return;
              save.mutate({ victvsDefaults: { ...defaults, [name]: amount } });
              setNewType("");
              setNewTypeAmount("");
            }}
          >
            <div className="min-w-32 flex-1">
              <Field label={t("victvs.newType")}>
                <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="IELTS" />
              </Field>
            </div>
            <div className="w-28">
              <Field label={`${t("common.amount")} ($)`}>
                <Input type="number" step="any" min="0" value={newTypeAmount} onChange={(e) => setNewTypeAmount(e.target.value)} />
              </Field>
            </div>
            <Button type="submit">{t("common.add")}</Button>
          </form>
        </div>
      </div>
    </Card>
  );
}

function SidebarOrderCard() {
  const { t } = useI18n();
  const repo = useRepo();
  const settings = useUserSettings();

  const save = useAppMutation(
    (navOrder: string[]) => repo.saveUserSettings({ navOrder }),
    [KEYS.userSettings]
  );

  const nav = orderedNav(settings.data?.navOrder);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= nav.length) return;
    const next = nav.map((item) => item.href);
    [next[index], next[target]] = [next[target], next[index]];
    save.mutate(next);
  };

  return (
    <Card>
      <CardHeader
        title={t("settings.sidebar")}
        action={
          settings.data?.navOrder ? (
            <Button variant="ghost" onClick={() => save.mutate(NAV.map((item) => item.href))}>
              {t("settings.sidebarReset")}
            </Button>
          ) : undefined
        }
      />
      <ul className="divide-y divide-[var(--edge-soft)]">
        {nav.map((item, index) => (
          <li key={item.href} className="flex items-center gap-3 px-4 py-2">
            <span className="w-4 text-center text-zinc-400">{item.icon}</span>
            <span className="flex-1 text-sm">{t(item.key)}</span>
            <button
              onClick={() => move(index, -1)}
              disabled={index === 0}
              className="px-1.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
              aria-label={t("layout.moveUp")}
            >
              ↑
            </button>
            <button
              onClick={() => move(index, 1)}
              disabled={index === nav.length - 1}
              className="px-1.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
              aria-label={t("layout.moveDown")}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LegacyCard() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const settings = useUserSettings();
  const rates = useRates();

  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [direction, setDirection] = useState<TxDirection>("income");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  const importSessions = useAppMutation(
    (inputs: Parameters<typeof repo.createVictvsSessions>[0]) => repo.createVictvsSessions(inputs),
    [KEYS.victvsSessions]
  );
  const addLegacyTx = useAppMutation(
    (input: Parameters<typeof repo.createTransaction>[0]) => repo.createTransaction(input),
    [KEYS.transactions]
  );
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), [KEYS.transactions]);

  const defaults: Record<string, number> = { ...DEFAULT_VICTVS_AMOUNTS, ...(settings.data?.victvsDefaults ?? {}) };
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const account = active.find((a) => a.id === accountId) ?? active[0];
  const dirCategories = (categories.data ?? []).filter((c) => c.direction === direction);
  const accountById = new Map(active.map((a) => [a.id, a]));
  const legacyTxs = (transactions.data ?? [])
    .filter((tx) => tx.legacy)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  async function importVictvs() {
    setMessage(null);
    const { sessions } = parseVictvsPaste(pasteText);
    if (!sessions.length) return;
    await importSessions.mutateAsync(
      sessions.map((s) => ({
        date: s.date,
        sessionType: s.sessionType,
        sessionNo: s.sessionNo,
        amount: s.amount ?? defaults[s.sessionType] ?? 0,
        source: "paste" as const,
        status: "paid" as const,
      }))
    );
    setPasteText("");
    setMessage(t("legacy.added", { count: sessions.length }));
  }

  return (
    <Card>
      <CardHeader title={t("legacy.title")} />
      <div className="space-y-5 p-4">
        <p className="text-xs text-zinc-500">{t("legacy.hint")}</p>

        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500">{t("legacy.victvsTitle")}</p>
          <Textarea
            rows={4}
            placeholder={"21 Jan 26\tCIPS OR Exam \t32138\t37.5"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">{t("legacy.victvsHint")}</span>
            <Button onClick={importVictvs} disabled={!pasteText.trim() || importSessions.isPending}>
              {t("common.add")}
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-[var(--edge-soft)] pt-4">
          <p className="text-xs font-medium text-zinc-500">{t("legacy.txTitle")}</p>
          <form
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!account || !(Number(amount) > 0)) return;
              await addLegacyTx.mutateAsync({
                accountId: account.id,
                direction,
                categoryId: categoryId || null,
                amount: Number(amount),
                status: "completed",
                dueDate: date,
                description,
                fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
                legacy: true,
              });
              setAmount("");
              setDescription("");
              setMessage(t("legacy.added", { count: 1 }));
            }}
          >
            <Field label={t("tx.filterDirection")}>
              <Select value={direction} onChange={(e) => { setDirection(e.target.value as TxDirection); setCategoryId(""); }}>
                <option value="income">{t("tx.income")}</option>
                <option value="expense">{t("tx.expense")}</option>
              </Select>
            </Field>
            <Field label={t("common.account")}>
              <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("common.category")}>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {dirCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`${t("common.amount")} ${account ? `(${account.currency})` : ""}`}>
              <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t("common.date")}>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={`${t("common.description")} (${t("common.optional")})`}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-3">
              <span className="text-xs text-zinc-400">{t("legacy.txHint")}</span>
              <Button type="submit" variant="primary" disabled={addLegacyTx.isPending}>
                {t("legacy.add")}
              </Button>
            </div>
          </form>
          {message ? <p className="text-xs font-medium text-emerald-600">{message}</p> : null}
        </div>

        <div className="space-y-2 border-t border-[var(--edge-soft)] pt-4">
          <p className="text-xs font-medium text-zinc-500">{t("legacy.listTitle")}</p>
          {legacyTxs.length === 0 ? (
            <EmptyState>{t("legacy.empty")}</EmptyState>
          ) : (
            <ul className="max-h-72 divide-y divide-[var(--edge-soft)] overflow-y-auto">
              {legacyTxs.map((tx) => {
                const acc = accountById.get(tx.accountId);
                return (
                  <li key={tx.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm">{tx.description || "—"}</span>
                        <Badge tone="zinc">{t("legacy.badge")}</Badge>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {acc?.name} · {fmtDate(tx.dueDate)}
                      </div>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${tx.direction === "income" ? "text-green-600" : "text-red-600"}`}>
                      {tx.direction === "income" ? "+" : "−"}
                      {acc ? formatAmount(tx.amount, acc.currency, locale) : tx.amount}
                    </span>
                    <Button variant="ghost" aria-label={t("common.delete")} onClick={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(tx.id)}>
                      ✕
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
