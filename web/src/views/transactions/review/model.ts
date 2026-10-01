import type { IconRef, ReviewGroup } from "../../../api";
import { todayIso } from "../../../lib/today";

/**
 * One card in Att granska: a merchant (for Swish: a number) with its
 * uncategorised rows, one section per direction when the same number has
 * money both in and out.
 */
export interface ReviewCardData {
  key: string;
  merchant: string;
  name: string;
  isSwish: boolean;
  icon?: IconRef;
  /** Out first; two only for a Swish number with rows both ways. */
  sections: ReviewGroup[];
  count: number;
}

/** What a choice applies to in a card with two sections. */
export type Scope = "out" | "in" | "both";

/** Groups -> cards, most rows first. The same Swish number both ways is one card. */
export function toCards(groups: ReviewGroup[]): ReviewCardData[] {
  const cards = new Map<string, ReviewCardData>();
  for (const g of groups) {
    const twinnable = g.isSwish && groups.some((o) => o !== g && o.merchant === g.merchant && o.direction !== g.direction);
    const key = twinnable ? `swish|${g.merchant}` : g.key;
    const card = cards.get(key) ?? { key, merchant: g.merchant, name: g.name ?? g.merchant, isSwish: g.isSwish, icon: g.icon, sections: [], count: 0 };
    card.sections.push(g);
    card.sections.sort((a, b) => (a.direction === "out" ? -1 : 1) - (b.direction === "out" ? -1 : 1));
    card.count += g.count;
    cards.set(key, card);
  }
  return [...cards.values()].sort((a, b) => b.count - a.count || Math.abs(sum(b)) - Math.abs(sum(a)));
}

const sum = (c: ReviewCardData) => c.sections.reduce((s, g) => s + g.sum, 0);

/** The section a two-way card starts on: the one with more rows. */
export function defaultScope(c: ReviewCardData): Scope {
  if (c.sections.length === 1) return c.sections[0].direction;
  return [...c.sections].sort((a, b) => b.count - a.count)[0].direction;
}

/** The groups a choice applies to. */
export function sectionsFor(c: ReviewCardData, scope: Scope) {
  return scope === "both" || c.sections.length === 1 ? c.sections : c.sections.filter((g) => g.direction === scope);
}

/** Key of the quick picks for a card and scope (the server computes them per set of rows). */
export function picksKey(c: ReviewCardData, scope: Scope): string {
  const s = sectionsFor(c, scope);
  return s.length === 1 ? s[0].key : `both|${c.merchant}`;
}

// 'N gjorda i dag': cards finished today, per browser.
const DONE_KEY = "privatekonomi.reviewDone";
const today = todayIso;

export function doneToday(): number {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}");
    return v.date === today() ? Number(v.count) || 0 : 0;
  } catch {
    return 0;
  }
}

export function addDoneToday(n = 1): number {
  const count = doneToday() + n;
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify({ date: today(), count }));
  } catch {
    // Not remembered; fine.
  }
  return count;
}
