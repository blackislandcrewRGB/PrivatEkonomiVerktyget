import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, transactions } from "../db/schema.js";
import { loadSplits, partsOf } from "../splits.js";
import { addMonths, monthOf } from "./dates.js";

/**
 * API-kostnader, on Översikten: what has been spent on AI APIs, per provider,
 * month by month over the last year. What counts is the category API (and its
 * subcategories): the user decides by categorising, so a subscription such as
 * Claude.ai or ChatGPT stays out unless it is put there. The provider is read
 * from the merchant; anything unknown goes by its own name.
 *
 * By the purchase day, the whole amount (it is the user's own), fixed charges
 * included; a refund takes off.
 */

export const API_COST_MONTHS = 12;

/** The providers known by name, in the order they are tried. */
const PROVIDERS: [RegExp, string][] = [
  [/ANTHROPIC|CLAUDE/i, "Anthropic"],
  [/OPENROUTER/i, "OpenRouter"],
  [/OPENAI|CHATGPT/i, "OpenAI"],
  [/GOOGLE|GEMINI/i, "Google"],
  [/MISTRAL/i, "Mistral"],
  [/DEEPSEE/i, "DeepSeek"],
  [/\bX\.?AI\b|GROK/i, "xAI"],
  [/PERPLEXITY/i, "Perplexity"],
  [/GROQ/i, "Groq"],
  [/REPLICATE/i, "Replicate"],
  [/ELEVEN ?LABS/i, "ElevenLabs"],
  [/COHERE/i, "Cohere"],
  [/TOGETHER/i, "Together AI"],
  [/FIREWORKS/i, "Fireworks"],
];

/** The provider of a charge: a known one, else the merchant's name without the card processor's tail. */
export function apiProvider(text: string): string {
  for (const [re, name] of PROVIDERS) if (re.test(text)) return name;
  const name = text.split(/[*,]/)[0].trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : "Okänt";
}

export interface ApiCosts {
  /** Null when there is no category called API. */
  categoryId: number | null;
  month: string;
  /** The last 12 months, oldest first, ending with this one (so far). */
  months: { month: string; total: number; byProvider: Record<string, number> }[];
  /** Largest over the 12 months first. */
  providers: { name: string; thisMonth: number; year: number }[];
  thisMonth: number;
  year: number;
  /** The 11 whole months before this one, per month. */
  averagePerMonth: number;
}

export function apiCosts(db: Db, today: string): ApiCosts {
  const month = monthOf(today);
  const first = addMonths(month, -(API_COST_MONTHS - 1));
  const monthList = Array.from({ length: API_COST_MONTHS }, (_, i) => addMonths(first, i));
  const empty: ApiCosts = {
    categoryId: null,
    month,
    months: monthList.map((m) => ({ month: m, total: 0, byProvider: {} })),
    providers: [],
    thisMonth: 0,
    year: 0,
    averagePerMonth: 0,
  };

  const all = db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).all();
  const api = all.find((c) => c.name.trim().toLowerCase() === "api");
  if (!api) return empty;
  const ids = new Set([api.id, ...all.filter((c) => c.parentId === api.id).map((c) => c.id)]);

  const day = sql<string>`coalesce(${transactions.transactionDate}, ${transactions.bookingDate})`;
  const rows = db
    .select({
      id: transactions.id,
      day,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      label: transactions.label,
      counterparty: transactions.counterparty,
      descriptionClean: transactions.descriptionClean,
    })
    .from(transactions)
    .where(and(gte(day, `${first}-01`), lte(day, today), isNull(transactions.deletedAt), eq(transactions.isTransfer, false)))
    .all();
  const splits = loadSplits(db);

  const byMonth = new Map(monthList.map((m) => [m, new Map<string, number>()]));
  for (const r of rows) {
    const ore = -partsOf(r, splits).reduce((s, p) => (p.categoryId !== null && ids.has(p.categoryId) ? s + p.amount : s), 0);
    if (!ore) continue;
    const provider = apiProvider(`${r.descriptionClean} ${r.counterparty ?? ""} ${r.label ?? ""}`);
    const m = byMonth.get(monthOf(r.day));
    if (m) m.set(provider, (m.get(provider) ?? 0) + ore);
  }

  const months = monthList.map((m) => {
    const byProvider = Object.fromEntries([...byMonth.get(m)!].filter(([, v]) => v !== 0));
    return { month: m, total: Object.values(byProvider).reduce((s, v) => s + v, 0), byProvider };
  });
  const names = new Set(months.flatMap((m) => Object.keys(m.byProvider)));
  const providers = [...names]
    .map((name) => ({
      name,
      thisMonth: months.at(-1)!.byProvider[name] ?? 0,
      year: months.reduce((s, m) => s + (m.byProvider[name] ?? 0), 0),
    }))
    .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
  const year = months.reduce((s, m) => s + m.total, 0);
  const before = months.slice(0, -1);
  return {
    categoryId: api.id,
    month,
    months,
    providers,
    thisMonth: months.at(-1)!.total,
    year,
    averagePerMonth: Math.round(before.reduce((s, m) => s + m.total, 0) / before.length),
  };
}
