/**
 * Strings for the Plan page's card frame (components/plannerCard.tsx), under
 * planCards.* — English and Turkish side by side, so a key can't exist in one
 * and not the other.
 */
export const en = {
  // a card whose content is taller than its size
  showAll: "Show all",
  showLess: "Show less",
  showAllOf: "Show all of {title}",
  showLessOf: "Show less of {title}",
};

export const tr: typeof en = {
  showAll: "Tümünü göster",
  showLess: "Daha az göster",
  showAllOf: "{title}: tümünü göster",
  showLessOf: "{title}: daha az göster",
};
