"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import { ActivityLink, PocketActivity } from "./activity";
import { Icon } from "./icons";
import { PocketPage, Segmented } from "./kit";
import { PocketRecurring } from "./recurring";

/**
 * /transactions in Pocket: one large title over a segmented control,
 * Transactions | Recurring, with the open tab kept in the URL (?tab=recurring)
 * as the Classic page keeps it, so /recurring's redirect and the back button
 * land on the right one.
 *
 * The ledger tab is PocketActivity (components/pocket/activity.tsx), keyed by
 * its deep link (?show=due, ?filter=, ?account=, ?q=) so following a new link
 * starts from that link's filters. The recurring tab is PocketRecurring
 * (components/pocket/recurring.tsx); its + sits in the header.
 */

type Tab = "ledger" | "recurring";

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
  const tab: Tab = params.get("tab") === "recurring" ? "recurring" : "ledger";
  const [creating, setCreating] = useState(false);

  const action = useMemo(
    () =>
      tab === "recurring" ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={t("recurring.newTemplate")}
          aria-haspopup="dialog"
          className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
        >
          <Icon name="plus" size={22} />
        </button>
      ) : undefined,
    [tab, t]
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
          { value: "recurring", label: t("recurring.title") },
        ]}
        onChange={(next) => replaceQuery(next === "ledger" ? "/transactions" : "/transactions?tab=recurring")}
      />
      {tab === "recurring" ? (
        <PocketRecurring creating={creating} onCreatingChange={setCreating} />
      ) : (
        <PocketActivity key={[link.show, link.filter, link.account, link.q].join("|")} link={link} />
      )}
    </PocketPage>
  );
}
