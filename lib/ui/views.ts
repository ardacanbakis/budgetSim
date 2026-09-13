/**
 * How each screen is laid out.
 *
 * Two independent axes, both device-local, because how you want a list shaped
 * depends on the screen you are sitting at rather than on the account:
 *
 *   density — how tight every row and card is, everywhere at once
 *   shape   — what a particular list *is* (rows, a grid of cards, a table)
 *
 * Density works by scaling the same --ui-* tokens the interface styles already
 * use, so it composes with them instead of fighting them: Terminal at
 * "spacious" is still recognisably Terminal, just roomier. That is why this is
 * a multiplier rather than a second set of hardcoded paddings.
 */

export const DENSITIES = ["spacious", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const DEFAULT_DENSITY: Density = "comfortable";

export function isDensity(v: string): v is Density {
  return (DENSITIES as readonly string[]).includes(v);
}

/** Every list-shaped screen that offers a choice of shape. */
export const SURFACES = ["accounts", "transactions", "cards", "recurring", "loans"] as const;
export type SurfaceId = (typeof SURFACES)[number];

export const SHAPES = ["rows", "grid", "table"] as const;
export type Shape = (typeof SHAPES)[number];

export interface SurfaceSpec {
  id: SurfaceId;
  /** the shapes this screen can actually take, first one being its default */
  shapes: Shape[];
  /** whether a column count means anything here */
  columns: boolean;
}

/**
 * A screen only offers shapes that suit its data. A transaction ledger has no
 * sensible grid form — twelve fields per row do not become clearer in a
 * card — so it is not offered one, rather than offered one that disappoints.
 */
export const SURFACE_SPECS: Record<SurfaceId, SurfaceSpec> = {
  accounts: { id: "accounts", shapes: ["rows", "grid", "table"], columns: true },
  transactions: { id: "transactions", shapes: ["rows", "table"], columns: false },
  cards: { id: "cards", shapes: ["rows", "grid", "table"], columns: true },
  recurring: { id: "recurring", shapes: ["grid", "table"], columns: true },
  loans: { id: "loans", shapes: ["rows", "grid"], columns: true },
};

export function defaultShape(id: SurfaceId): Shape {
  return SURFACE_SPECS[id].shapes[0];
}

export function isShapeFor(id: SurfaceId, v: string): v is Shape {
  return (SURFACE_SPECS[id].shapes as readonly string[]).includes(v);
}

export const DENSITY_KEY = "renovator-density";
export const shapeKey = (id: SurfaceId) => `renovator-shape-${id}`;
export const columnsKey = (id: SurfaceId) => `renovator-cols-${id}`;

/**
 * Density is applied as an attribute on <html> so it reaches everything at
 * once, including content rendered into portals.
 */
export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}
