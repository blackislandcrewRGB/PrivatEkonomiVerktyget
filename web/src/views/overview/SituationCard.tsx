import type { Overview } from "../../api";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { navigate } from "../../shell/routes";
import { dm, kr } from "./format";

interface Segment {
  key: string;
  label: string;
  /** What the legend says after the label: a share of the securities, or an amount. */
  value: string;
  ore: number;
  colour: string;
  tone?: string;
}

/**
 * Ekonomisk situation på Översikten: the money in total — the bank
 * accounts, the securities and the cash on ISK — as one figure and a bar
 * split into what it is made of, and how long the buffer would last.
 *
 * No change since yesterday: a net worth moves with the market and none of
 * it is news. The colours only tell the parts apart; what can be acted on
 * is the division between the zones (the bet zone in orange text when it is
 * over its share) and a buffer thinner than six months.
 */
export function SituationCard({ data }: { data: Overview }) {
  const s = data.situation;
  const p = data.portfolio;
  if (!s && !p) return null;
  const share = (value: number | null) => (value === null ? "–" : `${(value * 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} %`);
  const segments: Segment[] = [];
  if (p) {
    const { base, bet } = p.zones;
    if (base !== null || bet !== null) {
      segments.push(
        { key: "base", label: "Värdepapper, basen", value: share(base), ore: Math.round(p.totalOre * (base ?? 0)), colour: "bg-accent" },
        {
          key: "bet",
          label: "Värdepapper, bet-zonen",
          value: share(bet),
          ore: Math.round(p.totalOre * (bet ?? 0)),
          colour: "bg-caution",
          tone: p.betState === "over" ? "font-semibold text-caution-text" : undefined,
        },
      );
    } else {
      segments.push({ key: "securities", label: "Värdepapper", value: kr(p.totalOre), ore: p.totalOre, colour: "bg-accent" });
    }
  }
  segments.push(
    { key: "isk", label: "ISK-likvider", value: kr(data.money.iskOre), ore: data.money.iskOre, colour: "bg-job" },
    { key: "bank", label: "Bankkonton", value: kr(data.money.bankOre), ore: data.money.bankOre, colour: "bg-ink" },
  );
  const parts = segments.filter((x) => x.ore > 0);
  const sum = parts.reduce((t, x) => t + x.ore, 0);
  const months = s?.bufferMonths ?? null;
  const bufferTone = months === null ? "" : months < 6 ? cn("text-caution-text", months < 3 && "font-semibold") : "text-positive-text";

  return (
    <Card aria-labelledby="situation-title" className="flex flex-col gap-3.5 sm:py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h2 id="situation-title" className="inline text-base font-semibold">
            Ekonomisk situation
          </h2>{" "}
          <span className="text-[13px] text-ink-2">· pengar totalt: bankkontona, värdepapperen och likviderna på ISK</span>
        </div>
        {s && <span className="text-[22px] font-bold tabular-nums">{formatKr(s.moneyOre)}</span>}
      </div>

      {sum > 0 && (
        <div
          role="img"
          aria-label={`Pengar totalt fördelat: ${parts.map((x) => `${x.label} ${kr(x.ore)}`).join(", ")}.`}
          className="flex h-[22px] gap-0.5 overflow-hidden rounded-[11px]"
          data-testid="situation-bar"
        >
          {parts.map((x) => (
            <div key={x.key} data-part={x.key} title={`${x.label}: ${kr(x.ore)}`} className={cn("min-w-[3px]", x.colour)} style={{ width: `${(x.ore / sum) * 100}%` }} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-ink-2">
        <ul className="flex flex-wrap gap-x-[18px] gap-y-1" aria-label="Förklaring till fördelningen">
          {segments.map((x) => (
            <li key={x.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-[9px] rounded-full", x.colour)} />
              <span className={x.tone}>
                {x.label} {x.value}
              </span>
            </li>
          ))}
        </ul>
        <p className="tabular-nums">
          {p && (
            <>
              Fast i värdepapper <b className="font-semibold text-ink">{formatKr(p.totalOre)}</b> · {p.priceDate ? `kurser från ${dm(p.priceDate)}` : "inga kurser hämtade"}
              {p.missing > 0 && ` · ${p.missing} innehav utan kurs`}
              {p.stale > 0 && <span className="font-semibold text-caution-text">{` · ${p.stale === 1 ? "1 innehav" : `${p.stale} innehav`} med gammal kurs`}</span>}
              {" · "}
            </>
          )}
          {s && (
            <>
              bufferten <b className={bufferTone}>{months === null ? "–" : `${months.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} mån`}</b> ·{" "}
            </>
          )}
          <button type="button" onClick={() => navigate("analysis", { search: "?flik=sparande" })} className="text-accent hover:text-accent-hover">
            Innehav
          </button>
          {" · "}
          <button type="button" onClick={() => navigate("overview", { search: "?flik=situation" })} className="text-accent hover:text-accent-hover">
            Balansräkning
          </button>
        </p>
      </div>
    </Card>
  );
}
