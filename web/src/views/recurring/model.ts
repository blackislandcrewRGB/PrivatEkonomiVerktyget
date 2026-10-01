import type { Account, BankDayRule, RecurringExpense } from "../../api";
import type { Share } from "../../lib/share";
import { walletColour } from "../overview/wallet";

/** This month's cost: yearly charges spread over 12 months, monthly ones with this month's own amount if set. */
export const monthly = (e: RecurringExpense) => (e.paused ? 0 : e.billingCycle === "yearly" ? Math.round(e.amount / 12) : e.thisMonthAmount);

/** An amount as 'Min del' shows it: a shared expense at half (Mio pays the other half). */
export const partOf = (e: Pick<RecurringExpense, "shared">, amount: number, share: Share) => (share === "mine" && e.shared ? Math.round(amount / 2) : amount);

/**
 * A group's colour in Fasta utgifter: the account's Wallet colour (the same
 * as Saldon's cards), Årsvis grey.
 */
export function groupColour(g: Pick<ExpenseGroup, "key" | "name" | "kind">): string {
  if (g.key === YEARLY_GROUP) return "bg-ink-3";
  if (g.kind === null) return "bg-neutral-bar";
  return walletColour({ name: g.name, kind: g.kind });
}

/** The account's Wallet colour as a CSS colour (the calendar's chips and legend): the same as its group's. */
export function accountTone(accounts: Account[], id: number | null): string {
  const a = accounts.find((x) => x.id === id);
  if (!a) return "var(--v2-neutral-bar)";
  return `var(--v2-${walletColour(a).replace(/^bg-/, "")})`;
}

/** A soft background in the account's colour that works in both themes. */
export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const RULE_SIGN: Record<BankDayRule, string> = { none: "", next: " →", previous: " ←" };
export const RULE_LABEL: Record<BankDayRule, string> = { none: "exakt dag", next: "nästa bankdag", previous: "föregående bankdag" };

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** '25 ←', 'sista ←', '4' – the schedule in a table cell (the full text is its tooltip); a yearly one '30 jun'. */
export function dayText(e: RecurringExpense): string {
  if (e.billingCycle === "yearly") {
    if (!e.anchorMonth) return "årsvis";
    const day = e.scheduleType === "last_day" ? "sista" : e.anchorDay === null ? "" : `${e.anchorDay} `;
    return `${day}${MONTH_SHORT[e.anchorMonth - 1]}`;
  }
  const day = e.scheduleType === "last_day" ? "sista" : e.anchorDay === null ? "–" : String(e.anchorDay);
  return `${day}${RULE_SIGN[e.bankDayRule]}`;
}

/** Sort key within a group: the day of the month (last day as 31), then the name. */
export function byDay(a: RecurringExpense, b: RecurringExpense): number {
  const d = (e: RecurringExpense) => (e.scheduleType === "last_day" ? 31.5 : (e.anchorDay ?? 99));
  return d(a) - d(b) || a.name.localeCompare(b.name, "sv");
}

export interface ExpenseGroup {
  key: string;
  accountId: number | null;
  name: string;
  kind: Account["kind"] | null;
  items: RecurringExpense[];
}

/** The key of the group with the yearly expenses. */
export const YEARLY_GROUP = "yearly";

/**
 * Monthly expenses per account (in account order, 'Utan konto' last), each
 * group by day; the yearly ones last in their own group 'Årsvis', by their
 * next date (a 3 200 kr vehicle tax would hide the monthly costs in an account's group).
 */
export function groupByAccount(expenses: RecurringExpense[], accounts: Account[]): ExpenseGroup[] {
  const groups: ExpenseGroup[] = accounts.map((a) => ({ key: String(a.id), accountId: a.id, name: a.name, kind: a.kind, items: [] }));
  const none: ExpenseGroup = { key: "none", accountId: null, name: "Utan konto", kind: null, items: [] };
  const yearly: ExpenseGroup = { key: YEARLY_GROUP, accountId: null, name: "Årsvis", kind: null, items: [] };
  for (const e of expenses) {
    if (e.billingCycle === "yearly") yearly.items.push(e);
    else (groups.find((g) => g.accountId === e.accountId) ?? none).items.push(e);
  }
  const byNext = (a: RecurringExpense, b: RecurringExpense) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.name.localeCompare(b.name, "sv");
  return [
    ...[...groups, none].filter((g) => g.items.length > 0).map((g) => ({ ...g, items: [...g.items].sort(byDay) })),
    ...(yearly.items.length ? [{ ...yearly, items: [...yearly.items].sort(byNext) }] : []),
  ];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export { todayIso } from "../../lib/today";
export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
}
