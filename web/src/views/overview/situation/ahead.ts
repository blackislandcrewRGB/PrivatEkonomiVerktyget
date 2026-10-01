import type { BalanceSheet } from "../../../api";
import { shortAccountName } from "../../../components/AccountBadge";
import { dm, kr } from "../format";

type Ahead = NonNullable<BalanceSheet["ahead"]>;
type Item = Ahead["items"][number];

export interface AheadTerm {
  key: "in" | "out" | "planned";
  label: string;
  amount: number;
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase("sv") + s.slice(1);
const lower = (s: string) => s.charAt(0).toLocaleLowerCase("sv") + s.slice(1);

/** 'Lön 23/10 + från Mio': the salaries by day, other incomes, and Mio's payments by name. */
function inLabel(items: Item[]): string {
  const salaries = [...new Set(items.filter((i) => i.kind === "income" && /^lön/i.test(i.name)).map((i) => i.date))];
  const parts = [
    ...(salaries.length ? [`lön ${salaries.map(dm).join(", ")}`] : []),
    ...(items.some((i) => i.kind === "income" && !/^lön/i.test(i.name)) ? ["andra inkomster"] : []),
    ...[...new Set(items.filter((i) => i.kind === "partner").map((i) => lower(i.name)))],
  ];
  return capital(parts.join(" + "));
}

/** 'Hyra, fakturor, fasta utgifter': the largest fixed one by name, then what else there is. */
function outLabel(items: Item[]): string {
  const fixed = items.filter((i) => i.kind === "fixed").sort((a, b) => a.amount - b.amount);
  const parts = [
    ...(fixed.length ? [fixed[0].name] : []),
    ...(items.some((i) => i.kind === "invoice") ? ["fakturor"] : []),
    ...(fixed.length > 1 ? ["fasta utgifter"] : []),
    ...[...new Set(items.filter((i) => i.kind === "partner").map((i) => lower(i.name)))],
    ...(items.some((i) => i.kind === "income") ? ["annat"] : []),
  ];
  return capital(parts.join(", "));
}

/**
 * Framåt as an equation: today, what comes in, what goes out and the
 * planned ones (a box of their own), each summed from the list's items, so
 * start + the terms is where the list ends.
 */
export function aheadTerms(ahead: Ahead): AheadTerm[] {
  const planned = ahead.items.filter((i) => i.kind === "planned");
  const into = ahead.items.filter((i) => i.kind !== "planned" && i.amount > 0);
  const out = ahead.items.filter((i) => i.kind !== "planned" && i.amount <= 0);
  const sum = (items: Item[]) => items.reduce((s, i) => s + i.amount, 0);
  const terms: AheadTerm[] = [];
  if (into.length) terms.push({ key: "in", label: inLabel(into), amount: sum(into) });
  if (out.length) terms.push({ key: "out", label: outLabel(out), amount: sum(out) });
  if (planned.length) terms.push({ key: "planned", label: planned.length === 1 ? planned[0].name : "Planerat", amount: sum(planned) });
  return terms;
}

export interface AheadDay {
  date: string;
  items: Item[];
  /** What the day adds or takes. */
  net: number;
  /** Pengar totalt after the day. */
  balance: number;
}

/** The days in order, what comes in first and then the bills, largest first, with the money after each. */
export function aheadDays(ahead: Ahead, start: number): AheadDay[] {
  let running = start;
  return [...new Set(ahead.items.map((i) => i.date))].map((date) => {
    const items = ahead.items.filter((i) => i.date === date).sort((a, b) => Number(b.amount > 0) - Number(a.amount > 0) || Math.abs(b.amount) - Math.abs(a.amount));
    const net = items.reduce((s, i) => s + i.amount, 0);
    running += net;
    return { date, items, net, balance: running };
  });
}

/**
 * The days worth seeing without the list: the one most goes out, the
 * salary, and the one the second most goes out — at most three, by date.
 */
export function keyDays(ahead: Ahead, start: number): AheadDay[] {
  const days = aheadDays(ahead, start);
  const outflows = days.filter((d) => d.net < 0).sort((a, b) => a.net - b.net);
  const salary = days.find((d) => d.items.some((i) => i.kind === "income" && /^lön/i.test(i.name)));
  const picked = [outflows[0], salary, ...outflows.slice(1)].filter((d): d is AheadDay => !!d);
  return [...new Set(picked)]
    .slice(0, 3)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 'Bank Norwegian: faktura' -> 'Norwegian', 'Swedbank Mastercard Guld: nästa faktura' -> 'Mastercard'. */
const shortName = (i: Item) => (i.kind === "invoice" ? shortAccountName(i.name.split(":")[0]) : i.name);

/** 'Från Mio +7 000 · Hyra −7 500 · Norwegian −6 000', the first four and '…' after. */
export function itemsLine(items: Item[]): string {
  const signed = (ore: number) => `${ore > 0 ? "+" : ""}${kr(ore).replace(/\s*kr$/, "")}`;
  const line = items.slice(0, 4).map((i) => `${shortName(i)} ${signed(i.amount)}`).join(" · ");
  return items.length > 4 ? `${line} · …` : line;
}
