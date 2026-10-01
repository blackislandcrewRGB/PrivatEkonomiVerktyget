import type { CashEvent, Cashflow } from "../../../api";
import { dm } from "../format";

type Day = Cashflow["days"][number];

/** A fall of more than this in one day (öre) is marked on the curve. */
export const BIG_DROP = 500000;
/** At most this many falls are marked: the largest. */
export const MAX_DROPS = 4;

/** The days a salary comes in. */
export const paydays = (days: Day[]): string[] => days.filter((d) => d.events.some((e) => e.kind === "income" && /^lön/i.test(e.name))).map((d) => d.date);

const COUNT = ["", "en", "två", "tre", "fyra", "fem"];

/** 'Hyra' -> 'hyra'; 'CSN' and 'Exempel Gym' stay. */
const lower = (name: string) => (/^\p{Lu}\p{Ll}+$/u.test(name) ? name.toLocaleLowerCase("sv") : name);

/**
 * What a day's fall is, short: the fixed and planned ones by name (the
 * largest two), the card invoices counted — 'hyra + två fakturor'.
 */
export function dropText(events: CashEvent[]): string {
  const out = events.filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount);
  const invoices = out.filter((e) => e.kind === "invoice").length;
  const named = out.filter((e) => e.kind !== "invoice");
  const parts = named.slice(0, 2).map((e) => lower(e.name));
  if (named.length > 2) parts.push(`${named.length - 2} till`);
  if (invoices) parts.push(invoices === 1 ? (parts.length ? "faktura" : "kortfaktura") : `${COUNT[invoices] ?? invoices} fakturor`);
  return parts.join(" + ");
}

export interface Drop {
  date: string;
  balance: number;
  fall: number;
  /** 'invoice': the largest item is a card invoice (red ring), else black. */
  tone: "invoice" | "other";
  label: string;
}

/**
 * The days the balance falls more than 5 000 kr from the day before (today
 * and the lowest day have marks of their own), the largest four, by date.
 */
export function bigDrops(days: Day[], skip: string[] = []): Drop[] {
  const drops: Drop[] = [];
  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const fall = days[i - 1].balance - d.balance;
    if (fall <= BIG_DROP || skip.includes(d.date)) continue;
    const largest = d.events.filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    const text = dropText(d.events);
    drops.push({ date: d.date, balance: d.balance, fall, tone: largest?.kind === "invoice" ? "invoice" : "other", label: text ? `${dm(d.date)} ${text}` : dm(d.date) });
  }
  return drops
    .sort((a, b) => b.fall - a.fall)
    .slice(0, MAX_DROPS)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Y ticks in steps of 5k, 10k, 20k, 25k, 50k… kr: four or five of them from 0 (or below it) up past the highest. */
export function yTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(max, lo + 100000);
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map((k) => k * 100000);
  const step = steps.find((s) => (Math.ceil(hi / s) - Math.floor(lo / s)) <= 4) ?? steps.at(-1)!;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step; v += step) ticks.push(v);
  return ticks;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a label box goes beside a point so that it doesn't cover the curve:
 * the first of the preferred places (above left, above right, below left,
 * below right, then further up on either side) that stays in the plot and
 * has no point of the curve in it, else the one covering the fewest
 * (`covered` says how many). Near the left edge the right side comes first
 * (mirrored).
 */
export function placeBox(
  at: { x: number; y: number },
  size: { width: number; height: number },
  plot: Box,
  curve: { x: number; y: number }[],
  gap = 12,
  /** How far up it may be lifted (0: only right beside the point). */
  maxLift = Infinity,
): Box & { side: "left" | "right"; above: boolean; covered: number } {
  const left = at.x - gap - size.width;
  const right = at.x + gap;
  const mirrored = left < plot.x;
  const [first, second]: ("left" | "right")[] = mirrored ? ["right", "left"] : ["left", "right"];
  const place = (side: "left" | "right", up: boolean, lift = 0) => ({
    side,
    above: up,
    x: side === "left" ? left : right,
    y: up ? at.y - gap - size.height - lift : at.y + gap,
    ...size,
  });
  const candidates = [place(first, true), place(second, true), place(first, false), place(second, false)];
  for (let lift = 16; lift <= maxLift && at.y - gap - size.height - lift >= plot.y; lift += 16) candidates.push(place(first, true, lift), place(second, true, lift));
  const inside = (b: Box) => b.x >= plot.x && b.x + b.width <= plot.x + plot.width && b.y >= plot.y && b.y + b.height <= plot.y + plot.height;
  // The curve's points in a box, and the lines between them crossing it (sampled).
  const covered = (b: Box) => {
    let n = 0;
    for (let i = 0; i < curve.length; i++) {
      const p = curve[i];
      const q = curve[i + 1] ?? p;
      for (let t = 0; t < 1; t += 0.25) {
        const x = p.x + (q.x - p.x) * t;
        const y = p.y + (q.y - p.y) * t;
        if (x >= b.x - 2 && x <= b.x + b.width + 2 && y >= b.y - 2 && y <= b.y + b.height + 2) n++;
      }
    }
    return n;
  };
  const fits = candidates.filter(inside);
  const free = fits.find((b) => covered(b) === 0);
  if (free) return { ...free, covered: 0 };
  const pool = (fits.length ? fits : candidates).map((b) => ({ ...b, covered: covered(b) }));
  return pool.reduce((best, b) => (b.covered < best.covered ? b : best));
}
