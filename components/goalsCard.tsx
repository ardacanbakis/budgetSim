"use client";

import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useGoals, useTransactions } from "@/lib/data/queries";
import { Goal } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { goalProgress } from "@/lib/domain/budgets";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/** Account-linked savings goals: progress from real balances + required monthly saving. */
export function GoalsCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const goals = useGoals();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const deleteGoal = useAppMutation((id: string) => repo.deleteGoal(id), [KEYS.goals]);

  const balances = useMemo(
    () => (accounts.data && transactions.data ? computeBalances(accounts.data, transactions.data) : new Map<string, number>()),
    [accounts.data, transactions.data]
  );
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const today = todayISO();

  return (
    <Card className={className}>
      <CardHeader
        title={t("goals.title")}
        action={
          <Button variant="ghost" onClick={() => setModalOpen(true)}>
            + {t("goals.newGoal")}
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {(goals.data ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">{t("goals.empty")}</p>
        ) : (
          (goals.data ?? []).map((goal) => {
            const account = accountById.get(goal.accountId);
            if (!account) return null;
            const progress = goalProgress(goal, balances.get(goal.accountId) ?? 0, today);
            return (
              <div key={goal.id}>
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                  <button className="font-medium text-zinc-700 hover:text-teal-600 dark:text-zinc-200" onClick={() => setEditing(goal)}>
                    {goal.name}
                  </button>
                  <span className="tabular-nums text-zinc-500">
                    {formatAmount(progress.current, account.currency, locale)} /{" "}
                    {formatAmount(goal.targetAmount, account.currency, locale)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${progress.pct >= 100 ? "bg-emerald-500" : "bg-sky-500"}`}
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <div className="mt-0.5 flex justify-between text-[11px] text-zinc-400">
                  <span>
                    {account.name}
                    {goal.targetDate ? ` · ${goal.targetDate}` : ""}
                  </span>
                  <span>
                    {progress.pct >= 100
                      ? t("goals.reached")
                      : progress.requiredMonthly != null
                        ? t("goals.requiredMonthly", { amount: formatAmount(progress.requiredMonthly, account.currency, locale) })
                        : `${Math.round(progress.pct)}%`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <GoalModal
        open={modalOpen || editing != null}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                await deleteGoal.mutateAsync(editing.id);
                setEditing(null);
              }
            : undefined
        }
      />
    </Card>
  );
}

function GoalModal({
  open,
  initial,
  onClose,
  onDelete,
}: {
  open: boolean;
  initial: Goal | null;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");

  const save = useAppMutation(
    async () => {
      const input = {
        name,
        accountId: accountId || active[0]?.id,
        targetAmount: Number(target),
        targetDate: targetDate || null,
      };
      if (initial) await repo.updateGoal(initial.id, input);
      else await repo.createGoal(input);
    },
    [KEYS.goals]
  );

  const targetKey = initial?.id ?? (open ? "new" : "closed");
  if (open && initialized !== targetKey) {
    setInitialized(targetKey);
    setName(initial?.name ?? "");
    setAccountId(initial?.accountId ?? "");
    setTarget(initial ? String(initial.targetAmount) : "");
    setTargetDate(initial?.targetDate ?? "");
  }

  const account = active.find((a) => a.id === (accountId || active[0]?.id));

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("goals.newGoal")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(Number(target) > 0) || !account) return;
          await save.mutateAsync(undefined as never);
          onClose();
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund" />
        </Field>
        <Field label={t("goals.linkedAccount")}>
          <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("goals.target")} ${account ? `(${account.currency})` : ""}`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label={`${t("goals.targetDate")} (${t("common.optional")})`}>
            <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
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
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
