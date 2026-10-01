import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { formatSek, getJson } from "../../api";
import { downloadCsv } from "../../csv";
import type { Share } from "../../lib/share";
import { SegmentedControl } from "../../components/SegmentedControl";
import { cn } from "../../lib/cn";
import { DURATION, useMotionOn } from "../../lib/motion";

export type { Share } from "../../lib/share";

/** Analys' closing note on Min del and Hushållet. */
export const shareNote = (share: Share) =>
  `${share === "mine" ? "Din del: egna köp fullt, delade till hälften, Mios köp inte alls." : "Hela hushållet: alla köp fullt."} Överföringar, avstämning och det Mio betalat ingår aldrig.`;

export const kr = (ore: number) => formatSek(Math.round(ore)).replace(/,\d\d(?=\s*kr)/, "");
/** Rounded to the whole krona, as a table's Money shows it (kr drops the öre): for a figure that must match a table. */
export const wholeKr = (ore: number) => kr(Math.round(ore / 100) * 100);
/** Axis ticks in kronor: '1,5k' from 1 000 kr, whole kronor below. */
export const kTick = (ore: number) =>
  Math.abs(ore) >= 100000 ? `${(ore / 100000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}k` : `${Math.round(ore / 100)}`;
export const pct = (share: number | null) => (share == null ? "–" : `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`);
export const monthLabel = (m: string, long = false) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
};
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// ---------- Period (shared by the tabs, kept for the session) ----------

export type Preset = "3m" | "6m" | "12m" | "ytd" | "custom";
export interface Period {
  preset: Preset;
  from: string;
  to: string;
}
export const DEFAULT_PERIOD: Period = { preset: "12m", from: "", to: "" };

export const PRESET_LABEL: Record<Preset, string> = {
  "3m": "Senaste 3 månaderna",
  "6m": "Senaste 6 månaderna",
  "12m": "Senaste 12 månaderna",
  ytd: "I år",
  custom: "Anpassad",
};
const PRESET_SHORT: Record<Preset, string> = { "3m": "3 mån", "6m": "6 mån", "12m": "12 mån", ytd: "I år", custom: "Anpassat" };

/**
 * The period as dates. 'Senaste N månaderna' = the N whole months before this
 * one plus this month so far (so averages have N whole months).
 */
export function periodRange(p: Period): { from: string; to: string } {
  const today = isoDate(new Date());
  const thisMonth = today.slice(0, 7);
  switch (p.preset) {
    case "3m":
    case "6m":
    case "12m":
      return { from: `${shiftMonth(thisMonth, -Number(p.preset.replace("m", "")))}-01`, to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return { from: p.from || `${today.slice(0, 4)}-01-01`, to: p.to || today };
  }
}

/** Calendar months from `from` to `to`, both included. */
export const monthsBetween = (from: string, to: string) => {
  const [a, b] = [from, to].map((d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)));
  return Math.max(1, b - a + 1);
};

/** The period in the address: ?period=6m (12 mån, the default, is left out); a custom one as ?period=anpassat&fran=…&till=…. */
const URL_PRESET: Record<Preset, string> = { "3m": "3m", "6m": "6m", "12m": "12m", ytd: "iar", custom: "anpassat" };
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function periodFromSearch(q: URLSearchParams): Period | null {
  const v = q.get("period");
  const preset = (Object.keys(URL_PRESET) as Preset[]).find((p) => URL_PRESET[p] === v);
  if (!preset) return null;
  if (preset !== "custom") return { preset, from: "", to: "" };
  const from = q.get("fran");
  const to = q.get("till");
  return { preset, from: isDay(from) ? from : "", to: isDay(to) ? to : "" };
}

/** The address's query with the period written in (the other parameters kept). */
export function periodSearch(p: Period, current: string): string {
  const q = new URLSearchParams(current);
  q.delete("period");
  q.delete("fran");
  q.delete("till");
  if (p.preset !== "12m") q.set("period", URL_PRESET[p.preset]);
  if (p.preset === "custom") {
    const r = periodRange(p);
    q.set("fran", r.from);
    q.set("till", r.to);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** '1 sep 2025 – 26 sep 2026'. */
export const periodText = (from: string, to: string) => {
  const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
  return `${d(from)} – ${d(to)}`;
};

/** 3 mån | 6 mån | 12 mån | I år | Anpassat, for the page header. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const range = periodRange(value);
  return (
    <SegmentedControl<Preset>
      label="Period"
      appearance="v2"
      size="sm"
      options={(Object.keys(PRESET_SHORT) as Preset[]).map((p) => ({ value: p, label: PRESET_SHORT[p] }))}
      value={value.preset}
      onChange={(preset) => onChange(preset === "custom" ? { preset, ...range } : { ...value, preset })}
    />
  );
}

/** The chosen period's dates after the title; editable when it is 'Anpassat'. */
export function PeriodDates({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const range = periodRange(value);
  const input = "h-8 rounded-[9px] border border-neutral-bar/70 bg-card px-2 text-[13px] text-ink outline-none focus:border-accent";
  if (value.preset !== "custom") {
    return (
      <span className="text-[14px] text-ink-3 tabular-nums" title={PRESET_LABEL[value.preset]} data-testid="period-dates">
        {periodText(range.from, range.to)}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px]">
      <input type="date" aria-label="Från" className={input} value={range.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      <span className="text-ink-3">–</span>
      <input type="date" aria-label="Till" className={input} value={range.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
    </span>
  );
}

// ---------- Data ----------

/** Fetches an analysis endpoint; refetches when the path changes. */
export function useAnalysis<T>(path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError(null);
    getJson<T>(`/analysis/${path}`).then(
      (d) => alive && setData(d),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [path, n]);
  return { data, error, reload: () => setN(n + 1) };
}

export const query = (params: Record<string, string | number | boolean | null | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v === true ? "1" : String(v))}`)
    .join("&");

// ---------- Layout ----------

export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export function CsvButton({ filename, header, rows }: { filename: string; header: string[]; rows: () => (string | number | null)[][] }) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, header, rows())}
      title="Ladda ner tabellen som CSV (semikolon, decimalkomma)"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
    >
      <Download className="size-3.5" aria-hidden /> CSV
    </button>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className="mt-0.5 text-[20px] font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}

/**
 * A spending amount in a table: kronor, tabular; a negative one (more
 * refunds than purchases) in green with '+'; zero as a dash.
 */
export function Money({ ore, className }: { ore: number; className?: string }) {
  const v = Math.round(ore / 100);
  // Tabular figures even where the cell class doesn't say so (cards, legends).
  const cls = cn("tabular-nums", className);
  if (v === 0) return <span className={cn("text-ink-3", cls)}>–</span>;
  if (v < 0) return <span className={cn("text-positive-text", cls)}>+{kr(-v * 100)}</span>;
  return <span className={cls}>{kr(v * 100)}</span>;
}

/** Table cell classes; the first column stays put when the table scrolls sideways. */
export const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-normal text-ink-3";
export const td = "whitespace-nowrap px-3 py-1.5 tabular-nums";
export const sticky = "sticky left-0 z-[1] bg-card";
export const totalRow = "border-t border-ink font-semibold";

/** Recharts styling from the theme tokens (works in dark mode). */
/**
 * Recharts draws its own animations, and this keeps them at the app's
 * lengths: bars grow from zero and a line draws itself when the data changes
 * (a new period, a drill-down), in `number` time with ease-out. Off when the
 * system asks for less motion. Reference lines that are meant to be still
 * keep their own isAnimationActive={false}.
 */
export function useChartAnimation() {
  const on = useMotionOn();
  return { isAnimationActive: on, animationDuration: Math.round(DURATION.number * 1000), animationEasing: "ease-out" as const };
}

export const chart = {
  grid: "var(--color-hairline)",
  tick: { fontSize: 11, fill: "var(--color-ink-3)" },
  line: "var(--color-ink)",
  cursor: { fill: "var(--color-card-inset)", fillOpacity: 0.7 },
};

/** Recharts tooltip in the app's style: a title and name/value lines. */
export function ChartTooltip({ title, lines, footer }: { title: ReactNode; lines: { color?: string; name: string; value: ReactNode; dashed?: boolean }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-48 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
      <p className="mb-1 font-semibold first-letter:uppercase">{title}</p>
      <ul className="space-y-0.5">
        {lines.map((l) => (
          <li key={l.name} className="flex items-center gap-2">
            {l.color && <span className={cn("size-2.5 shrink-0", l.dashed ? "h-0.5 w-3" : "rounded-sm")} style={{ background: l.color }} />}
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="tabular-nums">{l.value}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1 border-t border-hairline pt-1">{footer}</div>}
    </div>
  );
}
