/**
 * Phone layout: a second way to lay the app out on a phone, opt-in.
 *
 * Interface styles (lib/ui/style.ts) restyle the app everywhere; this one
 * changes what a phone shows and how you move around it — the navigation,
 * the home screen, how entries are added and how lists read on a 390px
 * screen. "Different views for different devices" falls out of two facts:
 * the choice is stored on the device, like the interface style, and it only
 * takes effect below the md breakpoint, so a tablet or desktop with it
 * switched on keeps looking exactly as it did.
 *
 * Off ("standard") sets nothing on <html>, so no rule written for Pocket can
 * reach the default design.
 */

export const PHONE_LAYOUTS = ["standard", "pocket"] as const;
export type PhoneLayout = (typeof PHONE_LAYOUTS)[number];
export const DEFAULT_PHONE_LAYOUT: PhoneLayout = "standard";

export const PHONE_LAYOUT_KEY = "renovator-phone-layout";

/** Tailwind's md breakpoint is 48rem; Pocket applies strictly below it. */
export const PHONE_QUERY = "(max-width: 767.98px)";

export function isPhoneLayout(value: string): value is PhoneLayout {
  return (PHONE_LAYOUTS as readonly string[]).includes(value);
}

/**
 * The attribute goes on <html> whatever the width: the CSS for Pocket sits
 * inside a phone-width media query, so the attribute alone changes nothing on
 * a wide screen, and resizing a window across the breakpoint needs no script.
 */
export function applyPhoneLayout(layout: PhoneLayout): void {
  if (layout === "pocket") document.documentElement.dataset.phone = "pocket";
  else delete document.documentElement.dataset.phone;
}
