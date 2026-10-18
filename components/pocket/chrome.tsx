"use client";

import { createContext, ReactNode, useContext, useEffect } from "react";
import { Transaction } from "@/lib/data/types";

/**
 * How a Pocket screen talks to the shell around it: what the header shows,
 * and opening the add sheet. Screens never import each other or the shell;
 * this context is the whole contract.
 */

export interface HeaderBack {
  label: string;
  onBack: () => void;
}

export interface HeaderState {
  /** shown small in the header once the page's own large title scrolls away */
  title?: string;
  /** what the condensed header says instead of the title (Home: the lead figure) */
  condensed?: string;
  back?: HeaderBack | null;
  /** one 44×44 control at the right of the header */
  action?: ReactNode;
}

export type AddMode = "expense" | "income" | "transfer";

export interface AddRequest {
  mode: AddMode;
  /** start on this account (an account page's own +) */
  accountId?: string;
  /** open an existing entry for editing instead of adding one */
  edit?: Transaction;
  /** start from a copy of this entry, dated today */
  duplicateOf?: Transaction;
}

export interface PocketChrome {
  setHeader: (header: HeaderState) => void;
  /** the add sheet, in a mode; with no request, Expense */
  openAdd: (request?: AddRequest) => void;
  /** the menu of every kind of entry (card payment, adjustment, …) */
  openAddMenu: () => void;
}

export const PocketChromeContext = createContext<PocketChrome | null>(null);

export function usePocketChrome(): PocketChrome {
  const chrome = useContext(PocketChromeContext);
  if (!chrome) throw new Error("usePocketChrome outside PocketShell");
  return chrome;
}

/** Register the header for as long as the calling screen is mounted. */
export function usePocketHeader(header: HeaderState): void {
  const { setHeader } = usePocketChrome();
  const { title, condensed, back, action } = header;
  useEffect(() => {
    setHeader({ title, condensed, back, action });
  }, [setHeader, title, condensed, back, action]);
  useEffect(() => () => setHeader({}), [setHeader]);
}
