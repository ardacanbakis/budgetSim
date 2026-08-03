"use client";

import { useState } from "react";
import { Button, Input, Modal, Select } from "@/components/ui";
import type { PlanRecord } from "@/lib/data/types";
import { useI18n } from "@/lib/i18n";

/**
 * Pick which saved scenario you're editing, and optionally a second one to
 * draw beside it. Scenarios live on the server, so the same named plan opens
 * wherever you sign in.
 */
export function ScenarioBar({
  scenarios,
  selectedId,
  compareId,
  saving,
  onSelect,
  onCompare,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
}: {
  scenarios: PlanRecord[];
  selectedId: string | null;
  compareId: string | null;
  saving: boolean;
  onSelect: (id: string) => void;
  onCompare: (id: string | null) => void;
  onCreate: (name: string) => Promise<unknown>;
  onDuplicate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<"new" | "duplicate" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const current = scenarios.find((s) => s.id === selectedId);
  const others = scenarios.filter((s) => s.id !== selectedId);

  function open(kind: "new" | "duplicate" | "rename") {
    setName(
      kind === "rename"
        ? (current?.name ?? "")
        : kind === "duplicate"
          ? t("planner.copyOf", { name: current?.name ?? "" })
          : ""
    );
    setDialog(kind);
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (dialog === "new") await onCreate(trimmed);
      else if (dialog === "duplicate") await onDuplicate(trimmed);
      else if (dialog === "rename" && selectedId) await onRename(selectedId, trimmed);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t("planner.scenario")}
        className="!w-auto min-w-44"
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>

      <Button onClick={() => open("new")}>+ {t("planner.newScenario")}</Button>
      <Button onClick={() => open("duplicate")} disabled={!current}>
        {t("planner.duplicate")}
      </Button>
      <Button onClick={() => open("rename")} disabled={!current}>
        {t("common.edit")}
      </Button>
      <Button
        variant="ghost"
        disabled={!current}
        onClick={() => {
          if (current && window.confirm(t("planner.deleteScenario", { name: current.name }))) {
            void onDelete(current.id);
          }
        }}
      >
        {t("common.delete")}
      </Button>

      {others.length > 0 ? (
        <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
          {t("planner.compareWith")}
          <Select
            aria-label={t("planner.compareWith")}
            className="!w-auto"
            value={compareId ?? ""}
            onChange={(e) => onCompare(e.target.value || null)}
          >
            <option value="">{t("common.none")}</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <span
        className={`text-xs ${saving ? "text-zinc-400" : "text-emerald-600"} ${others.length > 0 ? "" : "ml-auto"}`}
      >
        {saving ? t("planner.saving") : t("planner.saved")}
      </span>

      <Modal
        open={dialog != null}
        onClose={() => setDialog(null)}
        title={
          dialog === "rename"
            ? t("planner.renameScenario")
            : dialog === "duplicate"
              ? t("planner.duplicate")
              : t("planner.newScenario")
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            aria-label={t("common.name")}
            placeholder={t("planner.scenarioPlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
