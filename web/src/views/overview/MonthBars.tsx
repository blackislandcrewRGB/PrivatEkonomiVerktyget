import type { ReactNode } from "react";
import type { MonthCategory, Overview } from "../../api";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { useWidth } from "../../lib/useWidth";
import type { Share } from "../../lib/share";
import { kr, monthShort } from "./format";
import { treemap } from "./treemap";

/** Under this share of the month a tile is too small to read: the category goes in the text line under. */
const MIN_SHARE = 0.03;
/** Within this of the average is 'i takt'. */
const PACE = 0.1;

type Status = "under" | "over" | "pace" | "new";
const statusOf = (r: MonthCategory): Status =>
  r.average <= 0 ? "new" : r.current > r.average * (1 + PACE) ? "over" : r.current < r.average * (1 - PACE) ? "under" : "pace";

/** 'snitt 3 509 kr · 761 kr över', in words so the colour is never alone. */
function versus(r: MonthCategory): string {
  const s = statusOf(r);
  if (s === "new") return "inget snitt";
  const diff = Math.round(r.current / 100) * 100 - Math.round(r.average / 100) * 100;
  return `snitt ${kr(r.average)} · ${s === "pace" ? "i takt" : s === "over" ? `${kr(diff)} över` : `${kr(-diff)} under`}`;
}

/**
 * Den här månaden: variable spending per category so far this month as a
 * treemap, the largest on the left — each tile with its amount and how it
 * stands against the average for the same days of the three months before
 * (green under, orange over, blue in pace or too new to say). Categories
 * too small for a tile, with nothing yet or with money back are a line of
 * text under it. A tile or a name opens the month's rows.
 */
export function MonthBars({ data, share, onOpen, className }: { data: Overview; share: Share; onOpen: (categoryId: number | null) => void; className?: string }) {
  const rows = share === "household" ? data.month.household : data.month.categories;
  const total = rows.reduce((s, r) => s + r.current, 0);
  const avgTotal = rows.reduce((s, r) => s + r.average, 0);
  const spent = rows.filter((r) => r.current > 0).reduce((s, r) => s + r.current, 0);
  const tiled = rows.filter((r) => r.current > 0 && r.current >= spent * MIN_SHARE);
  const small = rows.filter((r) => r.current > 0 && r.current < spent * MIN_SHARE);
  const nothing = rows.filter((r) => r.current === 0);
  const back = rows.filter((r) => r.current < 0);
  const [ref, width] = useWidth(560);
  const height = width < 480 ? 320 : 250;
  const tiles = treemap(
    tiled.map((r) => ({ value: r.current, item: r })),
    width,
    height,
  );
  const name = (r: MonthCategory) => (r.categoryId === null ? "Utan kategori" : r.name);
  const link = (r: MonthCategory, text: string) => (
    <button key={r.categoryId ?? "none"} type="button" onClick={() => onOpen(r.categoryId)} className="text-ink-2 hover:text-accent" title={`${name(r)}: visa raderna`}>
      {text}
    </button>
  );
  const join = (items: ReactNode[]) => items.flatMap((x, i) => (i ? [" · ", x] : [x]));

  return (
    <Card aria-labelledby="month-title" className={cn("flex flex-col gap-3 sm:py-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="month-title" className="text-base font-semibold">
          Den här månaden, {share === "household" ? "hushållet" : "din del"}
        </h2>
        <p className="text-xs text-ink-2 tabular-nums">
          Rörliga utgifter 1–{data.month.day} {monthShort(data.today)} <b className="font-semibold text-ink">{kr(total)}</b> · snitt {kr(avgTotal)}
        </p>
      </div>

      {tiles.length === 0 ? (
        <p className="text-[13px] text-ink-2">Inga rörliga utgifter än den här månaden.</p>
      ) : (
        <div ref={ref} className="relative w-full" style={{ height }} data-testid="treemap">
          {tiles.map(({ item: r, x, y, w, h }) => {
            const s = statusOf(r);
            const area = w * h;
            const big = area > 0.2;
            const tiny = w * width < 96 || h * height < 64;
            return (
              <button
                key={r.categoryId ?? "none"}
                type="button"
                data-category={r.categoryId ?? "none"}
                data-status={s}
                onClick={() => onOpen(r.categoryId)}
                title={`${name(r)}: ${kr(r.current)} hittills, ${versus(r)}. Visa raderna.`}
                className="absolute p-[3px] text-left"
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
              >
                <span
                  className={cn(
                    "flex h-full flex-col justify-between overflow-hidden rounded-inset transition-[filter] hover:brightness-[0.97]",
                    tiny ? "px-2 py-1.5" : "p-3",
                    s === "under" && !tiny && "bg-positive-soft",
                    s === "over" && !tiny && "bg-caution-soft",
                    (s === "pace" || s === "new" || tiny) && "bg-accent-soft",
                  )}
                >
                  <span className="min-w-0">
                    <span className={cn("block truncate font-semibold", big ? "text-[15px]" : tiny ? "text-[11px] leading-tight" : "text-xs")}>{name(r)}</span>
                    {!tiny && <span className="block truncate text-xs text-ink-2">{versus(r)}</span>}
                  </span>
                  <span
                    className={cn(
                      "font-bold tabular-nums leading-tight",
                      big ? "text-[28px]" : tiny ? "text-xs leading-tight" : "text-[17px]",
                      !tiny && s === "under" && "text-positive-text",
                      !tiny && s === "over" && "text-caution-text",
                    )}
                  >
                    {kr(r.current)}
                    {tiny && <span className="block truncate text-[10px] font-normal leading-tight text-ink-2">{r.average > 0 ? `snitt ${kr(r.average)}` : "inget snitt"}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-ink-2">
        {small.length > 0 && <p>Små: {join(small.map((r) => link(r, `${name(r)} ${kr(r.current)} (${versus(r)})`)))}</p>}
        {back.length > 0 && <p>Tillbaka: {join(back.map((r) => link(r, `${name(r)} ${kr(-r.current)} (snitt ${kr(r.average)})`)))}</p>}
        {nothing.length > 0 && <p>Inget än: {join(nothing.map((r) => link(r, `${name(r)} (snitt ${kr(r.average).replace(/\s*kr$/, "")})`)))}</p>}
        <p className="text-ink-3">
          Snittet är samma dagar de tre föregående månaderna. Fasta utgifter, överföringar och avstämning ingår inte;{" "}
          {share === "household" ? "delade köp räknas fullt." : "delade köp räknas till hälften."}
        </p>
      </div>
    </Card>
  );
}
