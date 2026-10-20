"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation } from "@/lib/data/queries";
import { Loan } from "@/lib/data/types";
import { loanProgress } from "@/lib/domain/debt";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";
import { formatSigned } from "@/lib/ui/pocket/format";
import { PORTFOLIO_SCROLL_KEY, PortfolioSegment } from "@/lib/ui/pocket/portfolioSections";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { portfolioHref } from "@/lib/ui/portfolioUrl";
import { pushQuery, replaceQuery } from "@/lib/ui/shallowUrl";
import { ApproxLine, LoanAvatar, usePortfolioBase } from "./accountDetail";
import { PocketTxRow, useTxLookup } from "./dayList";
import { Icon } from "./icons";
import { FitFigure, Money, PocketPage, Section } from "./kit";
import { PocketActionSheet } from "./sheet";
import { usePocketTxSheet } from "./txActions";

/**
 * One tracked loan full-screen (/accounts?loan={id}, with the view it was
 * opened from), Pocket's version of the Classic Debts view's right-hand pane:
 * what's left with its ≈, how far along it is, the instalments still planned
 * with a ✓ each, the whole schedule on request, and Delete.
 *
 * Like an account's page it is a layer of the Portfolio route: Back (the
 * header's chevron or the browser's) closes it and the list comes back where
 * it was scrolled to; opened by a link, it closes to the list.
 */

/** Opened from the list in this tab: Back can simply go back. */
let openedFromList = false;

/** Open a loan's page from the list, remembering where the list was scrolled. */
export function openLoan(id: string, view: PortfolioSegment | null): void {
  try {
    window.sessionStorage.setItem(PORTFOLIO_SCROLL_KEY, String(window.scrollY));
  } catch {
    // no storage: the list just opens at the top
  }
  openedFromList = true;
  pushQuery(portfolioHref({ view, loan: id }));
}

function closeLoan(router: ReturnType<typeof useRouter>, view: PortfolioSegment | null): void {
  if (openedFromList) {
    openedFromList = false;
    router.back();
  } else {
    replaceQuery(portfolioHref({ view }));
  }
}

const UPCOMING_ROWS = 5;

export function LoanDetail({ loan, view }: { loan: Loan; view: PortfolioSegment | null }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const router = useRouter();
  const repo = useRepo();
  const base = usePortfolioBase();
  const lookup = useTxLookup();
  const txSheet = usePocketTxSheet();
  const [confirming, setConfirming] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const deleteLoan = useAppMutation((id: string) => repo.deleteLoan(id), [KEYS.loans, KEYS.templates, KEYS.transactions]);

  // the URL changed in place, scroll and all; the page itself starts at its top
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [loan.id]);

  const back = useMemo(() => ({ label: "", onBack: () => closeLoan(router, view) }), [router, view]);

  const progress = useMemo(() => loanProgress(loan, base.transactions ?? []), [loan, base.transactions]);
  const { schedule, paid, term, remaining, pct, endDate } = progress;
  const planned = useMemo(
    () =>
      (base.transactions ?? [])
        .filter((tx) => tx.loanId === loan.id && tx.status === "planned")
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)),
    [base.transactions, loan.id]
  );
  const fmt = (n: number) => formatSigned(n, loan.currency, locale, "none");
  const cardClass =
    "overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm";

  return (
    <PocketPage title={loan.name} condensed={loan.name} back={back}>
      <div data-loan-detail={loan.id} className="space-y-4">
        <section aria-label={loan.name} className={cardClass}>
          <div className="flex items-center gap-3 px-4 pt-3">
            <LoanAvatar />
            <Badge tone="sky">{t(`loans.${loan.kind}`)}</Badge>
          </div>
          <div className="space-y-1 px-4 pb-4 pt-2" data-loan-remaining>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("loans.remaining")}</p>
            <FitFigure tone="neg">{formatSigned(-remaining, loan.currency, locale)}</FitFigure>
            <ApproxLine amount={-remaining} from={loan.currency} to={base.display} usdPer={base.usdPer} settled={base.ratesSettled} exact />
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>{t("loans.progress", { paid, term })}</span>
                <span>{pct}%</span>
              </div>
              <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--edge-soft)]">
                <span className="block h-full rounded-full bg-teal-600 dark:bg-teal-500" style={{ width: `${pct}%` }} />
              </span>
            </div>
          </div>
        </section>

        <Section flush>
          <dl className="divide-y divide-[var(--edge-soft)] text-[15px]">
            <Fact label={t("loans.installment")}>
              <Money amount={loan.installment} currency={loan.currency} sign="none" />
            </Fact>
            <Fact label={t("loans.monthlyRate")}>%{loan.monthlyRatePct}</Fact>
            <Fact label={t("loans.firstPayment")}>{schedule.rows[0] ? fmtDate(schedule.rows[0].date) : "—"}</Fact>
            <Fact label={t("pages.lastPayment")}>{endDate ? fmtDate(endDate) : "—"}</Fact>
          </dl>
        </Section>

        {planned.length > 0 ? (
          <Section title={t("portfolio.upcoming")} flush>
            <ul className="divide-y divide-[var(--edge-soft)]" data-loan-upcoming>
              {planned.slice(0, UPCOMING_ROWS).map((tx) => (
                <PocketTxRow key={tx.id} tx={tx} lookup={lookup} onTap={txSheet.open} onComplete={txSheet.complete} due />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section flush>
          <button
            type="button"
            aria-expanded={scheduleOpen}
            onClick={() => setScheduleOpen(!scheduleOpen)}
            className="flex min-h-[48px] w-full items-center justify-between gap-2 px-4 text-left text-[15px] font-medium active:bg-[var(--edge-soft)]"
          >
            {t("loans.schedule")}
            <Icon name="chevron" size={18} className={`shrink-0 text-zinc-400 transition-transform ${scheduleOpen ? "rotate-90" : ""}`} />
          </button>
          {scheduleOpen ? (
            <ol className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]" data-loan-schedule>
              {schedule.rows.map((row) => {
                const done = row.n <= paid;
                return (
                  <li key={row.n} className={`flex items-center gap-3 px-4 py-2 text-sm tabular-nums ${done ? "text-zinc-400" : ""}`}>
                    <span className="w-8 shrink-0 text-xs text-zinc-400">{done ? <span aria-label={t("pages.paid")}>✓</span> : row.n}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block">{fmtDate(row.date)}</span>
                      <span className="block text-[11px] text-zinc-400">
                        {t("loans.remaining")} {fmt(row.remaining)}
                      </span>
                    </span>
                    <span data-amount className="shrink-0 font-medium">
                      {fmt(row.payment)}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </Section>

        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setConfirming(true)}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] text-[15px] font-medium text-red-600 active:bg-[var(--edge-soft)] dark:text-red-400"
        >
          <Icon name="trash" size={18} />
          {t("common.delete")}
        </button>
      </div>

      {txSheet.element}

      <PocketActionSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={loan.name}
        items={[
          {
            label: t("common.delete"),
            icon: "trash",
            tone: "danger",
            // the warning wraps: it has to be read before the second tap
            hint: <span className="whitespace-normal">{t("loans.deleteWarning")}</span>,
            onSelect: () => {
              setConfirming(false);
              deleteLoan.mutateAsync(loan.id).then(
                () => {
                  showSnack(t("pocket.lists.deleted"));
                  closeLoan(router, view);
                },
                () => {
                  // the error toast already says why
                }
              );
            },
          },
        ]}
      />
    </PocketPage>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3 px-4">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}
