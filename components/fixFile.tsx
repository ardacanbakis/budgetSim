"use client";

import { useMemo, useRef, useState } from "react";
import { readDismissed, useDismissedIssues } from "@/components/dataCheck";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { applyFixFile, FixMismatchError } from "@/lib/data/fixRunner";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useLoans, usePurchases, useRates, useTransactions } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { FixFile, FixStep, Mismatch, parseFixFile, planFixes, StepState, TxEdit } from "@/lib/domain/fixFile";
import { snapshotFromTable } from "@/lib/domain/fx";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

/**
 * Settings → Data check → Apply a fix file: load a file of changes
 * (lib/domain/fixFile.ts), see every step against your records as they are
 * now, and apply them through the repo (lib/data/fixRunner.ts).
 */
export function FixFileCard() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const rates = useRates();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const purchases = usePurchases();
  const loans = useLoans();
  const categories = useCategories();
  const { dismissed, dismiss } = useDismissedIssues();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FixFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const state = useMemo(
    () =>
      accounts.data && transactions.data && purchases.data && loans.data
        ? { accounts: accounts.data, transactions: transactions.data, purchases: purchases.data, loans: loans.data, dismissed }
        : null,
    [accounts.data, transactions.data, purchases.data, loans.data, dismissed]
  );
  const plan = useMemo(() => (file && state ? planFixes(file, state) : null), [file, state]);

  const apply = useAppMutation(
    async (f: FixFile) => {
      if (!rates.data) throw new Error("rates");
      setResult(null);
      try {
        const done = await applyFixFile(repo, f, { fxSnapshot: snapshotFromTable(rates.data), dismissed: readDismissed, dismiss }, setStep);
        setResult(t("fixfile.applied", { applied: done.applied, skipped: done.skipped }));
      } catch (err) {
        if (err instanceof FixMismatchError) setResult(err.step < 0 ? t("fixfile.blocked") : t("fixfile.stopped", { step: err.step + 1 }));
        else throw err;
      } finally {
        setStep(null);
      }
    },
    [KEYS.transactions, KEYS.accounts, KEYS.purchases, KEYS.loans, KEYS.templates]
  );

  const load = async (picked: File) => {
    setResult(null);
    setError(null);
    let data: unknown;
    try {
      data = JSON.parse(await picked.text());
    } catch {
      setFile(null);
      setError(t("fixfile.unreadable"));
      return;
    }
    const parsed = parseFixFile(data);
    if ("error" in parsed) {
      setFile(null);
      setError(t("fixfile.invalid", { reason: parsed.error }));
    } else {
      setFile(parsed.file);
    }
  };

  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a] as const));
  const txById = new Map((transactions.data ?? []).map((tx) => [tx.id, tx] as const));
  const accountName = (id: string | null | undefined) => (id ? (accountById.get(id)?.name ?? "—") : "—");
  const currencyOf = (id: string): Currency => accountById.get(id)?.currency ?? "TRY";
  const money = (amount: number, accountId: string) => formatAmount(amount, currencyOf(accountId), locale);
  const row = (tx: Transaction | undefined, id: string) =>
    tx ? `${fmtDate(tx.dueDate)} · ${tx.description || "—"} · ${tx.direction === "income" ? "+" : "−"}${money(tx.amount, tx.accountId)} (${accountName(tx.accountId)})` : id;

  const changes = (tx: Transaction | undefined, set: TxEdit) =>
    [
      set.accountId ? t("fixfile.setAccount", { value: accountName(set.accountId) }) : null,
      set.amount != null ? t("fixfile.setAmount", { value: money(set.amount, tx?.accountId ?? "") }) : null,
      set.dueDate ? t("fixfile.setDate", { value: fmtDate(set.dueDate) }) : null,
      set.description != null ? t("fixfile.setDescription", { value: set.description }) : null,
      set.categoryId !== undefined
        ? t("fixfile.setCategory", { value: (categories.data ?? []).find((c) => c.id === set.categoryId)?.name ?? "—" })
        : null,
    ]
      .filter(Boolean)
      .join(", ");

  const describe = (s: FixStep): string => {
    switch (s.op) {
      case "editTransaction":
        return t("fixfile.editRow", { row: row(txById.get(s.id), s.id), changes: changes(txById.get(s.id), s.set) });
      case "deleteTransaction": {
        const tx = txById.get(s.id);
        // a one-sided transfer has no other side to take with it
        const paired = tx?.transferGroupId != null && (transactions.data ?? []).some((o) => o.transferGroupId === tx.transferGroupId && o.id !== tx.id);
        return t("fixfile.deleteRow", { row: row(tx, s.id) }) + (paired ? ` ${t("fixfile.otherSide")}` : "");
      }
      case "createTransfer":
        return (
          t("fixfile.transfer", { amount: money(s.fromAmount, s.from), from: accountName(s.from), to: accountName(s.to), date: fmtDate(s.date) }) +
          (s.description ? ` · ${s.description}` : "") +
          (s.legacy ? ` · ${t("fixfile.asHistory")}` : "")
        );
      case "createTransaction":
        return (
          t(s.direction === "income" ? "fixfile.income" : "fixfile.expense", {
            amount: money(s.amount, s.accountId),
            account: accountName(s.accountId),
            date: fmtDate(s.date),
            description: s.description || "—",
          }) + (s.legacy ? ` · ${t("fixfile.asHistory")}` : "")
        );
      case "completeTransactions":
        return t("fixfile.complete", {
          count: s.ids.length,
          rows: s.ids.map((id) => txById.get(id)?.description || id).join(", "),
        });
      case "createPurchase":
        return t("fixfile.purchase", {
          account: accountName(s.accountId),
          name: s.name,
          amount: money(s.amount, s.accountId),
          count: s.installments,
          date: fmtDate(s.firstDue),
        });
      case "createDebt": {
        const purchase = (purchases.data ?? []).find((p) => p.id === s.purchaseId);
        return purchase
          ? t("fixfile.debtVia", { name: s.name, amount: money(s.principal, s.payAccountId), purchase: purchase.name })
          : t("fixfile.debtOwn", { name: s.name, amount: money(s.principal, s.payAccountId), account: accountName(s.payAccountId) });
      }
      case "dismissIssue": {
        const [kind, id] = s.issueId.split(":");
        const loan = kind === "debtWithoutDate" ? (loans.data ?? []).find((l) => l.id === id) : undefined;
        const short = t(`datacheck.short_${kind}`);
        const what = loan ? t("fixfile.noDate", { name: loan.counterparty || loan.name }) : short.startsWith("datacheck.") ? s.issueId : short;
        return t("fixfile.dismiss", { what });
      }
    }
  };

  const fieldLabel: Record<string, string> = {
    accountId: t("fixfile.fieldAccount"),
    amount: t("fixfile.fieldAmount"),
    dueDate: t("fixfile.fieldDate"),
    status: t("fixfile.fieldStatus"),
    legacy: t("fixfile.fieldLegacy"),
    direction: t("fixfile.fieldDirection"),
  };
  const value = (field: string, v: unknown, accountId: string): string => {
    if (field === "accountId") return accountName(v as string);
    if (field === "amount" && typeof v === "number") return money(v, accountId);
    if (field === "dueDate") return fmtDate(v as string);
    if (field === "status") return t(v === "completed" ? "tx.completed" : "tx.planned");
    if (field === "legacy") return t(v ? "fixfile.yes" : "fixfile.no");
    return String(v ?? "—");
  };
  const problem = (p: Mismatch): string => {
    if (p.kind !== "field") return t(`fixfile.${p.kind}`);
    const accountId = txById.get(p.id)?.accountId ?? "";
    return t("fixfile.field", { field: fieldLabel[p.field] ?? p.field, actual: value(p.field, p.actual, accountId), expected: value(p.field, p.expected, accountId) });
  };
  const badge = (s: StepState) =>
    s.status === "ready" ? <Badge tone="teal">{t("fixfile.ready")}</Badge> : s.status === "done" ? <Badge tone="zinc">{t("fixfile.done")}</Badge> : <Badge tone="red">{t("fixfile.mismatch")}</Badge>;

  return (
    <Card>
      <CardHeader title={t("fixfile.title")} />
      <div className="space-y-4 p-4" data-fixfile>
        <p className="text-sm text-zinc-500">{t("fixfile.intro")}</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void load(picked);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={apply.isPending}>
            ⬆ {t("fixfile.choose")}
          </Button>
          {file ? (
            <Button
              variant="ghost"
              disabled={apply.isPending}
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
            >
              {t("fixfile.close")}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {file && plan ? (
          <section className="space-y-3">
            <div>
              {file.title ? <h3 className="text-sm font-medium">{file.title}</h3> : null}
              <p className="text-xs text-zinc-500">{t("fixfile.steps", { count: file.steps.length })}</p>
            </div>
            <ol className="space-y-2">
              {file.steps.map((s, i) => {
                const st = plan.states[i];
                return (
                  <li key={i} data-fix-step={st.status} className="space-y-1 rounded-lg border border-[var(--edge)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm">
                        <span className="mr-1 tabular-nums text-zinc-400">{i + 1}.</span>
                        {describe(s)}
                      </p>
                      {badge(st)}
                    </div>
                    {s.note ? <p className="text-xs text-zinc-500">{s.note}</p> : null}
                    {st.status === "mismatch"
                      ? st.problems.map((p, j) => (
                          <p key={j} className="text-xs text-red-600 dark:text-red-400">
                            {problem(p)}
                          </p>
                        ))
                      : null}
                  </li>
                );
              })}
            </ol>
            {plan.blocked ? (
              <p className="text-sm text-red-600 dark:text-red-400">{t("fixfile.blocked")}</p>
            ) : plan.ready === 0 ? (
              <p className="text-sm text-zinc-500">{t("fixfile.allDone")}</p>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {!rates.data ? <span className="text-xs text-zinc-500">{t("fixfile.needRates")}</span> : null}
                {step != null ? <span className="text-xs text-zinc-500">{t("fixfile.applying", { step: step + 1, total: file.steps.length })}</span> : null}
                <Button variant="primary" disabled={apply.isPending || !rates.data} onClick={() => apply.mutate(file)}>
                  {t("fixfile.apply", { count: plan.ready })}
                </Button>
              </div>
            )}
          </section>
        ) : null}
        {result ? <p className="text-sm">{result}</p> : null}
      </div>
    </Card>
  );
}
