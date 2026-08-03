"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepo } from "@/lib/data/provider";
import { KEYS, usePlans } from "@/lib/data/queries";
import { EMPTY_PLAN, normalizePlan, Plan } from "@/lib/domain/planner";
import { todayISO } from "@/lib/domain/recurrence";

/** which scenario this device had open — the plans themselves live server-side */
const SELECTED_KEY = "renovator-plan-selected";
/** the old single device-local plan, imported once and then left alone */
const LEGACY_PLAN_KEY = "renovator-plan-v1";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Named scenarios, stored on the server so the same plan opens on the phone
 * and the laptop. Edits are debounced rather than saved per keystroke, and the
 * on-screen plan stays authoritative while a save is in flight so typing never
 * fights the round-trip.
 */
export function usePlanScenarios() {
  const repo = useRepo();
  const queryClient = useQueryClient();
  const plans = usePlans();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the edit a debounced save is still sitting on */
  const pending = useRef<{ id: string; plan: Plan } | null>(null);
  const seeded = useRef(false);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: KEYS.plans }),
    [queryClient]
  );

  // First load: adopt the remembered scenario, or the newest one. A plan left
  // in localStorage by an older version is imported once so nothing is lost.
  useEffect(() => {
    if (seeded.current || !plans.data) return;
    seeded.current = true;
    queueMicrotask(async () => {
      const thisMonth = todayISO().slice(0, 7);
      let list = plans.data!;

      if (list.length === 0) {
        let legacy: unknown = null;
        try {
          const raw = window.localStorage.getItem(LEGACY_PLAN_KEY);
          if (raw) legacy = JSON.parse(raw);
        } catch {
          // unreadable → start clean
        }
        const body = normalizePlan(legacy, thisMonth);
        const created = await repo.createPlan("My plan", body);
        await invalidate();
        list = [created];
      }

      const remembered = window.localStorage.getItem(SELECTED_KEY);
      const chosen = list.find((p) => p.id === remembered) ?? list[0];
      setSelectedId(chosen.id);
      setPlan(normalizePlan(chosen.body, thisMonth));
      setReady(true);
    });
  }, [plans.data, repo, invalidate]);

  const flush = useCallback(
    async (id: string, next: Plan) => {
      pending.current = null;
      setSaving(true);
      try {
        await repo.updatePlan(id, { body: next });
      } finally {
        setSaving(false);
      }
    },
    [repo]
  );

  /** Edit the open scenario. The write is debounced; the screen updates now. */
  const update = useCallback(
    (next: Plan) => {
      setPlan(next);
      if (!selectedId) return;
      pending.current = { id: selectedId, plan: next };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(selectedId, next), SAVE_DEBOUNCE_MS);
    },
    [selectedId, flush]
  );

  const select = useCallback(
    (id: string) => {
      const found = plans.data?.find((p) => p.id === id);
      if (!found) return;
      if (pending.current) void flush(pending.current.id, pending.current.plan);
      if (timer.current) clearTimeout(timer.current);
      window.localStorage.setItem(SELECTED_KEY, id);
      setSelectedId(id);
      setPlan(normalizePlan(found.body, todayISO().slice(0, 7)));
    },
    [plans.data, flush]
  );

  const create = useCallback(
    async (name: string, body: Plan = EMPTY_PLAN) => {
      const created = await repo.createPlan(name, body);
      await invalidate();
      window.localStorage.setItem(SELECTED_KEY, created.id);
      setSelectedId(created.id);
      setPlan(body);
      return created;
    },
    [repo, invalidate]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await repo.updatePlan(id, { name });
      await invalidate();
    },
    [repo, invalidate]
  );

  const remove = useCallback(
    async (id: string) => {
      await repo.deletePlan(id);
      const rest = (plans.data ?? []).filter((p) => p.id !== id);
      await invalidate();
      if (rest.length > 0) {
        window.localStorage.setItem(SELECTED_KEY, rest[0].id);
        setSelectedId(rest[0].id);
        setPlan(normalizePlan(rest[0].body, todayISO().slice(0, 7)));
      } else {
        const created = await repo.createPlan("My plan", EMPTY_PLAN);
        await invalidate();
        window.localStorage.setItem(SELECTED_KEY, created.id);
        setSelectedId(created.id);
        setPlan(EMPTY_PLAN);
      }
    },
    [repo, invalidate, plans.data]
  );

  // Don't lose the last keystroke on the way out. Closing the tab or hiding
  // the page mid-debounce would otherwise drop an edit the user watched land.
  useEffect(() => {
    const flushNow = () => {
      const due = pending.current;
      if (!due) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void flush(due.id, due.plan);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushNow);
      flushNow();
    };
  }, [flush]);

  return {
    scenarios: plans.data ?? [],
    selectedId,
    plan,
    ready,
    saving,
    update,
    select,
    create,
    rename,
    remove,
  };
}
