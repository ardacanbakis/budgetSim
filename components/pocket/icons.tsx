/**
 * Pocket's icons: 24×24 line drawings in the current colour, so a tab or a
 * button tints them through its text colour. Always decorative (aria-hidden):
 * the control around an icon carries the accessible name.
 */

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  activity: "M4 6h16M4 12h16M4 18h10",
  plus: "M12 5v14M5 12h14",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  check: "m5 12 5 5 9-10",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-4-9 3 3 5-6",
  repeat: "M17 2l3 3-3 3M20 5H9a5 5 0 0 0-5 5M7 22l-3-3 3-3M4 19h11a5 5 0 0 0 5-5",
  bank: "M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  savings: "M12 3v18M17 7.5c0-1.9-2.2-3.5-5-3.5S7 5.6 7 7.5 9.2 11 12 11.5s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  back: "M15 18l-6-6 6-6",
  chevron: "M9 18l6-6-6-6",
  close: "M18 6 6 18M6 6l12 12",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  transfer: "M7 7h13l-4-4M17 17H4l4 4",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  adjust: "M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4",
  gold: "M5 19 8 9h8l3 10zM10 9V5h4v4",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  copy: "M8 8h12v12H8zM4 16V4h12",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The icon for a nav destination; the sidebar keeps its own glyphs. */
export function navIcon(href: string): IconName {
  switch (href) {
    case "/":
      return "home";
    case "/accounts":
      return "wallet";
    case "/transactions":
      return "activity";
    case "/cards":
      return "card";
    case "/victvs":
      return "checkCircle";
    case "/loans":
      return "bank";
    case "/reports":
      return "chart";
    case "/planner":
      return "grid";
    case "/savings":
      return "savings";
    case "/settings":
      return "settings";
    default:
      return "more";
  }
}
