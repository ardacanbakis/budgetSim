"use client";

import { redirect, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { RECURRING_HREF } from "@/lib/ui/recurringUrl";
import { timelineHref } from "@/lib/ui/timeline";
import { parseTab } from "@/lib/ui/urlTab";
import { ActivityLink, PocketActivity } from "./activity";
import { Icon } from "./icons";
import { PocketPage, Segmented } from "./kit";
import { PocketRecurring } from "./recurring";

/**
 * /transactions in Pocket: one large title over a segmented control,
 * Transactions | Income | Bills, with the open tab kept in the URL
 * (?tab=income, ?tab=bills) as the Classic page keeps it, so a link lands on
 * the right one; the old Recurring tab (?tab=recurring) lands on Income. The
 * Timeline is Reports' first report now (/reports?tab=timeline); its old
 * address lands there.
 *
 * The ledger tab is PocketActivity (components/pocket/activity.tsx), keyed by
 * its deep link (?show=due, ?filter=, ?account=, ?q=) so following a new link
 * starts from that link's filters. Income and Bills are PocketRecurring
 * (components/pocket/recurring.tsx); their + sits in the header.
 * On the ledger tab the header holds Select, which turns the ledger's
 * selection mode on and off (the bulk actions are PocketActivity's).
 */

const TABS = ["ledger", "income", "bills"] as const;
type Tab = (typeof TABS)[number];

export function PocketTransactions() {
  // useSearchParams needs a Suspense boundary on a prerendered page
  return (
    <Suspense fallback={<Spinner />}>
      <TransactionsScreen />
    </Suspense>
  );
}

function TransactionsScreen() {
  const { t } = useI18n();
  const params = useSearchParams();
  if (params.get("tab") === "timeline") redirect(timelineHref(params.get("account")));
  if (params.get("tab") === "recurring") redirect(RECURRING_HREF.income);
  const tab: Tab = parseTab(params.get("tab"), TABS, "ledger");
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  // selection belongs to the ledger tab: another tab ends it
  if (tab !== "ledger" && selecting) setSelecting(false);

  const action = useMemo(
    () =>
      tab === "ledger" ? (
        <button
          type="button"
          onClick={() => setSelecting((on) => !on)}
          aria-label={t("pocket.activity.select")}
          aria-pressed={selecting}
          className={`flex h-11 w-11 items-center justify-center rounded-full active:bg-[var(--edge-soft)] ${
            selecting ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" : "text-teal-600 dark:text-teal-400"
          }`}
        >
          <Icon name="checkCircle" size={22} />
        </button>
      ) : tab === "income" || tab === "bills" ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={tab === "income" ? t("income.newIncome") : t("income.newBill")}
          aria-haspopup="dialog"
          className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
        >
          <Icon name="plus" size={22} />
        </button>
      ) : undefined,
    [tab, t, selecting]
  );

  const link: ActivityLink = {
    show: params.get("show"),
    filter: params.get("filter"),
    account: params.get("account"),
    q: params.get("q"),
  };

  return (
    <PocketPage title={t("tx.title")} action={action}>
      <Segmented<Tab>
        label={t("tx.title")}
        value={tab}
        options={[
          { value: "ledger", label: t("tx.tabLedger") },
          { value: "income", label: t("income.tabIncome") },
          { value: "bills", label: t("income.tabBills") },
        ]}
        onChange={(next) => replaceQuery(next === "ledger" ? "/transactions" : `/transactions?tab=${next}`)}
      />
      {tab === "income" || tab === "bills" ? (
        <PocketRecurring key={tab} kind={tab} creating={creating} onCreatingChange={setCreating} />
      ) : (
        <PocketActivity
          key={[link.show, link.filter, link.account, link.q].join("|")}
          link={link}
          selecting={selecting}
          onEndSelection={() => setSelecting(false)}
        />
      )}
    </PocketPage>
  );
}
