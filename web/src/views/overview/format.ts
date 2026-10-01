import { formatKr } from "../../lib/format";

/** Whole kronor: '2 057 kr', '−13 150 kr'. */
export const kr = (ore: number) => formatKr(Math.round(ore / 100) * 100, { whole: true });

/** '2026-09-24' -> '24/9'. */
export const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

const WEEKDAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
const MONTHS = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

export function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export const isWeekend = (iso: string) => ["lör", "sön"].includes(weekday(iso));

export const monthShort = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];

/** 'YYYY-MM-DD' + n days. */
export function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
