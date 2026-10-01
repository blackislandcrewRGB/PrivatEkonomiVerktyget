import { fromLegacy, serializeFilters, type Filters, type LegacyPreset } from "../views/transactions/filters";
import { navigate } from "./routes";

/**
 * Opens the transaction list with these filters (the rest reset). Takes the
 * new filter shape or the older preset shape Översikt and Analys use.
 */
export function openTransactions(filters: LegacyPreset | Filters, tab: "list" | "review" = "list") {
  if (tab === "review") return navigate("transactions", { sub: "granska" });
  const f = "categories" in filters ? filters : fromLegacy(filters);
  navigate("transactions", { search: serializeFilters(f) || "?" });
}
