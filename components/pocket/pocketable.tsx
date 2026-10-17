"use client";

import { ComponentType } from "react";
import { usePocket } from "@/lib/ui/usePocket";

/**
 * A route with a Pocket view: renders the Pocket component on a phone with
 * the setting on, and the page exactly as before everywhere else. Two
 * different component types are swapped rather than one page branching
 * inside, so neither one's hooks ever run for the other, and rotating across
 * the breakpoint or flipping the setting can't break hook order.
 */
export function pocketable<P extends object>(Classic: ComponentType<P>, Pocket: ComponentType<P>): ComponentType<P> {
  function Route(props: P) {
    return usePocket() ? <Pocket {...props} /> : <Classic {...props} />;
  }
  Route.displayName = `Pocketable(${Classic.displayName ?? Classic.name ?? "Page"})`;
  return Route;
}
