import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BudgetSim — multi-currency budget",
    short_name: "BudgetSim",
    description:
      "Personal budget for TRY, USD, EUR, BTC and gold with live rates, VICTVS sessions, loans and projections.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#0d9488",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
