import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { amortizationSchedule } from "@/lib/domain/loan";
import { buildPurchaseTransactionSpecs } from "@/lib/domain/purchases";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import {
  Account,
  Category,
  Loan,
  Purchase,
  RecurringTemplate,
  Transaction,
  VictvsPayout,
  VictvsSession,
} from "./types";

export interface DemoStore {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  victvsSessions: VictvsSession[];
  victvsPayouts: VictvsPayout[];
  loans: Loan[];
  purchases: Purchase[];
}

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Realistic sandbox: accounts in all five currencies, a month of activity,
 * VICTVS sessions in both states, a recurring salary + rent, and a tracked
 * car loan — so every screen has something to show before signing up.
 */
export function buildDemoSeed(): DemoStore {
  const today = todayISO();
  const lastMonth = addMonthsClamped(today, -1);
  const nowIso = new Date().toISOString();
  const snapshot = { usdPer: FALLBACK_USD_PER, at: nowIso };

  const base = { archived: false, paymentAccountId: null, createdAt: nowIso };
  const accounts: Account[] = [
    { ...base, id: uuid(), name: "Ziraat TRY", currency: "TRY", kind: "fiat", openingBalance: 260000 },
    { ...base, id: uuid(), name: "Wise USD", currency: "USD", kind: "fiat", openingBalance: 6400 },
    { ...base, id: uuid(), name: "EUR Savings", currency: "EUR", kind: "fiat", openingBalance: 2150 },
    { ...base, id: uuid(), name: "Cold Wallet", currency: "BTC", kind: "crypto", openingBalance: 0.0412 },
    { ...base, id: uuid(), name: "Gram Gold", currency: "XAU_G", kind: "gold", openingBalance: 36 },
  ];
  const [tryAcc, usdAcc, , ,] = accounts;
  const cardAcc: Account = {
    ...base,
    id: uuid(),
    name: "Bonus Card",
    currency: "TRY",
    kind: "credit_card",
    openingBalance: 0,
    paymentAccountId: tryAcc.id,
  };
  accounts.push(cardAcc);

  const mkCat = (name: string, direction: Category["direction"], color: string): Category => ({
    id: uuid(),
    name,
    direction,
    color,
  });
  const categories: Category[] = [
    mkCat("Salary", "income", "#16a34a"),
    mkCat("VICTVS", "income", "#0ea5e9"),
    mkCat("Freelance", "income", "#8b5cf6"),
    mkCat("Other income", "income", "#64748b"),
    mkCat("Rent & housing", "expense", "#ef4444"),
    mkCat("Groceries", "expense", "#f59e0b"),
    mkCat("Utilities & bills", "expense", "#06b6d4"),
    mkCat("Transport", "expense", "#84cc16"),
    mkCat("Loan payment", "expense", "#dc2626"),
    mkCat("Health", "expense", "#ec4899"),
    mkCat("Entertainment", "expense", "#a855f7"),
    mkCat("Other expense", "expense", "#64748b"),
  ];
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;

  const baseTx = {
    fxSnapshot: snapshot,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    createdAt: nowIso,
  };

  const transactions: Transaction[] = [
    { ...baseTx, id: uuid(), accountId: usdAcc.id, direction: "income", categoryId: cat("Freelance"), amount: 1800, status: "completed", dueDate: `${lastMonth.slice(0, 7)}-25`, completedAt: nowIso, description: "Contract work — invoice #14" },
    { ...baseTx, id: uuid(), accountId: tryAcc.id, direction: "expense", categoryId: cat("Groceries"), amount: 4350.75, status: "completed", dueDate: `${today.slice(0, 7)}-02`, completedAt: nowIso, description: "Weekly market" },
    { ...baseTx, id: uuid(), accountId: tryAcc.id, direction: "expense", categoryId: cat("Utilities & bills"), amount: 1620.4, status: "completed", dueDate: `${today.slice(0, 7)}-01`, completedAt: nowIso, description: "Electricity + internet" },
    // A cross-currency transfer: $500 → TRY at an effective rate slightly under market
    (() => {
      const g = uuid();
      return { ...baseTx, id: uuid(), accountId: usdAcc.id, direction: "expense" as const, categoryId: null, amount: 500, status: "completed" as const, dueDate: `${today.slice(0, 7)}-03`, completedAt: nowIso, description: "To Ziraat TRY", transferGroupId: g, transferMarketRate: 1 / FALLBACK_USD_PER.TRY! };
    })(),
    // planned upcoming items
    { ...baseTx, id: uuid(), accountId: tryAcc.id, direction: "expense", categoryId: cat("Health"), amount: 2800, status: "planned", dueDate: addMonthsClamped(today, 0) < today ? today : `${today.slice(0, 7)}-28`, completedAt: null, description: "Dentist follow-up", fxSnapshot: null },
    { ...baseTx, id: uuid(), accountId: usdAcc.id, direction: "income", categoryId: cat("Freelance"), amount: 1200, status: "planned", dueDate: addMonthsClamped(today, 1), completedAt: null, description: "Contract work — invoice #15", fxSnapshot: null },
  ];
  // second leg of the transfer
  const transferOut = transactions[3];
  transactions.push({
    ...baseTx,
    id: uuid(),
    accountId: tryAcc.id,
    direction: "income",
    categoryId: null,
    amount: 20350,
    status: "completed",
    dueDate: transferOut.dueDate,
    completedAt: nowIso,
    description: "From Wise USD",
    transferGroupId: transferOut.transferGroupId,
    transferMarketRate: transferOut.transferMarketRate,
  });

  const templates: RecurringTemplate[] = [
    { id: uuid(), name: "VICTVS retainer", accountId: usdAcc.id, direction: "income", categoryId: cat("VICTVS"), amount: 900, frequency: "monthly", startDate: `${today.slice(0, 7)}-05`, endDate: null, autoComplete: false, loanId: null, createdAt: nowIso },
    { id: uuid(), name: "Rent", accountId: tryAcc.id, direction: "expense", categoryId: cat("Rent & housing"), amount: 27500, frequency: "monthly", startDate: `${today.slice(0, 7)}-10`, endDate: null, autoComplete: true, loanId: null, createdAt: nowIso },
  ];

  // Tracked car loan: 800k TRY, 2.79%/mo, 36 months, started 3 months ago.
  const loanStart = addMonthsClamped(today, -3);
  const schedule = amortizationSchedule(800000, 2.79, 36, loanStart, "TRY");
  const loanId = uuid();
  const loanTemplate: RecurringTemplate = {
    id: uuid(),
    name: "Car loan installment",
    accountId: tryAcc.id,
    direction: "expense",
    categoryId: cat("Loan payment"),
    amount: schedule.installment,
    frequency: "monthly",
    startDate: schedule.rows[0].date,
    endDate: schedule.rows[schedule.rows.length - 1].date,
    autoComplete: false,
    loanId,
    createdAt: nowIso,
  };
  templates.push(loanTemplate);
  const loans: Loan[] = [
    { id: loanId, name: "Car loan — Garanti", kind: "car", currency: "TRY", principal: 800000, monthlyRatePct: 2.79, termMonths: 36, startDate: loanStart, installment: schedule.installment, recurringTemplateId: loanTemplate.id, createdAt: nowIso },
  ];
  // first three installments already paid
  for (const row of schedule.rows.slice(0, 3)) {
    transactions.push({
      ...baseTx,
      id: uuid(),
      accountId: tryAcc.id,
      direction: "expense",
      categoryId: cat("Loan payment"),
      amount: row.payment,
      status: "completed",
      dueDate: row.date,
      completedAt: nowIso,
      description: `Car loan installment ${row.n}/36`,
      recurringTemplateId: loanTemplate.id,
      loanId,
    });
  }

  // Big purchases: a reflected 6-installment phone on the card (2 posted) +
  // an unreflected one-shot log entry. Groceries/bills also hit the card so
  // the averages card has data.
  const phonePurchaseDate = addMonthsClamped(today, -2);
  const phoneFirstDue = addMonthsClamped(phonePurchaseDate, 1);
  const phonePurchase: Purchase = {
    id: uuid(),
    name: "iPhone 17",
    accountId: cardAcc.id,
    amount: 84000,
    purchaseDate: phonePurchaseDate,
    installmentCount: 6,
    firstDue: phoneFirstDue,
    details: "Apple Store, 2yr warranty",
    reflected: true,
    categoryId: cat("Other expense"),
    createdAt: nowIso,
  };
  const oneShotPurchase: Purchase = {
    id: uuid(),
    name: "Washing machine",
    accountId: tryAcc.id,
    amount: 32500,
    purchaseDate: addMonthsClamped(today, -1),
    installmentCount: 1,
    firstDue: addMonthsClamped(today, -1),
    details: "Not reflected — paid before I started tracking",
    reflected: false,
    categoryId: cat("Other expense"),
    createdAt: nowIso,
  };
  const purchases = [phonePurchase, oneShotPurchase];
  for (const spec of buildPurchaseTransactionSpecs(phonePurchase, "TRY", today)) {
    transactions.push({
      ...baseTx,
      id: uuid(),
      accountId: cardAcc.id,
      direction: "expense",
      categoryId: phonePurchase.categoryId,
      amount: spec.amount,
      status: spec.status,
      dueDate: spec.dueDate,
      completedAt: spec.status === "completed" ? nowIso : null,
      description: spec.description,
      fxSnapshot: spec.status === "completed" ? snapshot : null,
      purchaseId: phonePurchase.id,
    });
  }
  // groceries on the card this month + last month (feeds averages, card debt)
  transactions.push(
    { ...baseTx, id: uuid(), accountId: cardAcc.id, direction: "expense", categoryId: cat("Groceries"), amount: 5240.3, status: "completed", dueDate: `${lastMonth.slice(0, 7)}-18`, completedAt: nowIso, description: "Migros + market" },
    { ...baseTx, id: uuid(), accountId: cardAcc.id, direction: "expense", categoryId: cat("Utilities & bills"), amount: 980, status: "completed", dueDate: `${lastMonth.slice(0, 7)}-21`, completedAt: nowIso, description: "Phone + internet" }
  );

  const victvsSessions: VictvsSession[] = [
    { id: uuid(), date: `${lastMonth.slice(0, 7)}-08`, sessionType: "Pearson VUE Invigilation", amount: 120, status: "unpaid", payoutId: null, notes: "", source: "paste", createdAt: nowIso },
    { id: uuid(), date: `${lastMonth.slice(0, 7)}-15`, sessionType: "Remote Proctoring AM", amount: 95.5, status: "unpaid", payoutId: null, notes: "", source: "paste", createdAt: nowIso },
    { id: uuid(), date: `${lastMonth.slice(0, 7)}-22`, sessionType: "On-site Lead Invigilator", amount: 150, status: "unpaid", payoutId: null, notes: "", source: "manual", createdAt: nowIso },
    { id: uuid(), date: addMonthsClamped(`${lastMonth.slice(0, 7)}-28`, -1), sessionType: "IELTS Session", amount: 85, status: "paid", payoutId: null, notes: "", source: "manual", createdAt: nowIso },
  ];

  return {
    accounts,
    categories,
    transactions,
    templates,
    victvsSessions,
    victvsPayouts: [] as VictvsPayout[],
    loans,
    purchases,
  };
}
