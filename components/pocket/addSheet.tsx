"use client";

import Link from "next/link";
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useBudgets,
  useCategories,
  useRates,
  useTransactions,
} from "@/lib/data/queries";
import { NewTransaction, NewTransfer } from "@/lib/data/repo";
import { Account, Category, Transaction } from "@/lib/data/types";
import { budgetStatuses, budgetWarningFor } from "@/lib/domain/budgets";
import { Currency, CURRENCY_META, formatAmount } from "@/lib/domain/currencies";
import { convert, effectiveRate, pairRate, snapshotFromTable, spreadPct } from "@/lib/domain/fx";
import { amountForEditing, roundTo } from "@/lib/domain/money";
import { addDays, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { dayLabel } from "@/lib/ui/pocket/dates";
import { formatSigned } from "@/lib/ui/pocket/format";
import {
  clampDecimals,
  displayExpression,
  evaluate,
  Evaluation,
  hasOperator,
  KeypadKey,
  normalizeDecimal,
  press,
  typedFromExpression,
} from "@/lib/ui/pocket/keypad";
import { POCKET_KEYS, readPocketPref, writePocketPref } from "@/lib/ui/pocket/prefs";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { accountOrder, descriptionSuggestions, RememberedEntry, topCategories } from "@/lib/ui/pocket/suggest";
import { AddMode, AddRequest, usePocketChrome } from "./chrome";
import { Icon } from "./icons";
import { Keypad } from "./keypad";
import { Approx, Avatar, Chip, ChipRow, NoteCard, Segmented } from "./kit";
import { PocketSheet } from "./sheet";

/**
 * The + sheet: amount first, on a calculator keypad, then the few choices an
 * entry needs as chips (account, category, day), and one button that says
 * exactly what will happen ("Add expense ₺120.00", "Plan ₺2,800.00",
 * "Transfer $500.00 → ₺20,900.00").
 *
 * It writes what the Classic forms write, through the same repo methods and
 * invalidations: TransactionModal's createTransaction payload (with today's
 * rates frozen on a completed entry), TransferModal's createTransfer, and
 * EditModal's updateTransaction patch — on both legs when the entry being
 * edited is a transfer. After a save the snackbar offers Undo, which deletes
 * what was just created (or puts an edit back).
 *
 * An entry left half-typed is kept on the device for ten minutes and comes
 * back the next time the sheet opens the same way.
 */

type TxPatch = Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>;
type RunUndo = (run: () => Promise<void>) => void;

const DRAFT_KEY = "renovator-pocket-draft";
const DRAFT_MAX_AGE_MS = 10 * 60_000;
const LAST_FROM_KEY = "renovator-pocket-last-transfer-from";
const LAST_TO_KEY = "renovator-pocket-last-transfer-to";

/** Everything the form holds that a draft brings back. */
interface FormState {
  mode: AddMode;
  /** expense / income: "" = the default (requested, last used, or first) */
  accountId: string;
  fromId: string;
  toId: string;
  categoryId: string | null;
  /** the keypad expression: the amount, or what's sent in a transfer */
  expr: string;
  /** a transfer's received amount, once typed; until then it follows the market */
  receiveExpr: string;
  receiveTyped: boolean;
  date: string;
  /** null: follows the date (a future date is planned) */
  planned: boolean | null;
  description: string;
  /** the amount is typed in the display currency and converted on save */
  inDisplay: boolean;
}

function readDraft(): FormState | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; form: FormState };
    if (!saved?.form || typeof saved.at !== "number" || Date.now() - saved.at > DRAFT_MAX_AGE_MS) return null;
    return saved.form;
  } catch {
    return null;
  }
}

function writeDraft(form: FormState | null): void {
  try {
    if (form) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), form }));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // the draft is a convenience; without storage there just isn't one
  }
}

/** The entry an edit or a duplicate starts from, with both legs when it's a transfer. */
interface Origin {
  tx: Transaction;
  out?: Transaction;
  in?: Transaction;
}

function originOf(request: AddRequest, transactions: readonly Transaction[]): Origin | null {
  const tx = request.edit ?? request.duplicateOf;
  if (!tx) return null;
  if (!tx.transferGroupId) return { tx };
  const legs = transactions.filter((t) => t.transferGroupId === tx.transferGroupId);
  const out = tx.direction === "expense" ? tx : legs.find((t) => t.direction === "expense");
  const inLeg = tx.direction === "income" ? tx : legs.find((t) => t.direction === "income");
  return out && inLeg ? { tx, out, in: inLeg } : { tx };
}

const currencyOf = (accounts: readonly Account[], id: string | undefined): Currency =>
  accounts.find((a) => a.id === id)?.currency ?? "TRY";

function startingForm(
  request: AddRequest,
  origin: Origin | null,
  accounts: readonly Account[],
  today: string,
  restore: boolean
): { form: FormState; restored: boolean } {
  const blank: FormState = {
    mode: request.mode,
    accountId: request.mode === "transfer" ? "" : (request.accountId ?? ""),
    fromId: request.mode === "transfer" ? (request.accountId ?? "") : "",
    toId: "",
    categoryId: null,
    expr: "",
    receiveExpr: "",
    receiveTyped: false,
    date: today,
    planned: null,
    description: "",
    inDisplay: false,
  };
  if (!origin) {
    const draft = restore ? readDraft() : null;
    const fits =
      draft != null &&
      draft.mode === request.mode &&
      (!request.accountId || request.accountId === (draft.mode === "transfer" ? draft.fromId : draft.accountId));
    return fits ? { form: { ...blank, ...draft }, restored: true } : { form: blank, restored: false };
  }
  const editing = request.edit != null;
  const { tx, out, in: inLeg } = origin;
  if (out && inLeg) {
    return {
      form: {
        ...blank,
        mode: "transfer",
        fromId: out.accountId,
        toId: inLeg.accountId,
        expr: amountForEditing(out.amount, currencyOf(accounts, out.accountId), "en"),
        receiveExpr: editing ? amountForEditing(inLeg.amount, currencyOf(accounts, inLeg.accountId), "en") : "",
        receiveTyped: editing,
        date: editing ? out.dueDate : today,
        description: out.description,
      },
      restored: false,
    };
  }
  return {
    form: {
      ...blank,
      mode: tx.direction,
      accountId: tx.accountId,
      categoryId: tx.categoryId,
      expr: amountForEditing(tx.amount, currencyOf(accounts, tx.accountId), "en"),
      date: editing ? tx.dueDate : today,
      description: tx.description,
    },
    restored: false,
  };
}

/** A typed key on a prefilled figure replaces it, as on a calculator; an operator carries on from it. */
function applyKey(expr: string, fresh: boolean, key: KeypadKey, currency: Currency): string {
  const replaces = key === "back" || key === "." || /^\d$/.test(key);
  if (fresh && replaces) return key === "back" ? "" : press("", key, currency);
  return press(expr, key, currency);
}

/** "₺120 + 45", "0.05 ₿": the currency's mark where formatAmount puts it. */
function withSymbol(text: string, currency: Currency): string {
  const meta = CURRENCY_META[currency];
  return currency === "BTC" || currency === "XAU_G" ? `${text} ${meta.symbol}` : `${meta.symbol}${text}`;
}

/** Dark text on light category colours, white on dark ones. */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? "#09090b" : "#fff";
}

/* ───────────────────────────── the sheet ───────────────────────────── */

export function AddSheet({ request, onClose }: { request: AddRequest | null; onClose: () => void }) {
  // every request starts a fresh form, even one that replaces another
  const [seen, setSeen] = useState<{ request: AddRequest | null; n: number }>({ request, n: 0 });
  if (seen.request !== request) setSeen({ request, n: seen.n + 1 });
  // Undo runs from the snackbar after the sheet has gone, so it lives here,
  // where it stays mounted; a failure toasts like any other save
  const undo = useAppMutation((run: () => Promise<void>) => run(), [KEYS.transactions, KEYS.accounts]);
  if (!request) return null;
  return <AddFlow key={seen.n} request={request} onClose={onClose} runUndo={undo.mutate} />;
}

function AddFlow({ request, onClose, runUndo }: { request: AddRequest; onClose: () => void; runUndo: RunUndo }) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  // "Start over" opens a new form, without the draft
  const [round, setRound] = useState(0);

  if (!accounts.data || !categories.data || !transactions.data || !accounts.data.some((a) => !a.archived)) {
    const loading = !accounts.data || !categories.data || !transactions.data;
    const title =
      request.mode === "transfer" ? t("tx.newTransfer") : request.mode === "income" ? t("pocket.add.newIncome") : t("pocket.add.newExpense");
    return (
      <PocketSheet open onClose={onClose} title={title} size="full">
        {loading ? (
          <div className="py-4">
            <Skeleton rows={8} />
          </div>
        ) : (
          <div className="space-y-2 py-4 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">{t("accounts.empty")}</p>
            <Link
              href="/accounts"
              onClick={onClose}
              className="inline-flex min-h-[44px] items-center gap-1 font-medium text-teal-700 dark:text-teal-300"
            >
              {t("accounts.newAccount")}
              <Icon name="chevron" size={16} />
            </Link>
          </div>
        )}
      </PocketSheet>
    );
  }

  return (
    <AddForm
      key={round}
      request={request}
      onClose={onClose}
      runUndo={runUndo}
      accounts={accounts.data}
      categories={categories.data}
      transactions={transactions.data}
      restore={round === 0}
      onStartOver={() => {
        writeDraft(null);
        setRound((r) => r + 1);
      }}
    />
  );
}

/* ───────────────────────────── the form ───────────────────────────── */

function AddForm({
  request,
  onClose,
  runUndo,
  accounts,
  categories,
  transactions,
  restore,
  onStartOver,
}: {
  request: AddRequest;
  onClose: () => void;
  runUndo: RunUndo;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  restore: boolean;
  onStartOver: () => void;
}) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const queryClient = useQueryClient();
  const chrome = usePocketChrome();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const budgets = useBudgets();
  const usdPer = rates.data?.usdPer;
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const editing = request.edit ?? null;

  // what an edit or duplicate starts from, as it was when the sheet opened
  const [origin] = useState(() => originOf(request, transactions));
  const [start] = useState(() => startingForm(request, origin, accounts, today, restore));
  const [form, setForm] = useState<FormState>(start.form);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const [lastUsed] = useState(() => ({
    expense: readPocketPref(POCKET_KEYS.lastExpenseAccount),
    income: readPocketPref(POCKET_KEYS.lastIncomeAccount),
    from: readPocketPref(LAST_FROM_KEY),
    to: readPocketPref(LAST_TO_KEY),
  }));

  // the figure a prefilled amount shows is "selected": a digit replaces it
  const [fresh, setFresh] = useState(origin != null);
  const [freshReceive, setFreshReceive] = useState(true);
  const [target, setTarget] = useState<"send" | "receive">("send");
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [typedReceive, setTypedReceive] = useState("");
  const [view, setView] = useState<"form" | "categories" | "pick">("form");
  const [catQuery, setCatQuery] = useState("");
  const [noteFocused, setNoteFocused] = useState(false);
  const [showRestored, setShowRestored] = useState(start.restored);
  const noteBox = useRef<HTMLDivElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const noteId = useId();

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const createTx = useAppMutation((input: NewTransaction) => repo.createTransaction(input), invalidate);
  const createTransfer = useAppMutation((input: NewTransfer) => repo.createTransfer(input), invalidate);
  const updateTx = useAppMutation(async (list: Array<{ id: string; patch: TxPatch }>) => {
    for (const { id, patch: p } of list) await repo.updateTransaction(id, p);
  }, invalidate);
  const busy = createTx.isPending || createTransfer.isPending || updateTx.isPending;

  // a half-typed new entry outlives the sheet for a few minutes; a duplicate
  // only once it's been changed, so looking at one and closing leaves no draft
  const draftJson = editing ? null : JSON.stringify(form);
  const [startJson] = useState(() => JSON.stringify(start.form));
  const duplicating = origin != null;
  useEffect(() => {
    if (draftJson == null) return;
    const f = JSON.parse(draftJson) as FormState;
    const empty = f.expr === "" && f.description.trim() === "";
    writeDraft(empty || (duplicating && draftJson === startJson) ? null : f);
  }, [draftJson, startJson, duplicating]);

  // the category grid takes focus when it opens, and gives it back to the title
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    const el = gridRef.current;
    if (view !== "form" && el) el.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>("[data-pocket-sheet] h2")?.focus({ preventScroll: true });
  }, [view]);

  /* ── accounts ── */
  const mode = form.mode;
  const keepId = editing && origin ? (origin.out?.accountId ?? origin.tx.accountId) : null;
  // an adjustment corrects a bank or cash balance; on a card it would turn
  // into a charge, so an edit of one doesn't offer cards (as EditModal)
  const pool = editing?.adjustment ? accounts.filter((a) => a.kind !== "credit_card") : accounts;
  const order = accountOrder(pool, mode === "income" ? lastUsed.income : lastUsed.expense, keepId);
  const account = order.find((a) => a.id === form.accountId) ?? order[0];
  const fromList = accountOrder(pool, lastUsed.from, keepId);
  const from = fromList.find((a) => a.id === form.fromId) ?? fromList[0];
  const toList = accountOrder(pool, lastUsed.to, editing && origin?.in ? origin.in.accountId : null).filter((a) => a.id !== from?.id);
  const to = toList.find((a) => a.id === form.toId) ?? toList[0];

  /* ── the amount ── */
  const transfer = mode === "transfer";
  const canEnterIn = !transfer && account != null && account.currency !== displayCurrency;
  const inDisplay = canEnterIn && form.inDisplay;
  const entryCurrency: Currency = transfer ? (from?.currency ?? "TRY") : inDisplay ? displayCurrency : (account?.currency ?? "TRY");
  const typedInvalid = typing && normalizeDecimal(typedText, entryCurrency) == null;
  const entered: Evaluation = typedInvalid ? { ok: false, reason: "invalid" } : evaluate(form.expr, entryCurrency);
  const enteredValue = entered.ok ? entered.value : null;
  let amount: number | null = enteredValue;
  if (amount != null && inDisplay && account) {
    amount = usdPer ? convert(amount, displayCurrency, account.currency, usdPer) : null;
  }

  /* ── a transfer's other side ── */
  const sameCurrency = from != null && to != null && from.currency === to.currency;
  const market = from && to && usdPer ? pairRate(from.currency, to.currency, usdPer) : null;
  const marketReceive =
    amount != null && from && to ? (sameCurrency ? amount : usdPer ? convert(amount, from.currency, to.currency, usdPer) : null) : null;
  const receiveTyped = transfer && !sameCurrency && form.receiveTyped;
  const typedReceiveInvalid = typing && receiveTyped && to != null && normalizeDecimal(typedReceive, to.currency) == null;
  const receiveEval: Evaluation | null =
    receiveTyped && to ? (typedReceiveInvalid ? { ok: false, reason: "invalid" } : evaluate(form.receiveExpr, to.currency)) : null;
  const receive = !transfer ? null : sameCurrency ? amount : receiveEval ? (receiveEval.ok ? receiveEval.value : null) : marketReceive;
  const eff = amount != null && receive != null && amount > 0 && receive > 0 ? effectiveRate(amount, receive) : null;
  const spread = market != null && eff != null ? spreadPct(market, eff) : null;

  /* ── status ── */
  const planned = !transfer && !editing && (form.planned ?? form.date > today);
  const completed = editing ? editing.status === "completed" : transfer ? form.date <= today : !planned;

  /* ── categories ── */
  const direction = transfer ? null : mode;
  const dirCategories = direction ? categories.filter((c) => c.direction === direction) : [];
  const top = useMemo(
    () => (direction ? topCategories(transactions, categories, direction, today) : []),
    [transactions, categories, direction, today]
  );
  const selectedCategory = categories.find((c) => c.id === form.categoryId) ?? null;
  const shownCategories =
    selectedCategory && !top.some((c) => c.id === selectedCategory.id) ? [selectedCategory, ...top.slice(0, 7)] : top;

  /* ── budget warning, as TransactionModal shows it ── */
  const statuses = useMemo(
    () =>
      budgets.data && usdPer
        ? budgetStatuses({ budgets: budgets.data, transactions, accounts, usdPer, month: today.slice(0, 7) })
        : null,
    [budgets.data, transactions, accounts, usdPer, today]
  );
  const budgetWarning =
    mode === "expense" && account && budgets.data && statuses && usdPer && amount != null
      ? budgetWarningFor({
          budgets: budgets.data,
          statuses,
          categoryId: form.categoryId,
          amount,
          currency: account.currency,
          usdPer,
        })
      : null;

  /* ── remembered notes ── */
  const suggestions = useMemo(
    () => (direction && noteFocused ? descriptionSuggestions(transactions, form.description, direction, locale) : []),
    [transactions, form.description, direction, locale, noteFocused]
  );

  /* ── why the button can't save yet ── */
  let reason: string | null = null;
  if (transfer && (!from || !to)) reason = t("transfer.sameAccount");
  else if (!entered.ok && entered.reason === "divZero") reason = t("pocket.add.divideByZero");
  else if (enteredValue != null && amount == null) reason = t("common.rateUnavailable");
  else if (amount == null || amount <= 0) reason = t("pocket.add.enterAmount");
  else if (transfer && (receive == null || receive <= 0))
    reason = !receiveTyped && !usdPer ? t("adjust.needsRates") : t("pocket.add.enterAmount");
  else if (!editing && completed && !rates.data) reason = t("adjust.needsRates");

  const fmt = (n: number, c: Currency) => formatAmount(n, c, locale);
  const positive = amount != null && amount > 0;
  const label = editing
    ? t("pocket.add.saveChanges")
    : transfer
      ? positive && receive != null && receive > 0 && from && to
        ? t("pocket.add.transferAmount", { from: fmt(amount!, from.currency), to: fmt(receive, to.currency) })
        : t("tx.transfer")
      : planned
        ? positive && account
          ? t("pocket.add.planAmount", { amount: fmt(amount!, account.currency) })
          : t("pocket.add.plan")
        : mode === "expense"
          ? positive && account
            ? t("pocket.add.addExpenseAmount", { amount: fmt(amount!, account.currency) })
            : t("pocket.add.addExpense")
          : positive && account
            ? t("pocket.add.addIncomeAmount", { amount: fmt(amount!, account.currency) })
            : t("pocket.add.addIncome");

  /* ───────────── actions ───────────── */

  const onKey = (key: KeypadKey) => {
    if (transfer && target === "receive" && to && !sameCurrency) {
      const base = form.receiveTyped ? form.receiveExpr : marketReceive != null ? amountForEditing(marketReceive, to.currency, "en") : "";
      const next = applyKey(base, form.receiveTyped ? freshReceive : true, key, to.currency);
      patch({ receiveExpr: next, receiveTyped: true });
      setFreshReceive(false);
      return;
    }
    patch({ expr: applyKey(form.expr, fresh, key, entryCurrency) });
    setFresh(false);
  };

  const switchMode = (next: AddMode) => {
    if (next === mode) return;
    patch({
      mode: next,
      categoryId: null,
      // the account chosen carries over to the other kind of entry
      ...(next === "transfer" && account ? { fromId: account.id } : {}),
      ...(mode === "transfer" && from ? { accountId: from.id } : {}),
    });
    setTarget("send");
  };

  const chooseAccount = (a: Account) => {
    patch({ accountId: a.id, expr: inDisplay ? form.expr : clampDecimals(form.expr, a.currency) });
  };

  const setDate = (date: string) => patch({ date, planned: null });

  const openPicker = () => {
    const input = dateInput.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  const pickSuggestion = (s: RememberedEntry) => {
    const usable = order.some((a) => a.id === s.accountId);
    patch({ description: s.description, categoryId: s.categoryId, ...(usable ? { accountId: s.accountId } : {}) });
    setNoteFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const toggleTyping = () => {
    if (!typing) {
      setTypedText(form.expr === "" ? "" : typedFromExpression(form.expr, locale));
      setTypedReceive(form.receiveTyped ? typedFromExpression(form.receiveExpr, locale) : "");
      setFresh(false);
    }
    setTyping(!typing);
  };

  const onTyped = (text: string) => {
    setTypedText(text);
    const n = normalizeDecimal(text, entryCurrency);
    if (n != null) patch({ expr: clampDecimals(n, entryCurrency) });
  };

  const onTypedReceive = (text: string) => {
    setTypedReceive(text);
    if (!to) return;
    if (text.trim() === "") {
      patch({ receiveTyped: false, receiveExpr: "" });
      return;
    }
    const n = normalizeDecimal(text, to.currency);
    patch({ receiveTyped: true, ...(n != null ? { receiveExpr: clampDecimals(n, to.currency) } : {}) });
  };

  const useMarket = () => {
    patch({ receiveTyped: false, receiveExpr: "" });
    setTypedReceive("");
    setTarget("send");
  };

  const finish = () => {
    writeDraft(null);
    onClose();
  };

  async function save(override?: { categoryId: string | null }) {
    if (reason || busy || amount == null) return;
    const description = form.description.trim();
    const snapshot = rates.data ? snapshotFromTable(rates.data) : null;

    try {
      /* edit: the same patch EditModal sends; a transfer's two legs together */
      if (editing && origin) {
        if (transfer && origin.out && origin.in && from && to && receive != null) {
          const changed = description !== origin.out.description.trim();
          const legs = [
            { leg: origin.out, next: { amount: roundTo(amount, from.currency), dueDate: form.date, accountId: from.id } },
            { leg: origin.in, next: { amount: roundTo(receive, to.currency), dueDate: form.date, accountId: to.id } },
          ];
          await updateTx.mutateAsync(
            legs.map(({ leg, next }) => ({ id: leg.id, patch: { ...next, ...(changed ? { description } : {}) } }))
          );
          finish();
          showSnack(t("pocket.saved"), {
            label: t("pocket.undo"),
            run: () =>
              runUndo(async () => {
                for (const { leg } of legs) {
                  await repo.updateTransaction(leg.id, {
                    amount: leg.amount,
                    dueDate: leg.dueDate,
                    accountId: leg.accountId,
                    ...(changed ? { description: leg.description } : {}),
                  });
                }
              }),
          });
          return;
        }
        if (!account) return;
        const before = origin.tx;
        await updateTx.mutateAsync([
          {
            id: before.id,
            patch: { description, amount, dueDate: form.date, categoryId: form.categoryId, accountId: account.id },
          },
        ]);
        finish();
        showSnack(t("pocket.saved"), {
          label: t("pocket.undo"),
          run: () =>
            runUndo(() =>
              repo.updateTransaction(before.id, {
                description: before.description,
                amount: before.amount,
                dueDate: before.dueDate,
                categoryId: before.categoryId,
                accountId: before.accountId,
              })
            ),
        });
        return;
      }

      /* a new transfer: TransferModal's payload */
      if (transfer) {
        if (!from || !to || receive == null) return;
        const known = new Set(transactions.map((tx) => tx.transferGroupId).filter(Boolean));
        const input: NewTransfer = {
          fromAccountId: from.id,
          toAccountId: to.id,
          fromAmount: roundTo(amount, from.currency),
          toAmount: roundTo(receive, to.currency),
          date: form.date,
          description,
          marketRate: market,
          fxSnapshot: snapshot,
        };
        await createTransfer.mutateAsync(input);
        writePocketPref(LAST_FROM_KEY, from.id);
        writePocketPref(LAST_TO_KEY, to.id);
        finish();
        // createTransfer returns nothing: Undo finds the newest leg this save
        // added, and deleting one leg removes both
        const newestLeg = (list: readonly Transaction[] | undefined) =>
          (list ?? [])
            .filter(
              (tx) =>
                tx.transferGroupId != null &&
                !known.has(tx.transferGroupId) &&
                tx.accountId === input.fromAccountId &&
                tx.direction === "expense" &&
                tx.dueDate === input.date
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        showSnack(t("pocket.added", { what: t("pocket.transfer"), amount: fmt(input.fromAmount, from.currency) }), {
          label: t("pocket.undo"),
          run: () =>
            runUndo(async () => {
              const leg =
                newestLeg(queryClient.getQueryData<Transaction[]>(KEYS.transactions)) ?? newestLeg(await repo.listTransactions());
              if (leg) await repo.deleteTransaction(leg.id);
            }),
        });
        return;
      }

      /* a new expense or income: TransactionModal's payload */
      if (!account || !direction) return;
      const categoryId = override ? override.categoryId : form.categoryId;
      if (!override && categoryId == null && dirCategories.length > 0) {
        setView("pick");
        return;
      }
      const status = planned ? "planned" : "completed";
      const created = (await createTx.mutateAsync({
        accountId: account.id,
        direction,
        categoryId,
        amount,
        status,
        dueDate: form.date,
        description,
        fxSnapshot: status === "completed" ? snapshot : null,
      })) as Transaction;
      writePocketPref(direction === "expense" ? POCKET_KEYS.lastExpenseAccount : POCKET_KEYS.lastIncomeAccount, account.id);
      finish();
      showSnack(
        t("pocket.added", {
          what: t(direction === "expense" ? "pocket.expense" : "pocket.income"),
          amount: formatSigned(amount, account.currency, locale, direction === "expense" ? "out" : "in"),
        }),
        { label: t("pocket.undo"), run: () => runUndo(() => repo.deleteTransaction(created.id)) }
      );
    } catch {
      // the MutationCache toast says why; the sheet keeps what was typed
    }
  }

  /* ───────────── the category grid ───────────── */

  if (view !== "form") {
    const lang = locale === "tr" ? "tr-TR" : "en-US";
    const q = catQuery.trim().toLocaleLowerCase(lang);
    const listed = q ? dirCategories.filter((c) => c.name.toLocaleLowerCase(lang).includes(q)) : dirCategories;
    const choose = (id: string) => {
      patch({ categoryId: id });
      if (view === "pick") void save({ categoryId: id });
      else setView("form");
    };
    return (
      <PocketSheet
        open
        onClose={() => setView("form")}
        title={view === "pick" ? t("pocket.add.pickCategory") : t("pocket.add.allCategories")}
        size="full"
        footer={
          view === "pick" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ categoryId: null })}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-[var(--edge)] text-[15px] font-medium active:bg-[var(--edge-soft)] disabled:opacity-50"
            >
              {t("pocket.add.saveWithout")}
            </button>
          ) : undefined
        }
      >
        <div ref={gridRef} className="space-y-3 pt-1">
          {dirCategories.length > 12 ? (
            <input
              type="search"
              value={catQuery}
              onChange={(e) => setCatQuery(e.target.value)}
              placeholder={t("pocket.add.searchCategories")}
              aria-label={t("pocket.add.searchCategories")}
              className="h-11 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-base outline-none focus:border-teal-500"
            />
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {listed.map((c) => {
              const on = c.id === form.categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => choose(c.id)}
                  className={`flex min-h-[80px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[var(--ui-card-radius)] border px-1.5 py-2 text-center text-xs font-medium active:bg-[var(--edge-soft)] ${
                    on ? "border-teal-600 bg-teal-50 dark:border-teal-400 dark:bg-teal-950" : "border-[var(--edge)]"
                  }`}
                >
                  <Avatar color={c.color} label={c.name} />
                  <span className="line-clamp-2 w-full break-words">{c.name}</span>
                </button>
              );
            })}
          </div>
          {listed.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">{t("pocket.add.noCategoryMatch")}</p> : null}
        </div>
      </PocketSheet>
    );
  }

  /* ───────────── the form ───────────── */

  const title = editing
    ? origin?.out
      ? t("pocket.add.editTransfer")
      : t("tx.editTitle")
    : transfer
      ? t("tx.newTransfer")
      : mode === "income"
        ? t("pocket.add.newIncome")
        : t("pocket.add.newExpense");

  const pickedDay = form.date !== today && form.date !== yesterday;
  const words = { today: t("common.today"), yesterday: t("pocket.add.yesterday"), tomorrow: t("pocket.add.tomorrow") };
  const accountChip = (a: Account, on: boolean, onPick: () => void) => (
    <Chip key={a.id} active={on} onClick={onPick}>
      <span className="max-w-[10rem] truncate">{a.name}</span>
      <span className="text-[11px] opacity-70">{a.currency === "XAU_G" ? "g" : a.currency}</span>
    </Chip>
  );

  const topRegion = (
    <div className="space-y-4 pb-2 pt-1">
      {showRestored ? (
        <NoteCard onDismiss={() => setShowRestored(false)}>
          {t("pocket.add.draftRestored")}{" "}
          <button
            type="button"
            onClick={onStartOver}
            className="-my-2 inline-flex min-h-[44px] items-center font-medium text-teal-700 underline dark:text-teal-300"
          >
            {t("pocket.add.startOver")}
          </button>
        </NoteCard>
      ) : null}

      {editing ? (
        <p className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          <Icon name={transfer ? "transfer" : mode === "income" ? "arrowDown" : "arrowUp"} size={18} />
          {transfer ? t("tx.transfer") : mode === "income" ? t("tx.income") : t("tx.expense")}
        </p>
      ) : (
        <Segmented
          label={t("pocket.add.kind")}
          value={mode}
          onChange={switchMode}
          options={[
            { value: "expense", label: t("tx.expense") },
            { value: "income", label: t("tx.income") },
            { value: "transfer", label: t("tx.transfer") },
          ]}
        />
      )}

      {transfer ? (
        <>
          <Group label={t("transfer.from")}>
            {fromList.map((a) => accountChip(a, a.id === from?.id, () => patch({ fromId: a.id, expr: clampDecimals(form.expr, a.currency) })))}
          </Group>
          <Group label={t("transfer.to")}>
            {toList.map((a) => accountChip(a, a.id === to?.id, () => patch({ toId: a.id, receiveTyped: false, receiveExpr: "" })))}
          </Group>
        </>
      ) : (
        <>
          <Group label={mode === "expense" ? t("pocket.add.payWith") : t("pocket.add.addTo")}>
            {order.map((a) => accountChip(a, a.id === account?.id, () => chooseAccount(a)))}
          </Group>
          <Group label={t("common.category")}>
            {shownCategories.map((c) => (
              <Pill
                key={c.id}
                active={c.id === form.categoryId}
                color={c.color}
                onClick={() => patch({ categoryId: c.id === form.categoryId ? null : c.id })}
              >
                {c.name}
              </Pill>
            ))}
            <Pill active={false} onClick={() => setView("categories")} ariaLabel={t("pocket.add.allCategories")}>
              {t("common.all")}
              <Icon name="chevron" size={14} />
            </Pill>
          </Group>
        </>
      )}

      <Group label={t("common.date")}>
        <Chip active={form.date === today} onClick={() => setDate(today)}>
          {t("common.today")}
        </Chip>
        <Chip active={form.date === yesterday} onClick={() => setDate(yesterday)}>
          {t("pocket.add.yesterday")}
        </Chip>
        <span className="relative shrink-0">
          <Chip active={pickedDay} onClick={openPicker}>
            <Icon name="calendar" size={14} />
            {pickedDay ? dayLabel(form.date, today, locale, words) : t("pocket.add.pickDate")}
          </Chip>
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-hidden
            value={form.date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
            data-pocket-date
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </span>
      </Group>

      {!transfer && !editing ? (
        <button
          type="button"
          role="switch"
          aria-checked={planned}
          onClick={() => patch({ planned: !planned })}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-[15px]"
        >
          <span>{t("pocket.add.notPaidYet")}</span>
          <span
            aria-hidden
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${planned ? "bg-teal-600 dark:bg-teal-500" : "bg-[var(--edge)]"}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${planned ? "translate-x-[22px]" : "translate-x-0.5"}`}
            />
          </span>
        </button>
      ) : null}

      <div
        ref={noteBox}
        onFocus={() => setNoteFocused(true)}
        onBlur={(e) => {
          if (!noteBox.current?.contains(e.relatedTarget as Node | null)) setNoteFocused(false);
        }}
      >
        <label htmlFor={noteId} className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t("pocket.add.note")}
        </label>
        <input
          id={noteId}
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-base outline-none focus:border-teal-500"
        />
        {suggestions.length > 0 ? (
          // mousedown would take focus from the field and hide the chips before the tap lands
          <div className="mt-2" onMouseDown={(e) => e.preventDefault()}>
            <ChipRow label={t("pocket.add.earlierNotes")}>
              {suggestions.map((s) => (
                <Chip key={s.description} active={false} onClick={() => pickSuggestion(s)}>
                  {s.description}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
      </div>

      {editing?.status === "completed" ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("tx.editCompletedHint")}</p> : null}

      {!editing ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            chrome.openAddMenu();
          }}
          className="-mx-1 flex min-h-[44px] w-[calc(100%+0.5rem)] items-center justify-between rounded-lg px-1 text-[15px] font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("pocket.moreTypes")}
          <Icon name="chevron" size={18} />
        </button>
      ) : null}
    </div>
  );

  /* the figure: symbol + what's typed, shrinking as it grows */
  const figure = (expr: string, currency: Currency) =>
    withSymbol(expr === "" ? "0" : displayExpression(expr, locale), currency);
  const sendText = figure(form.expr, entryCurrency);
  const fontRem = Math.max(1.75, Math.min(2.75, (2.75 * 9) / Math.max(sendText.length, 9)));
  const receiveText =
    receiveTyped && target === "receive" && to
      ? figure(form.receiveExpr, to.currency)
      : receive != null && to
        ? fmt(receive, to.currency)
        : "—";
  const subLine = "text-xs tabular-nums text-zinc-500 dark:text-zinc-400";

  const twoFigures = transfer && from != null && to != null && !sameCurrency;
  const sendFigure = (
    <>
      <span className="shrink-0 pb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {transfer ? t("pocket.add.youSend") : t("common.amount")}
      </span>
      <output
        aria-live="polite"
        className={`flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap font-bold tabular-nums leading-tight ${
          form.expr === "" ? "text-zinc-300 dark:text-zinc-600" : ""
        }`}
        style={{ fontSize: `${fontRem}rem`, fontFamily: "var(--ui-figure-family)", letterSpacing: "var(--ui-figure-tracking)" }}
      >
        <span className={fresh && form.expr !== "" ? "rounded-md bg-teal-100 px-1 dark:bg-teal-900" : ""}>{sendText}</span>
      </output>
    </>
  );

  const amountBlock = (
    <div className="space-y-1">
      {/* a cross-currency transfer has two figures; tapping one points the keypad at it */}
      {twoFigures ? (
        <button
          type="button"
          aria-pressed={target === "send"}
          onClick={() => setTarget("send")}
          className={`flex w-full items-end justify-between gap-3 rounded-xl px-1 text-left ${target === "send" ? "bg-[var(--edge-soft)]" : ""}`}
        >
          {sendFigure}
        </button>
      ) : (
        <div className="flex w-full items-end justify-between gap-3 px-1">{sendFigure}</div>
      )}

      <div className="flex min-h-4 flex-col items-end gap-0.5 px-1 text-right">
        {!entered.ok && entered.reason === "divZero" ? (
          <span className="text-xs text-red-600 dark:text-red-400">{t("pocket.add.divideByZero")}</span>
        ) : entered.ok && hasOperator(form.expr) ? (
          <span className={subLine}>= {formatSigned(entered.value, entryCurrency, locale)}</span>
        ) : null}
        {inDisplay && account && amount != null ? (
          <span className={subLine}>{t("pocket.add.willSave", { amount: fmt(amount, account.currency), account: account.name })}</span>
        ) : !transfer && account && amount != null && amount > 0 ? (
          <Approx amount={amount} from={account.currency} to={displayCurrency} usdPer={usdPer} className="text-xs!" />
        ) : null}
      </div>

      {budgetWarning ? (
        <p className={`px-1 text-xs ${budgetWarning.level === "over" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
          {budgetWarning.level === "over"
            ? t("budgets.entryOver", { category: selectedCategory?.name ?? "", limit: fmt(budgetWarning.limit, budgetWarning.currency) })
            : t("budgets.entryWarn", {
                category: selectedCategory?.name ?? "",
                spent: fmt(budgetWarning.spent, budgetWarning.currency),
                limit: fmt(budgetWarning.limit, budgetWarning.currency),
              })}
        </p>
      ) : null}

      {transfer && from && to && !sameCurrency ? (
        <>
          {typing ? null : (
            <button
              type="button"
              aria-pressed={target === "receive"}
              onClick={() => {
                setTarget("receive");
                setFreshReceive(true);
              }}
              className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-1 text-left ${
                target === "receive" ? "bg-[var(--edge-soft)]" : ""
              }`}
            >
              <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("pocket.add.theyReceive")}</span>
              <span className="min-w-0 truncate whitespace-nowrap text-xl font-semibold tabular-nums">{receiveText}</span>
            </button>
          )}
          <div className="flex min-h-[28px] items-center justify-between gap-2 px-1">
            <span className={`min-w-0 truncate ${subLine}`}>
              {market == null ? (
                t("common.rateUnavailable")
              ) : receiveTyped && eff != null ? (
                <>
                  {t("pocket.add.rateLine", {
                    from: from.currency,
                    to: to.currency,
                    rate: eff.toLocaleString(locale, { maximumFractionDigits: 4 }),
                    market: market.toLocaleString(locale, { maximumFractionDigits: 4 }),
                    spread: spread == null ? "" : `${spread > 0 ? "+" : spread < 0 ? "−" : ""}${Math.abs(spread).toFixed(2)}%`,
                  })}
                </>
              ) : (
                t("pocket.add.marketLine", {
                  from: from.currency,
                  to: to.currency,
                  rate: market.toLocaleString(locale, { maximumFractionDigits: 4 }),
                })
              )}
            </span>
            {receiveTyped && marketReceive != null ? (
              <button
                type="button"
                onClick={useMarket}
                className="-my-2 flex min-h-[44px] shrink-0 items-center text-xs font-medium text-teal-700 dark:text-teal-300"
              >
                {t("transfer.useMarket")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );

  const typedFields = (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {transfer ? t("pocket.add.youSend") : t("common.amount")} ({entryCurrency === "XAU_G" ? "g" : entryCurrency})
        </span>
        <input
          data-autofocus
          autoFocus
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={typedText}
          onChange={(e) => onTyped(e.target.value)}
          aria-invalid={typedInvalid || undefined}
          className="h-12 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-right text-base tabular-nums outline-none focus:border-teal-500"
        />
      </label>
      {transfer && to && !sameCurrency ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("pocket.add.theyReceive")} ({to.currency === "XAU_G" ? "g" : to.currency})
          </span>
          <input
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={typedReceive}
            placeholder={marketReceive != null ? typedFromExpression(amountForEditing(marketReceive, to.currency, "en"), locale) : ""}
            onChange={(e) => onTypedReceive(e.target.value)}
            aria-invalid={typedReceiveInvalid || undefined}
            className="h-12 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-right text-base tabular-nums outline-none focus:border-teal-500"
          />
        </label>
      ) : null}
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  );

  const footer = (
    <div className="space-y-2">
      {amountBlock}
      {noteFocused ? null : (
        <>
          <div className="flex min-h-[44px] items-center justify-between gap-2">
            {canEnterIn ? (
              <Pill
                active={form.inDisplay}
                disabled={!usdPer || convert(1, displayCurrency, account!.currency, usdPer) == null}
                onClick={() => {
                  const next = !form.inDisplay;
                  const cur = next ? displayCurrency : account!.currency;
                  patch({ inDisplay: next, expr: clampDecimals(form.expr, cur) });
                }}
              >
                {t("pocket.add.enterIn", { currency: displayCurrency === "XAU_G" ? "g" : displayCurrency })}
              </Pill>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={toggleTyping}
              className="-mr-1 flex min-h-[44px] items-center rounded-lg px-1 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              {typing ? t("pocket.add.useKeypad") : t("pocket.add.typeInstead")}
            </button>
          </div>
          {typing ? typedFields : <Keypad onKey={onKey} />}
        </>
      )}
      <div className="flex items-center gap-3 pt-1">
        {reason ? (
          <span role="status" className="max-w-[42%] text-xs leading-tight text-zinc-500 dark:text-zinc-400">
            {reason}
          </span>
        ) : null}
        <button
          type="button"
          disabled={reason != null || busy}
          onClick={() => void save()}
          data-pocket-add-save
          className="flex min-h-[52px] min-w-0 flex-1 items-center justify-center rounded-xl bg-teal-600 px-4 text-[15px] font-semibold text-white active:scale-[0.98] disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950"
        >
          <span className="truncate">{label}</span>
        </button>
      </div>
    </div>
  );

  return (
    <PocketSheet open onClose={onClose} title={title} size="full" footer={footer}>
      {topRegion}
    </PocketSheet>
  );
}

/** A labelled, sideways-scrolling row of chips. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p aria-hidden className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <ChipRow label={label}>{children}</ChipRow>
    </div>
  );
}

/**
 * A chip that can carry a category's own colour when selected, or be
 * disabled — the two things the kit's Chip doesn't do. Same size and hit
 * area (32px, extended to 44px).
 */
function Pill({
  active,
  onClick,
  color,
  disabled,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const filled = active && color;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      style={filled ? { background: color, color: inkOn(color), borderColor: "transparent" } : undefined}
      className={`relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--pocket-chip-radius,9999px)] border px-3 text-[13px] font-medium before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] disabled:opacity-40 ${
        active && !color
          ? "border-transparent bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
          : "border-[var(--edge)] bg-[var(--surface)] text-zinc-600 dark:text-zinc-300"
      }`}
    >
      {color && !active ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      {children}
    </button>
  );
}
