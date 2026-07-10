"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useCategories,
  usePurchases,
  useRates,
  useTransactions,
} from "@/lib/data/queries";
import { NewPurchase } from "@/lib/data/repo";
import { Account, Purchase } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import {
  buildInstallmentPlan,
  defaultFirstDue,
  lastDueDate,
  purchaseProgress,
} from "@/lib/domain/purchases";
import { averageMonthlySpend } from "@/lib/domain/stats";
import { todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

const PURCHASE_KEYS = [KEYS.purchases, KEYS.transactions, KEYS.accounts];

export default function PurchasesPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const purchases = usePurchases();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const rates = useRates();
  const [modalOpen, setModalOpen] = useState(false);

  const setReflected = useAppMutation(
    (v: { id: string; reflected: boolean }) =>
      repo.setPurchaseReflected(v.id, v.reflected, rates.data ? snapshotFromTable(rates.data) : null),
    PURCHASE_KEYS
  );
  const deletePurchase = useAppMutation(
    (v: { id: string; deleteTransactions: boolean }) => repo.deletePurchase(v.id, v.deleteTransactions),
    PURCHASE_KEYS
  );

  const balances = useMemo(
    () => (accounts.data && transactions.data ? computeBalances(accounts.data, transactions.data) : new Map<string, number>()),
    [accounts.data, transactions.data]
  );

  const stats = useMemo(() => {
    if (!accounts.data || !transactions.data || !categories.data || !rates.data) return null;
    return averageMonthlySpend({
      transactions: transactions.data,
      accounts: accounts.data,
      categories: categories.data,
      usdPer: rates.data.usdPer,
      display: displayCurrency,
      windowMonths: 3,
      today: todayISO(),
    });
  }, [accounts.data, transactions.data, categories.data, rates.data, displayCurrency]);

  if (purchases.isLoading || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const accountList = accounts.data ?? [];
  const cards = accountList.filter((a) => a.kind === "credit_card" && !a.archived);
  const byAccount = new Map<string | null, Purchase[]>();
  for (const p of purchases.data ?? []) {
    const key = p.accountId;
    byAccount.set(key, [...(byAccount.get(key) ?? []), p]);
  }
  const nonCardPurchases = (purchases.data ?? []).filter(
    (p) => !p.accountId || !cards.some((c) => c.id === p.accountId)
  );

  function renderPurchase(purchase: Purchase, account: Account | undefined) {
    const currency = account?.currency ?? "TRY";
    const progress = purchaseProgress(purchase, transactions.data ?? [], currency);
    const isInstallment = purchase.installmentCount > 1;
    const pct = isInstallment && purchase.reflected ? Math.round((progress.paidCount / progress.totalCount) * 100) : 0;
    return (
      <div key={purchase.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">{purchase.name}</span>
              <Badge tone={purchase.reflected ? "green" : "zinc"}>
                {purchase.reflected ? t("purchases.reflected") : t("purchases.logOnly")}
              </Badge>
              {isInstallment ? (
                <Badge tone="sky">
                  {purchase.installmentCount}× {t("purchases.installments").toLowerCase()}
                </Badge>
              ) : (
                <Badge tone="zinc">{t("purchases.oneShot")}</Badge>
              )}
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatAmount(purchase.amount, currency, locale)}</div>
            <div className="text-xs text-zinc-500">
              {fmtDate(purchase.purchaseDate)}
              {isInstallment
                ? ` · ${formatAmount(buildInstallmentPlan({ amount: purchase.amount, currency, count: purchase.installmentCount, firstDue: purchase.firstDue })[0].amount, currency, locale)} ${t("purchases.perInstallment")} · ${fmtDate(purchase.firstDue)} → ${fmtDate(lastDueDate(purchase.firstDue, purchase.installmentCount))}`
                : ""}
            </div>
            {purchase.details ? <div className="mt-1 text-xs text-zinc-400">{purchase.details}</div> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-600"
                checked={purchase.reflected}
                disabled={!purchase.accountId || setReflected.isPending}
                onChange={(e) => {
                  const on = e.target.checked;
                  const warning = on ? t("purchases.reflectOnWarning") : t("purchases.reflectOffWarning");
                  if (window.confirm(warning)) setReflected.mutate({ id: purchase.id, reflected: on });
                }}
              />
              {t("purchases.reflect")}
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                if (!window.confirm(t("common.confirmDelete"))) return;
                const alsoTx =
                  purchase.reflected && window.confirm(`${t("purchases.deleteTitle")}: ${t("purchases.deleteAlsoTx")}?`);
                deletePurchase.mutate({ id: purchase.id, deleteTransactions: alsoTx });
              }}
            >
              ✕
            </Button>
          </div>
        </div>
        {isInstallment && purchase.reflected ? (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>{t("purchases.progress", { paid: progress.paidCount, total: progress.totalCount })}</span>
              <span>
                {t("purchases.remaining")}: {formatAmount(progress.remainingAmount, currency, locale)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("purchases.title")}</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + {t("purchases.newPurchase")}
        </Button>
      </div>

      {(purchases.data ?? []).length === 0 && cards.length === 0 ? <EmptyState>{t("purchases.empty")}</EmptyState> : null}

      {cards.map((card) => {
        const cardPurchases = byAccount.get(card.id) ?? [];
        const debt = balances.get(card.id) ?? 0;
        const upcoming = sumAmounts(
          card.currency,
          (transactions.data ?? [])
            .filter((tx) => tx.accountId === card.id && tx.status === "planned" && tx.direction === "expense")
            .map((tx) => tx.amount)
        );
        const avg = stats?.byAccount.get(card.id);
        return (
          <Card key={card.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {card.name}
                  <Badge tone="red">
                    {t("purchases.postedDebt")}: {formatAmount(-debt, card.currency, locale)}
                  </Badge>
                  {upcoming > 0 ? (
                    <Badge tone="amber">
                      {t("purchases.upcomingInstallments")}: {formatAmount(upcoming, card.currency, locale)}
                    </Badge>
                  ) : null}
                  {avg ? (
                    <Badge tone="zinc">
                      {t("purchases.avgMonthlySpend")}: {formatAmount(avg, displayCurrency, locale)}
                    </Badge>
                  ) : null}
                </span>
              }
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 3xl:grid-cols-3">
              {cardPurchases.length === 0 ? (
                <p className="text-sm text-zinc-400">{t("purchases.empty")}</p>
              ) : (
                cardPurchases.map((p) => renderPurchase(p, card))
              )}
            </div>
          </Card>
        );
      })}

      {nonCardPurchases.length > 0 ? (
        <Card>
          <CardHeader title={t("purchases.otherAccounts")} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 3xl:grid-cols-3">
            {nonCardPurchases.map((p) =>
              renderPurchase(
                p,
                accountList.find((a) => a.id === p.accountId)
              )
            )}
          </div>
        </Card>
      ) : null}

      <PurchaseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

function PurchaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [hasInstallments, setHasInstallments] = useState(true);
  const [count, setCount] = useState("6");
  const [firstDue, setFirstDue] = useState("");
  const [details, setDetails] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reflected, setReflected] = useState(true);

  const createPurchase = useAppMutation(
    (input: NewPurchase) => repo.createPurchase(input, rates.data ? snapshotFromTable(rates.data) : null),
    PURCHASE_KEYS
  );

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  // cards first — the primary use case
  const ordered = [...active].sort((a, b) => Number(b.kind === "credit_card") - Number(a.kind === "credit_card"));
  const account = ordered.find((a) => a.id === accountId) ?? ordered[0];
  const effectiveFirstDue = firstDue || defaultFirstDue(purchaseDate);
  const parsedCount = Math.max(1, Math.floor(Number(count) || 1));
  const parsedAmount = Number(amount);
  const expenseCategories = (categories.data ?? []).filter((c) => c.direction === "expense");

  const perInstallment =
    account && parsedAmount > 0 && hasInstallments && parsedCount > 1
      ? buildInstallmentPlan({ amount: parsedAmount, currency: account.currency, count: parsedCount, firstDue: effectiveFirstDue })[0].amount
      : null;

  return (
    <Modal open={open} onClose={onClose} title={t("purchases.newPurchase")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!account || !(parsedAmount > 0)) return;
          await createPurchase.mutateAsync({
            name,
            accountId: account.id,
            amount: parsedAmount,
            purchaseDate,
            installmentCount: hasInstallments ? parsedCount : 1,
            firstDue: hasInstallments ? effectiveFirstDue : purchaseDate,
            details,
            reflected,
            categoryId: categoryId || null,
          });
          setName("");
          setAmount("");
          setDetails("");
          onClose();
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone 17" />
        </Field>
        <Field label={t("purchases.paidWith")}>
          <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kind === "credit_card" ? "💳 " : ""}
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} ${account ? `(${account.currency})` : ""}`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("purchases.purchaseDate")}>
            <Input type="date" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={hasInstallments} onChange={(e) => setHasInstallments(e.target.checked)} />
          <span className="text-sm font-medium">{t("purchases.installments")}</span>
        </label>

        {hasInstallments ? (
          <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("purchases.installmentCount")}>
                <Input type="number" step="1" min="2" max="48" required value={count} onChange={(e) => setCount(e.target.value)} />
              </Field>
              <Field label={t("purchases.firstDue")}>
                <Input type="date" value={effectiveFirstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              {perInstallment != null && account
                ? `${formatAmount(perInstallment, account.currency, locale)} ${t("purchases.perInstallment")} · `
                : ""}
              {t("purchases.lastDue")}: {lastDueDate(effectiveFirstDue, parsedCount)}
            </p>
          </div>
        ) : null}

        <Field label={t("common.category")}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("purchases.details")} (${t("common.optional")})`}>
          <Textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>

        <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={reflected} onChange={(e) => setReflected(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">{t("purchases.reflect")}</span>
            <span className="block text-xs text-zinc-500">{t("purchases.reflectHint")}</span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={createPurchase.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
