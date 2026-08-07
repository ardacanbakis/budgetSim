"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccounts } from "@/lib/data/queries";
import { useI18n } from "@/lib/i18n";
import { NAV } from "@/components/shell.nav";
import { rankByLabel } from "@/lib/ui/rank";

export interface Command {
  id: string;
  label: string;
  /** shown right-aligned: which page it lives on, or a balance */
  hint?: string;
  run: () => void;
}

/**
 * Jump anywhere without going back to the sidebar first. Pages, accounts and
 * the two things you do most (add a transaction, move money) all live in the
 * same list, because when you already know where you're going, reading a menu
 * is the slow part.
 */
export function CommandPalette({
  onClose,
  onNewTransaction,
  onNewTransfer,
}: {
  onClose: () => void;
  onNewTransaction: () => void;
  onNewTransfer: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const accounts = useAccounts();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };
    const pages: Command[] = NAV.map((item) => ({
      id: `nav:${item.href}`,
      label: t(item.key),
      hint: t("palette.page"),
      run: go(item.href),
    }));
    const actions: Command[] = [
      {
        id: "act:tx",
        label: t("tx.newTransaction"),
        hint: "n",
        run: () => {
          onNewTransaction();
          onClose();
        },
      },
      {
        id: "act:transfer",
        label: t("tx.transfer"),
        hint: "t",
        run: () => {
          onNewTransfer();
          onClose();
        },
      },
    ];
    const live = (accounts.data ?? []).filter((a) => !a.archived);
    const accountCmds: Command[] = live.map((a) => ({
      id: `acct:${a.id}`,
      label: a.name,
      hint: a.kind === "credit_card" ? t("nav.cards") : t("nav.accounts"),
      run: go(a.kind === "credit_card" ? "/cards" : "/accounts"),
    }));
    return [...pages, ...actions, ...accountCmds];
  }, [t, router, onClose, onNewTransaction, onNewTransfer, accounts.data]);

  const results = useMemo(() => rankByLabel(query, commands).slice(0, 12), [query, commands]);

  // The shell mounts this only while it's open, so opening always starts from
  // an empty query and the top of the list without any resetting to do.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // keep the highlighted row in view when arrowing past the fold
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div
      className="no-print fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--edge)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          className="w-full border-b border-[var(--edge-soft)] bg-transparent px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              results[cursor]?.run();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-400">{t("palette.noMatch")}</p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-active={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={c.run}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  i === cursor
                    ? "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                <span className="truncate">{c.label}</span>
                {c.hint ? <span className="shrink-0 text-xs text-zinc-400">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
