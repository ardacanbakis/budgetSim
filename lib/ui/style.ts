/**
 * Interface styles.
 *
 * "Classic" is the layout and styling the app shipped with — frozen, so it
 * keeps looking exactly as it does today no matter what happens to the rest.
 * Everything else runs on the version-2 engine: a different shell (page title
 * in the header, quick jump), a different dashboard, and component shapes
 * built for reading numbers rather than for looking soft.
 *
 * The four v2 entries are skins over that one engine, not four separate apps.
 * A skin owns *form* — corner radius, rules versus boxes, density, type scale,
 * numerals, accent ramp — while the theme (light/dark/slate/ocean/…) keeps
 * owning *colour of the ground*. That split is what lets Terminal-on-Ocean and
 * Calm-on-Light both look deliberate, and it's why a skin is a stylesheet
 * rather than a fork of every page.
 */
export type UiStyle = "classic" | "terminal" | "calm" | "editorial" | "contrast";

export type UiVersion = "v1" | "v2";

export interface UiStyleMeta {
  id: UiStyle;
  version: UiVersion;
  /** i18n key under `style.` for the human name */
  key: string;
  /** swatch drawn in the Settings picker: ground, accent, corner radius in px */
  preview: { bg: string; surface: string; accent: string; radius: number };
}

export const UI_STYLES: UiStyleMeta[] = [
  {
    id: "classic",
    version: "v1",
    key: "classic",
    preview: { bg: "#fafafa", surface: "#ffffff", accent: "#0d9488", radius: 8 },
  },
  {
    id: "terminal",
    version: "v2",
    key: "terminal",
    preview: { bg: "#f7f7f8", surface: "#ffffff", accent: "#4f46e5", radius: 3 },
  },
  {
    id: "calm",
    version: "v2",
    key: "calm",
    preview: { bg: "#f6f5f2", surface: "#ffffff", accent: "#0f9d76", radius: 14 },
  },
  {
    id: "editorial",
    version: "v2",
    key: "editorial",
    preview: { bg: "#fbf7f2", surface: "#ffffff", accent: "#ea580c", radius: 6 },
  },
  {
    id: "contrast",
    version: "v2",
    key: "contrast",
    preview: { bg: "#ffffff", surface: "#ffffff", accent: "#0a0a0a", radius: 2 },
  },
];

export const DEFAULT_UI_STYLE: UiStyle = "classic";

export const UI_STYLE_KEY = "renovator-ui-style";

export function isUiStyle(value: string): value is UiStyle {
  return UI_STYLES.some((s) => s.id === value);
}

export function versionOf(style: UiStyle): UiVersion {
  return UI_STYLES.find((s) => s.id === style)?.version ?? "v1";
}

/**
 * Both attributes go on <html>: `data-ui` gates structure (which shell, which
 * dashboard, whether tables get sticky heads), `data-skin` gates the token
 * overrides. Classic sets neither, so every selector written for v2 misses it
 * and v1 stays untouched by construction.
 */
export function applyUiStyle(style: UiStyle): void {
  const root = document.documentElement;
  const version = versionOf(style);
  if (version === "v2") {
    root.dataset.ui = "v2";
    root.dataset.skin = style;
  } else {
    delete root.dataset.ui;
    delete root.dataset.skin;
  }
}
