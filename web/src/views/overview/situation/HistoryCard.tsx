import { useEffect, useState } from "react";
import { getJson, type NetworthHistory } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { setSearch } from "../../../shell/routes";
import { kr } from "../format";

/** '2026-08' -> 'aug'. */
const MONTH_SHORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const shortMonth = (m: string) => MONTH_SHORT[Number(m.slice(5, 7)) - 1];

const addMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export interface HistoryBar {
  month: string;
  /** Null: nothing saved for the month (a placeholder). */
  netExCsnOre: number | null;
  estimated: boolean;
  today: boolean;
}

/** The last 12 months ending with this one (drawn as today, not stored): the saved ones, the rest placeholders. */
export function historyBars(data: Pick<NetworthHistory, "months" | "today">): HistoryBar[] {
  const saved = new Map(data.months.map((m) => [m.month, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = addMonth(data.today.month, i - 11);
    if (month === data.today.month) return { month, netExCsnOre: data.today.netExCsnOre, estimated: false, today: true };
    const m = saved.get(month);
    return { month, netExCsnOre: m ? m.netExCsnOre : null, estimated: m?.estimated ?? false, today: false };
  });
}

/**
 * Historik: net worth without CSN month by month, twelve bars ending on
 * today (blue where saved, lighter where worked out backwards, a grey stub
 * where nothing is known). Under it the months as a table, or why there are
 * none yet with the way to put values in.
 */
export function HistoryCard() {
  const [data, setData] = useState<NetworthHistory | null>(null);
  useEffect(() => {
    getJson<NetworthHistory>("/networth/history").then(setData, () => setData(null));
  }, []);
  if (!data) return null;

  const bars = historyBars(data);
  const top = Math.max(1, ...bars.map((b) => Math.max(0, b.netExCsnOre ?? 0)));
  const known = bars.filter((b) => b.netExCsnOre !== null);

  return (
    <Card aria-label="Historik" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">
        Historik <span className="text-[13px] font-normal text-ink-2">· nettoförmögenhet exkl. CSN, 12 månader</span>
      </h2>

      <div>
        <div className="flex h-24 items-end gap-1.5" role="img" aria-label={`Nettoförmögenhet exklusive CSN: ${known.map((b) => `${b.today ? "i dag" : `${shortMonth(b.month)} ${b.month.slice(0, 4)}`} ${kr(b.netExCsnOre!)}`).join(", ")}.`} data-testid="history-bars">
          {bars.map((b) => (
            <div
              key={b.month}
              data-month={b.month}
              data-state={b.netExCsnOre === null ? "missing" : b.estimated ? "estimated" : "saved"}
              className={cn("min-h-1 flex-1 rounded-t-[4px] rounded-b-[2px]", b.netExCsnOre === null ? "bg-segment" : b.estimated ? "bg-accent/45" : "bg-accent")}
              style={{ height: b.netExCsnOre === null ? 4 : `${(Math.max(0, b.netExCsnOre) / top) * 100}%` }}
              title={b.netExCsnOre === null ? `${shortMonth(b.month)}: inget sparat` : `${b.today ? "I dag" : `${shortMonth(b.month)} ${b.month.slice(0, 4)}`}: ${kr(b.netExCsnOre)}${b.estimated ? " (framräknad i efterhand)" : ""}`}
            />
          ))}
        </div>
        <div className="mt-1 flex gap-1.5 text-center text-[10px] text-ink-3">
          {bars.map((b) => (
            <span key={b.month} className="flex-1">
              {shortMonth(b.month)}
            </span>
          ))}
        </div>
      </div>

      {data.months.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-ink-3">
              <th className="pb-1 font-normal">Månad</th>
              <th className="pb-1 text-right font-normal">Exkl. CSN</th>
              <th className="pb-1 text-right font-normal">Inkl. CSN</th>
              <th className="pb-1 text-right font-normal">Illikvida</th>
            </tr>
          </thead>
          <tbody>
            {[...data.months].reverse().map((m) => (
              <tr key={m.month} className="border-t border-hairline">
                <td className="py-1.5">
                  {shortMonth(m.month)} {m.month.slice(0, 4)}
                  {m.estimated && <span className="ml-1.5 text-[11px] text-ink-3">uppskattad</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{kr(m.netExCsnOre)}</td>
                <td className="py-1.5 text-right tabular-nums">{kr(m.netIncCsnOre)}</td>
                <td className="py-1.5 text-right text-ink-2 tabular-nums">{kr(m.illiquidOre)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(data.months.length === 0 || data.missing) && (
        <p className="rounded-inset bg-card-inset px-3.5 py-3 text-xs text-ink-2">
          {data.months.length === 0 && "Ingen månad är sparad än — den första sparas den sista i den här månaden. "}
          {data.missing && `${data.missing} `}
          <button type="button" className="text-accent hover:underline" onClick={() => setSearch("?flik=att-fylla-i")}>
            Lägg in månadsvärden
          </button>
        </p>
      )}
    </Card>
  );
}
