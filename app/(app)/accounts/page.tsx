"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Account, Transaction } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { CURRENCIES, CURRENCY_META, Currency, formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { ColumnsToggle, columnClass, useColumns } from "@/components/columns";
import { useLocalToggle } from "@/lib/prefs";

/** Day-of-month as an ordinal: "15th" (en) / "15." (tr). */
function ordinal(day: number, locale: string): string {
  if (locale === "tr") return `${day}.`;
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export default function PortfolioPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const rates = useRates();
  const [modalOpen, setModalOpen] = useState(false);
  const { columns, setColumns } = useColumns("renovator-cols-portfolio");
  const hideEmpty = useLocalToggle("renovator-portfolio-hide-empty", false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestFirst, setLatestFirst] = useState(true);

  const createAccount = useAppMutation((input: NewAccount) => repo.createAccount(input), [KEYS.accounts]);
  const updateAccount = useAppMutation(
    (v: { id: string; patch: Partial<NewAccount> & { archived?: boolean } }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts, KEYS.transactions]
  );
  const deleteAccount = useAppMutation((id: string) => repo.deleteAccount(id), [KEYS.accounts, KEYS.transactions]);

  const balances = useMemo(
    () => (accounts.data && transactions.data ? computeBalances(accounts.data, transactions.data) : new Map<string, number>()),
    [accounts.data, transactions.data]
  );

  if (accounts.isLoading || transactions.isLoading) return <Spinner />;

  // an account sitting at zero is noise on a page about what you hold
  const all = (accounts.data ?? []).filter((a) => !a.archived);
  const list = hideEmpty.value ? all.filter((a) => Math.abs(balances.get(a.id) ?? 0) > 1e-9) : all;
  const emptyCount = all.length - list.length;
  const archived = (accounts.data ?? []).filter((a) => a.archived);
  const sections: Array<{ key: string; title: string; items: Account[] }> = [
    { key: "accounts", title: t("portfolio.accounts"), items: list.filter((a) => a.kind === "fiat") },
    { key: "assets", title: t("portfolio.assets"), items: list.filter((a) => a.kind === "crypto" || a.kind === "gold") },
  ];
  const selected = (accounts.data ?? []).find((a) => a.id === selectedId) ?? null;
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]));

  function itemRow(account: Account) {
    const balance = balances.get(account.id) ?? 0;
    const converted = rates.data ? convert(balance, account.currency, displayCurrency, rates.data.usdPer) : null;
    const isCard = account.kind === "credit_card";
    const active = selectedId === account.id;
    return (
      <button
        key={account.id}
        onClick={() => setSelectedId(account.id)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
          active ? "bg-teal-50 ring-1 ring-teal-500/40 dark:bg-teal-950" : "hover:bg-[var(--edge-soft)]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-base">{isCard ? "💳" : account.kind === "crypto" ? "₿" : account.kind === "gold" ? "🪙" : "🏦"}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{account.name}</span>
            <span className="block text-[11px] text-zinc-400">{account.currency === "XAU_G" ? "GOLD g" : account.currency}</span>
          </span>
        </span>
        <span className="text-right">
          <span className={`block text-sm font-semibold tabular-nums ${isCard && balance < 0 ? "text-red-600" : ""}`}>
            {formatAmount(balance, account.currency, locale)}
          </span>
          {account.currency !== displayCurrency && converted != null ? (
            <span className="block text-[11px] tabular-nums text-zinc-400">≈ {formatAmount(converted, displayCurrency, locale)}</span>
          ) : null}
        </span>
      </button>
    );
  }

  const history = selected
    ? (transactions.data ?? [])
        .filter((tx) => tx.accountId === selected.id)
        .sort((a, b) => (latestFirst ? (a.dueDate < b.dueDate ? 1 : -1) : a.dueDate > b.dueDate ? 1 : -1))
    : [];
  const upcoming = history.filter((tx) => tx.status === "planned");
  const completed = history.filter((tx) => tx.status === "completed");

  // completed history grouped by month with this account's monthly net
  // (in the account's own currency; legacy records shown but not counted —
  // they never moved the balance)
  const completedMonths = (() => {
    const byMonth = new Map<string, { items: Transaction[]; net: number }>();
    for (const tx of completed) {
      const month = tx.dueDate.slice(0, 7);
      const bucket = byMonth.get(month) ?? { items: [], net: 0 };
      bucket.items.push(tx);
      if (!tx.legacy) bucket.net += tx.direction === "income" ? tx.amount : -tx.amount;
      byMonth.set(month, bucket);
    }
    return [...byMonth.entries()];
  })();

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long", year: "numeric" });

  function historyRow(tx: Transaction) {
    if (!selected) return null;
    const category = tx.categoryId ? categoryById.get(tx.categoryId) : null;
    const income = tx.direction === "income";
    return (
      <li key={tx.id} className={`flex items-center gap-3 px-4 py-2 ${tx.status === "planned" ? "opacity-70" : ""}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm">{tx.description || category?.name || (tx.transferGroupId ? t("tx.transfer") : "—")}</span>
            {tx.transferGroupId ? <Badge tone="sky">{t("tx.transfer")}</Badge> : null}
            {tx.status === "planned" ? <Badge tone="amber">{t("tx.planned")}</Badge> : null}
            {tx.legacy ? <Badge tone="zinc">{t("legacy.badge")}</Badge> : null}
          </div>
          <div className="text-[11px] text-zinc-400">{fmtDate(tx.dueDate)}</div>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${income ? "text-green-600" : "text-red-600"}`}>
          {income ? "+" : "−"}
          {formatAmount(tx.amount, selected.currency, locale)}
        </span>
      </li>
    );
  }

  return (
    <div className={`mx-auto space-y-4 ${columns === 1 ? "max-w-6xl 3xl:max-w-[1700px]" : "max-w-none"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("portfolio.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              checked={hideEmpty.value}
              onChange={(e) => hideEmpty.setValue(e.target.checked)}
            />
            {emptyCount > 0
              ? t("portfolio.hideEmptyCount", { count: emptyCount })
              : t("portfolio.hideEmpty")}
          </label>
          <ColumnsToggle columns={columns} onChange={setColumns} max={2} />
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + {t("accounts.newAccount")}
          </Button>
        </div>
      </div>

      <div
        className={
          columns === 1
            ? "grid items-start gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]"
            : "space-y-4"
        }
      >
        {/* left: sections */}
        <div className={columns === 1 ? "space-y-4" : columnClass(columns)}>
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <Card key={section.key}>
                <CardHeader title={section.title} />
                <div className="space-y-0.5 p-2">{section.items.map(itemRow)}</div>
              </Card>
            )
          )}
          {list.length === 0 ? <EmptyState>{t("accounts.empty")}</EmptyState> : null}
          {archived.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-zinc-500">
                {t("accounts.archived")} ({archived.length})
              </summary>
              <Card className="mt-2">
                <div className="space-y-0.5 p-2">{archived.map(itemRow)}</div>
              </Card>
            </details>
          ) : null}
        </div>

        {/* right: detail + history */}
        <Card className="lg:sticky lg:top-16">
          {!selected ? (
            <div className="p-8 text-center text-sm text-zinc-400">{t("portfolio.selectHint")}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--edge-soft)] p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{selected.name}</span>
                    <Badge tone={selected.kind === "credit_card" ? "red" : selected.kind === "crypto" ? "sky" : selected.kind === "gold" ? "amber" : "zinc"}>
                      {selected.kind === "credit_card" ? t("accounts.creditCard") : t(`currency.${selected.currency}`)}
                    </Badge>
                    {selected.archived ? <Badge tone="red">{t("accounts.archived")}</Badge> : null}
                  </div>
                  <div className={`mt-1 text-3xl font-bold tabular-nums ${selected.kind === "credit_card" && (balances.get(selected.id) ?? 0) < 0 ? "text-red-600" : ""}`}>
                    {formatAmount(balances.get(selected.id) ?? 0, selected.currency, locale)}
                  </div>
                  {rates.data && selected.currency !== displayCurrency ? (
                    <div className="text-sm text-zinc-400 tabular-nums">
                      ≈ {(() => {
                        const converted = convert(balances.get(selected.id) ?? 0, selected.currency, displayCurrency, rates.data.usdPer);
                        return converted != null ? formatAmount(converted, displayCurrency, locale) : t("common.rateUnavailable");
                      })()}
                    </div>
                  ) : null}
                  {selected.kind === "credit_card" && selected.paymentDay ? (
                    <div className="mt-1 text-xs text-zinc-500">
                      📅 {t("accounts.paymentDueOn", { day: ordinal(selected.paymentDay, locale) })}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => setEditing(selected)}>
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => updateAccount.mutate({ id: selected.id, patch: { archived: !selected.archived } })}
                  >
                    {selected.archived ? t("accounts.unarchive") : t("accounts.archive")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pt-3">
                <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{t("portfolio.history")}</h3>
                <button
                  onClick={() => setLatestFirst(!latestFirst)}
                  className="text-xs text-teal-600 hover:underline"
                >
                  {latestFirst ? t("portfolio.sortLatest") : t("portfolio.sortOldest")} ⇅
                </button>
              </div>
              {history.length === 0 ? (
                <p className="p-4 text-sm text-zinc-400">{t("portfolio.noHistory")}</p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pb-2">
                  {upcoming.length > 0 ? (
                    <>
                      <div className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                        {t("portfolio.upcoming")}
                      </div>
                      <ul className="divide-y divide-[var(--edge-soft)]">{upcoming.map(historyRow)}</ul>
                    </>
                  ) : null}
                  {completedMonths.map(([month, { items, net }]) => (
                    <div key={month}>
                      <div className="flex items-center justify-between px-4 pt-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{monthLabel(month)}</span>
                        <span className={`text-[11px] font-semibold tabular-nums ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {net >= 0 ? "+" : "−"}
                          {selected ? formatAmount(Math.abs(net), selected.currency, locale) : Math.abs(net)}
                        </span>
                      </div>
                      <ul className="divide-y divide-[var(--edge-soft)]">{items.map(historyRow)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <AccountModal
        open={modalOpen || editing != null}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (input) => {
          if (editing) await updateAccount.mutateAsync({ id: editing.id, patch: input });
          else await createAccount.mutateAsync(input);
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                if (window.confirm(t("accounts.deleteWarning"))) {
                  await deleteAccount.mutateAsync(editing.id);
                  setEditing(null);
                  setSelectedId(null);
                }
              }
            : undefined
        }
      />
    </div>
  );
}

export function AccountModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: Account | null;
  onClose: () => void;
  onSave: (input: NewAccount) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [opening, setOpening] = useState("0");
  const [isCard, setIsCard] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDay, setPaymentDay] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState<string | null>(null);

  // re-init form when target changes
  const targetKey = initial?.id ?? (open ? "new" : "closed");
  if (open && initialized !== targetKey) {
    setInitialized(targetKey);
    setName(initial?.name ?? "");
    setCurrency(initial?.currency ?? "TRY");
    setOpening(String(initial?.openingBalance ?? 0));
    setIsCard(initial?.kind === "credit_card");
    setPaymentAccountId(initial?.paymentAccountId ?? "");
    setPaymentDay(initial?.paymentDay != null ? String(initial.paymentDay) : "");
    setCreditLimit(initial?.creditLimit != null ? String(initial.creditLimit) : "");
  }

  const fiat = CURRENCY_META[currency].kind === "fiat";
  const paymentCandidates = (accounts.data ?? []).filter(
    (a) => !a.archived && a.kind === "fiat" && a.id !== initial?.id
  );

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("accounts.newAccount")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return; // double-Enter guard
          setSaving(true);
          try {
            const card = fiat && isCard;
            const day = Number(paymentDay);
            await onSave({
              name,
              currency,
              kind: card ? "credit_card" : CURRENCY_META[currency].kind,
              openingBalance: Number(opening) || 0,
              paymentAccountId: card ? paymentAccountId || null : null,
              paymentDay: card && day >= 1 && day <= 31 ? day : null,
              creditLimit: card && Number(creditLimit) > 0 ? Number(creditLimit) : null,
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ziraat TRY" />
        </Field>
        <Field label={t("common.currency")}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {t(`currency.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        {fiat ? (
          <Field label={t("accounts.kind")}>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={!isCard ? "primary" : "secondary"} onClick={() => setIsCard(false)}>
                {t("accounts.bankOrCash")}
              </Button>
              <Button type="button" variant={isCard ? "primary" : "secondary"} onClick={() => setIsCard(true)}>
                💳 {t("accounts.creditCard")}
              </Button>
            </div>
          </Field>
        ) : null}
        {fiat && isCard ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("accounts.paymentAccount")} hint={t("accounts.paymentAccountHint")}>
              <Select value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {paymentCandidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("cards.creditLimit")} hint={t("cards.creditLimitHint")}>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </Field>
            <Field label={t("accounts.paymentDay")} hint={t("accounts.paymentDayHint")}>
              <Input
                type="number"
                min="1"
                max="31"
                inputMode="numeric"
                placeholder="15"
                value={paymentDay}
                onChange={(e) => setPaymentDay(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <Field label={fiat && isCard ? `${t("accounts.openingBalance")} (0 = ${t("common.none")})` : t("accounts.openingBalance")}>
          <Input
            type="number"
            step="any"
            inputMode="decimal"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </Field>
        <div className="flex justify-between gap-2 pt-1">
          {onDelete ? (
            <Button type="button" variant="danger" onClick={onDelete}>
              {t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
