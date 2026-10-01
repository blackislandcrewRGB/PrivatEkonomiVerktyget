/** GET /api/analysis/food, in öre. */
export interface FoodMonth {
  month: string;
  groceries: number;
  restaurants: number;
  takeaway: number;
  /** Restaurants, cafés and takeaway of all the food; null without food. */
  outShare: number | null;
}

export interface FoodData {
  months: FoodMonth[];
  total: Omit<FoodMonth, "month">;
}

export type FoodKind = "groceries" | "restaurants" | "takeaway";

/** The three in order, with their names and colours (tokens, so dark mode has its own). */
export const FOOD_KINDS: { key: FoodKind; name: string; colour: string; dot: string }[] = [
  { key: "groceries", name: "Livsmedel", colour: "var(--color-food-groceries)", dot: "bg-food-groceries" },
  { key: "restaurants", name: "Restaurang & café", colour: "var(--color-food-restaurants)", dot: "bg-food-restaurants" },
  { key: "takeaway", name: "Hämtmat", colour: "var(--color-food-takeaway)", dot: "bg-food-takeaway" },
];

export const foodTotal = (m: Pick<FoodMonth, FoodKind>) => m.groceries + m.restaurants + m.takeaway;

/** The average per month over the whole months (the month so far left out, as Snitt); null without one. */
export function perWholeMonth(months: FoodMonth[], wholeMonthList: string[], value: (m: FoodMonth) => number): number | null {
  const whole = months.filter((m) => wholeMonthList.includes(m.month));
  return whole.length ? whole.reduce((s, m) => s + value(m), 0) / whole.length : null;
}
