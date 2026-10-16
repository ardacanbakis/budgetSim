"use client";

import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { AddRequest } from "./chrome";

/**
 * What the + opens. This first version hands off to the existing forms, which
 * open as Pocket sheets through Modal; the keypad-first sheet replaces it
 * behind the same props.
 */
export function AddSheet({ request, onClose }: { request: AddRequest | null; onClose: () => void }) {
  return (
    <>
      <TransactionModal open={request != null && request.mode !== "transfer"} onClose={onClose} />
      <TransferModal open={request?.mode === "transfer"} onClose={onClose} />
    </>
  );
}
