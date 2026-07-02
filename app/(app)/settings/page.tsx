"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Field, Input, Select, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useBudgets, useCategories } from "@/lib/data/queries";
import { TxDirection } from "@/lib/data/types";
import { CURRENCIES, Currency } from "@/lib/domain/currencies";
import { Locale, useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { session, displayCurrency, setDisplayCurrency, signOut, resetDemo } = useApp();
  const repo = useRepo();
  const categories = useCategories();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatDirection, setNewCatDirection] = useState<TxDirection>("expense");

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
      <h1 className="text-xl font-bold">{t("settings.title")}</h1>

      <Card>
        <CardHeader title={t("settings.displayCurrency")} />
        <div className="space-y-2 p-4">
          <Select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {t(`currency.${c}`)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-zinc-400">{t("settings.displayHint")}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.language")} />
        <div className="p-4">
          <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </Select>
        </div>
      </Card>

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
