"use client";

import { useState } from "react";
import { Button, Field, Fieldset, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, usePurchases, useRates, useTransactions } from "@/lib/data/queries";
import { LoanPatch } from "@/lib/data/repo";
import { Category, Loan, LoanDirection, RecurringTemplate, Transaction } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { debtRows, repaymentDirection, scheduleOf } from "@/lib/domain/debt";
import { snapshotFromTable } from "@/lib/domain/fx";
import { BSMV_CONSUMER_PCT, buildSchedule, KKDF_CONSUMER_PCT } from "@/lib/domain/loanSchedule";
import { addMonthsClamped, occurrencesBetween, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * The debt forms (lib/domain/debt.ts), each opening as a Pocket sheet on a
 * Pocket phone (Modal does that):
 *
 * - DebtModal: a new debt, either way (I owe / I lent), from a bank or a
 *   person: the amount, when and where the money landed (or left), and how
 *   it's repaid (one payment on a date, "when I can", or monthly
 *   installments, with interest and levies for a bank). Editing changes who,
 *   the accounts and a one-payment debt's date; the shape stays.
 *   `from` makes it "Move to Debts": an income already on the ledger is the
 *   money borrowed, or a recurring item already plans the repayments.
 * - RecordDebtPaymentModal: a payment made (or money back), on any date and
 *   for any amount; a one-payment debt re-plans what's left.
 * - DeleteDebtModal: delete with what it planned, or keep its rows.
 */

export type DebtSource = { kind: "transaction"; tx: Transaction } | { kind: "template"; template: RecurringTemplate };

type Repay = "once" | "whenICan" | "installments";

/** The category a debt you owe is repaid under, by its name: a loan payment one if there is one. */
export function guessDebtCategory(categories: readonly Category[]): string {
  return categories.find((c) => c.direction === "expense" && /loan|kredi|borç|debt/i.test(c.name))?.id ?? "";
}

/** Monthly payments a recurring item makes in all, when it has an end. */
function templateCount(template: RecurringTemplate): number | null {
  if (!template.endDate) return null;
  return occurrencesBetween({ frequency: "monthly", startDate: template.startDate, endDate: template.endDate }, template.startDate, template.endDate).length;
}

export function DebtModal({
  open,
  onClose,
  editing,
  from,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** an existing debt: who, accounts and a one-payment date change; the rest stays */
  editing?: Loan | null;
  /** Move to Debts: what's already on the ledger */
  from?: DebtSource | null;
  onSaved?: (loanId: string) => void;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const transactions = useTransactions();

  const [direction, setDirection] = useState<LoanDirection>("owe");
  const [person, setPerson] = useState(true);
  const [counterparty, setCounterparty] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [depositId, setDepositId] = useState("");
  const [payId, setPayId] = useState("");
  const [repay, setRepay] = useState<Repay>("whenICan");
  const [payoff, setPayoff] = useState("");
  const [months, setMonths] = useState("12");
  const [rate, setRate] = useState("0");
  const [levies, setLevies] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  /** the big purchase on a card that repays it; "" = its own payments */
  const [viaId, setViaId] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);
  const purchases = usePurchases();

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const key = editing?.id ?? (from ? (from.kind === "transaction" ? `tx:${from.tx.id}` : `tpl:${from.template.id}`) : open ? "new" : "closed");
  // start from what's given each time it opens, never from the last form's leftovers
  if (!open && initialized !== null) setInitialized(null);
  if (open && initialized !== key) {
    setInitialized(key);
    const guess = guessDebtCategory(categories.data ?? []);
    setViaId(editing?.purchaseId ?? "");
    if (editing) {
      setDirection(editing.direction);
      setPerson(editing.kind === "personal");
      setCounterparty(editing.counterparty ?? "");
      setName(editing.name);
      setAmount(String(editing.principal));
      setDate(editing.startDate);
      setDepositId(editing.depositAccountId ?? "");
      setPayId(editing.payAccountId ?? "");
      setRepay(editing.scheduleKind === "lumpSum" ? (editing.payoffDate ? "once" : "whenICan") : "installments");
      setPayoff(editing.payoffDate ?? "");
      setMonths(String(editing.termMonths));
      setRate(String(editing.monthlyRatePct));
      setLevies(editing.kkdfPct > 0 || editing.bsmvPct > 0);
      setCategoryId(guess);
    } else if (from?.kind === "transaction") {
      setDirection("owe");
      setPerson(true);
      setCounterparty("");
      setName(from.tx.description);
      setAmount(String(from.tx.amount));
      setDate(from.tx.dueDate);
      setDepositId(from.tx.accountId);
      setPayId(from.tx.accountId);
      setRepay("whenICan");
      setPayoff("");
      setMonths("12");
      setRate("0");
      setLevies(false);
      setCategoryId(guess);
    } else if (from?.kind === "template") {
      const count = templateCount(from.template);
      setDirection(from.template.direction === "income" ? "lent" : "owe");
      setPerson(false);
      setCounterparty("");
      setName(from.template.name);
      setAmount(String(from.template.amount));
      setDate(addMonthsClamped(from.template.startDate, -1));
      setDepositId("");
      setPayId(from.template.accountId);
      setRepay("installments");
      setPayoff("");
      setMonths(count != null ? String(count) : "");
      setRate("0");
      setLevies(false);
      setCategoryId(from.template.categoryId ?? guess);
    } else {
      setDirection("owe");
      setPerson(true);
      setCounterparty("");
      setName("");
      setAmount("");
      setDate(todayISO());
      setDepositId(active[0]?.id ?? "");
      setPayId(active[0]?.id ?? "");
      setRepay("whenICan");
      setPayoff("");
      setMonths("12");
      setRate("0");
      setLevies(false);
      setCategoryId(guess);
    }
  }

  const invalidate = [KEYS.loans, KEYS.transactions, KEYS.templates, KEYS.accounts];
  const create = useAppMutation(async () => {
    const payAccount = active.find((a) => a.id === (payId || active[0]?.id));
    if (!payAccount) throw new Error("no account to repay from");
    const template = from?.kind === "template" ? from.template : null;
    const count = Math.max(1, Math.round(Number(months) || 0));
    // a recurring item's payments are the debt: their sum is what's owed
    const principal = template ? template.amount * count : Number(amount);
    // a card's installments repay it: nothing of its own to schedule
    const via = !template && direction === "owe" && viaId ? viaId : null;
    const scheduleKind = via
      ? "lumpSum"
      : template || repay !== "installments" ? (template ? "zeroInterest" : "lumpSum") : Number(rate) > 0 ? "annuity" : "zeroInterest";
    const loan = await repo.createLoan({
      name: name.trim() || counterparty.trim() || t("debts.newDebt"),
      kind: person ? "personal" : (editing?.kind ?? "other"),
      currency: payAccount.currency,
      principal,
      monthlyRatePct: template || via ? 0 : Math.max(0, Number(rate) || 0),
      termMonths: !via && (repay === "installments" || template) ? count : 1,
      startDate: date,
      accountId: payAccount.id,
      categoryId: direction === "owe" ? categoryId || null : null,
      autoComplete: false,
      scheduleKind,
      kkdfPct: !person && levies && scheduleKind === "annuity" ? KKDF_CONSUMER_PCT : 0,
      bsmvPct: !person && levies && scheduleKind === "annuity" ? BSMV_CONSUMER_PCT : 0,
      direction,
      counterparty: counterparty.trim() || null,
      depositAccountId: from ? null : depositId || null,
      receivedTxId: from?.kind === "transaction" ? from.tx.id : null,
      templateId: template?.id ?? null,
      payoffDate: repay === "once" && !template && !via ? payoff || null : null,
      purchaseId: via,
      fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
    });
    return loan.id;
  }, invalidate);
  const update = useAppMutation(async (): Promise<string | null> => {
    if (!editing) return null;
    const patch: LoanPatch = {};
    const nextName = name.trim() || counterparty.trim() || editing.name;
    if (nextName !== editing.name) patch.name = nextName;
    const nextKind = person ? "personal" : editing.kind === "personal" ? "other" : editing.kind;
    if (nextKind !== editing.kind) patch.kind = nextKind;
    if ((counterparty.trim() || null) !== editing.counterparty) patch.counterparty = counterparty.trim() || null;
    if ((depositId || null) !== editing.depositAccountId && depositId) patch.depositAccountId = depositId;
    if ((payId || null) !== editing.payAccountId && payId) patch.payAccountId = payId;
    // present only when it changes: it re-plans, its own payments going or coming back
    if ((viaId || null) !== (editing.purchaseId ?? null)) patch.purchaseId = viaId || null;
    if (editing.scheduleKind === "lumpSum" && !viaId) {
      const nextPayoff = repay === "once" ? payoff || null : null;
      // present only when it changes: it re-plans the payment
      if (nextPayoff !== editing.payoffDate) patch.payoffDate = nextPayoff;
    }
    await repo.updateLoan(editing.id, patch);
    return editing.id;
  }, invalidate);

  const busy = create.isPending || update.isPending;
  const lent = direction === "lent";
  const template = from?.kind === "template" ? from.template : null;
  // what can repay a debt you owe: a big purchase on a card (a cash advance is one)
  const cardIds = new Set((accounts.data ?? []).filter((a) => a.kind === "credit_card").map((a) => a.id));
  const cardPurchases = (purchases.data ?? []).filter((p) => p.accountId != null && cardIds.has(p.accountId));
  const viaCard = !lent && !template && viaId !== "";
  const payAccount = active.find((a) => a.id === payId) ?? active[0];
  const currency = payAccount?.currency ?? "TRY";
  const money = (n: number) => formatAmount(n, currency, locale);
  const count = Math.max(0, Math.round(Number(months) || 0));
  const preview =
    !editing && !template && !viaCard && repay === "installments" && Number(amount) > 0 && count > 0
      ? buildSchedule({
          kind: Number(rate) > 0 ? "annuity" : "zeroInterest",
          principal: Number(amount),
          monthlyRatePct: Number(rate) || 0,
          termMonths: count,
          startDate: date,
          currency,
          kkdfPct: !person && levies ? KKDF_CONSUMER_PCT : 0,
          bsmvPct: !person && levies ? BSMV_CONSUMER_PCT : 0,
        })
      : null;
  const expenseCategories = (categories.data ?? []).filter((c) => c.direction === "expense");
  const segment = (on: boolean) => (on ? "primary" : "secondary") as "primary" | "secondary";
  // an edit keeps the shape it was made with: only a one-payment debt can move its date
  const shapeFixed = editing != null && editing.scheduleKind !== "lumpSum";
  const deposits = editing ? debtRows(editing, transactions.data ?? []).money : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t("debts.editDebt") : from ? t("debts.moveToDebts") : t("debts.newDebt")}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        // useAppMutation hands back what the write returned, untyped: the debt's id
        const id = (editing ? await update.mutateAsync(undefined as never) : await create.mutateAsync(undefined as never)) as string | null;
        if (id) onSaved?.(id);
        onClose();
      }}
    >
      <div className="space-y-3" data-debt-form>
        {from ? <p className="text-xs text-zinc-500">{t("debts.moveHint")}</p> : null}
        {editing || template ? null : (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("debts.newDebt")}>
            <Button type="button" variant={segment(!lent)} aria-pressed={!lent} onClick={() => setDirection("owe")}>
              {t("debts.owe")}
            </Button>
            <Button type="button" variant={segment(lent)} aria-pressed={lent} onClick={() => setDirection("lent")}>
              {t("debts.lent")}
            </Button>
          </div>
        )}
        <Fieldset label={t("debts.counterparty")}>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={segment(person)} aria-pressed={person} onClick={() => setPerson(true)}>
              {t("debts.person")}
            </Button>
            <Button type="button" variant={segment(!person)} aria-pressed={!person} onClick={() => setPerson(false)}>
              {t("debts.bank")}
            </Button>
          </div>
        </Fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label={person ? t("debts.counterpartyPerson") : t("debts.counterpartyBank")}>
            <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={t("debts.counterpartyPlaceholder")} />
          </Field>
          <Field label={t("debts.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("debts.namePlaceholder")} />
          </Field>
        </div>

        {template ? (
          <p className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
            {templateCount(template) != null
              ? t("debts.fromTemplate", { name: template.name, count: templateCount(template)!, amount: money(template.amount) })
              : t("debts.fromTemplateNoEnd", { name: template.name, amount: money(template.amount) })}
          </p>
        ) : null}
        {template && templateCount(template) == null ? (
          <Field label={t("debts.months")}>
            <Input type="number" min="1" step="1" required value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
        ) : null}

        {template || editing ? null : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("debts.amount")}>
              <Input
                type="number"
                step="any"
                min="0"
                required
                inputMode="decimal"
                value={amount}
                disabled={from?.kind === "transaction"}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={lent ? t("debts.dateLent") : t("debts.dateOwe")}>
              <Input type="date" required value={date} disabled={from?.kind === "transaction"} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        )}

        {template ? null : from?.kind === "transaction" ? (
          <p className="text-xs text-zinc-500">{t("debts.depositLedger", { what: `${from.tx.description || "—"} · ${money(from.tx.amount)} · ${fmtDate(from.tx.dueDate)}` })}</p>
        ) : editing && deposits.length === 0 ? null : (
          <Field label={lent ? t("debts.depositLent") : t("debts.depositOwe")} hint={editing ? undefined : t("debts.depositHint")}>
            <Select value={depositId} onChange={(e) => setDepositId(e.target.value)}>
              {editing ? null : <option value="">{t("debts.depositNone")}</option>}
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={lent ? t("debts.payLent") : t("debts.payOwe")}>
          <Select required value={payId || active[0]?.id || ""} onChange={(e) => setPayId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>

        {!lent && !template && cardPurchases.length > 0 ? (
          <Field label={t("debts.viaCard")} hint={t("debts.viaCardHint")}>
            <Select value={viaId} onChange={(e) => setViaId(e.target.value)}>
              <option value="">{t("debts.viaCardOwn")}</option>
              {cardPurchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {(accounts.data ?? []).find((a) => a.id === p.accountId)?.name ?? "—"}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {template || shapeFixed || viaCard ? null : (
          <Fieldset label={t("debts.repayment")}>
            <div role="radiogroup" aria-label={t("debts.repayment")} className="space-y-1.5">
              {(editing ? (["once", "whenICan"] as const) : (["whenICan", "once", "installments"] as const)).map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="repay" className="h-4 w-4 accent-teal-600" checked={repay === r} onChange={() => setRepay(r)} />
                  {r === "once" ? t("debts.repayOnce") : r === "whenICan" ? t("debts.repayWhenICan") : t("debts.repayInstallments")}
                </label>
              ))}
            </div>
          </Fieldset>
        )}
        {!template && !shapeFixed && !viaCard && repay === "whenICan" ? <p className="text-xs text-zinc-500">{t("debts.repayWhenICanHint")}</p> : null}
        {!template && !shapeFixed && !viaCard && repay === "once" ? (
          <Field label={t("debts.payoffDate")}>
            <Input type="date" required min={date} value={payoff} onChange={(e) => setPayoff(e.target.value)} />
          </Field>
        ) : null}
        {!template && !editing && !viaCard && repay === "installments" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("debts.months")}>
              <Input type="number" min="1" step="1" required value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label={t("debts.rate")}>
              <Input type="number" min="0" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
        ) : null}
        {!template && !editing && !viaCard && repay !== "whenICan" && !person ? (
          <>
            {repay === "once" ? (
              <Field label={t("debts.rate")} hint={t("debts.rateHint")}>
                <Input type="number" min="0" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
            ) : null}
            {repay === "installments" ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={levies} onChange={(e) => setLevies(e.target.checked)} />
                {t("debts.levies")}
              </label>
            ) : null}
          </>
        ) : null}
        {preview && preview.rows.length > 0 ? (
          <p className="text-xs text-zinc-500" data-debt-preview>
            {t("debts.firstPayment", { date: fmtDate(preview.rows[0].date), amount: money(preview.installment) })}
          </p>
        ) : null}

        {!lent && !editing ? (
          <Field label={t("debts.category")}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A payment made on a debt, or money back on one you lent: any amount, any day. */
export function RecordDebtPaymentModal({ loan, open, onClose }: { loan: Loan; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const transactions = useTransactions();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [initialized, setInitialized] = useState(false);

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const { repayments } = debtRows(loan, transactions.data ?? []);
  if (!open && initialized) setInitialized(false);
  if (open && !initialized) {
    setInitialized(true);
    const next = repayments.filter((r) => r.status === "planned").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    setAmount(next ? String(next.amount) : "");
    setDate(todayISO());
    setAccountId(loan.payAccountId ?? next?.accountId ?? active[0]?.id ?? "");
  }

  const record = useAppMutation(async () => {
    const lent = loan.direction === "lent";
    const account = active.find((a) => a.id === accountId) ?? active[0];
    if (!account) return;
    const categoryId = lent ? null : (repayments.find((r) => r.categoryId)?.categoryId ?? (guessDebtCategory(categories.data ?? []) || null));
    const day = date || todayISO();
    await repo.createTransaction({
      accountId: account.id,
      direction: repaymentDirection(loan),
      categoryId,
      amount: Number(amount),
      status: day <= todayISO() ? "completed" : "planned",
      dueDate: day,
      description: loan.name,
      fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
      loanId: loan.id,
      ...(lent ? { loanPrincipal: true } : {}),
    });
    // one payment on a date: what's planned becomes what's left
    if (loan.scheduleKind === "lumpSum" && loan.payoffDate) await repo.updateLoan(loan.id, { payoffDate: loan.payoffDate });
  }, [KEYS.loans, KEYS.transactions, KEYS.accounts]);

  const lent = loan.direction === "lent";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("debts.recordTitle", { name: loan.name })}
      onSubmit={async (e) => {
        e.preventDefault();
        if (record.isPending) return;
        await record.mutateAsync(undefined as never);
        onClose();
      }}
    >
      <div className="space-y-3" data-debt-record>
        <p className="text-xs text-zinc-500">{t("debts.recordHint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("debts.amount")} (${loan.currency})`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={lent ? t("debts.payLent") : t("debts.payOwe")}>
          <Select value={accountId || active[0]?.id || ""} onChange={(e) => setAccountId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={record.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Delete with what it planned, or keep its rows (a recurring item it came from stays). */
export function DeleteDebtModal({ loan, open, onClose, onDeleted }: { loan: Loan; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const repo = useRepo();
  const remove = useAppMutation((keepRows: boolean) => repo.deleteLoan(loan.id, keepRows), [KEYS.loans, KEYS.templates, KEYS.transactions, KEYS.accounts]);
  const go = async (keepRows: boolean) => {
    await remove.mutateAsync(keepRows);
    onClose();
    onDeleted();
  };
  return (
    <Modal open={open} onClose={onClose} title={t("debts.deleteTitle", { name: loan.name })}>
      <div className="space-y-3" data-debt-delete>
        <p className="text-sm text-zinc-500">{t("debts.deleteHint")}</p>
        <div className="flex flex-col gap-2">
          <Button variant="danger" disabled={remove.isPending} onClick={() => go(false)}>
            {t("debts.deleteWithRows")}
          </Button>
          <Button disabled={remove.isPending} onClick={() => go(true)}>
            {t("debts.deleteKeepRows")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The schedule's last date, for a summary line: a payoff when there is one. */
export function debtEnd(loan: Loan): string | null {
  return loan.payoffDate ?? scheduleOf(loan).rows.at(-1)?.date ?? null;
}
