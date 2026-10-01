import { useEffect, useState } from "react";
import { getJson, type Flow } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { useWidth } from "../../../lib/useWidth";
import { dm, kr } from "../format";
import { incomeBar, surplusBar, type BarPart } from "./flowBars";

const percent = (share: number | null) => (share === null ? "–" : `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`);

const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** 'YYYY-MM' -> 'juni'. */
const monthName = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];

/** A segment without room for its label (about 6,5 px a character and the padding) leaves it to the legend. */
const labelFits = (text: string, px: number) => px >= text.length * 6.5 + 20;

const INCOME_COLOUR: Record<string, string> = { fixed: "bg-ink text-card", variable: "bg-ink-2 text-card", left: "bg-accent text-white" };
const SURPLUS_COLOUR: Record<string, string> = { portfolio: "bg-positive", buffer: "bg-wallet-savings", unexplained: "bg-ink-3" };

function Segment({ part, colour, width, className }: { part: BarPart; colour: string; width: number; className?: string }) {
  const text = `${part.label} ${part.subtracts ? "−" : ""}${kr(Math.abs(part.ore))}`;
  return (
    <div
      className={cn("absolute inset-y-0 flex min-w-1 items-center overflow-hidden whitespace-nowrap px-2.5 text-[11px] font-semibold", colour, className)}
      style={{ left: `${part.from * 100}%`, width: `${part.width * 100}%` }}
      data-part={part.key}
    >
      {labelFits(text, part.width * width) && <span className="truncate">{text}</span>}
    </div>
  );
}

/**
 * Flöde per månad: what came in, went out and was left, as one bar on the
 * net income, and where what was left went as a second bar on the same
 * scale (a negative rest as a strip under its end, starting where Kvar stops). The
 * student loan under it, with its rate and its end.
 */
export function FlowCard() {
  const [data, setData] = useState<Flow | null>(null);
  const [ref, width] = useWidth(600);
  useEffect(() => {
    getJson<Flow>("/networth/flow").then(setData, () => setData(null));
  }, []);
  if (!data) return null;

  const { perMonth: p, destinations: d, csn } = data;
  const first = incomeBar(p);
  const second = surplusBar(data, first.scale);
  const left = first.parts.find((x) => x.key === "left")!;
  // How far the loan has come since it was written down. It starts empty:
  // what is known is the anchor, not what the loan once was.
  const paidShare = csn && csn.anchorOre > 0 ? Math.min(1, csn.paidSinceAnchorOre / csn.anchorOre) : 0;

  return (
    <Card aria-label="Flöde per månad" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">
          Flöde per månad{" "}
          <span className="text-[13px] font-normal text-ink-2">
            · snitt över {data.months} hela månader, {monthName(data.from)}–{monthName(data.to)} · det som faktiskt hände
          </span>
        </h2>
        <p className="text-xs text-ink-2">
          Nettoinkomst <b className="font-semibold text-ink tabular-nums">{kr(p.incomeOre)}</b>
        </p>
      </div>

      <div ref={ref} className="flex flex-col gap-2">
        <div
          className="relative h-7 overflow-hidden rounded-lg"
          role="img"
          aria-label={`Nettoinkomst ${kr(p.incomeOre)}: fasta ${kr(p.fixedOre)}, rörligt ${kr(p.variableOre)}, kvar ${kr(p.leftOre)}.`}
          data-testid="flow-income-bar"
        >
          {first.parts.map((x) => (
            // 2 px between the parts: each but the last gives up its right edge.
            <Segment key={x.key} part={x} colour={cn(INCOME_COLOUR[x.key], x.key !== "left" && "border-r-2 border-card")} width={width} />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-2">
          <li>
            <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-ink" /> Fasta utgifter <b className="font-semibold text-ink tabular-nums">{kr(p.fixedOre)}</b> = {percent(data.fixedShareOfIncome)} av nettoinkomsten
          </li>
          <li>
            <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-ink-2" /> Rörligt <b className="font-semibold text-ink tabular-nums">{kr(p.variableOre)}</b>
            {data.refundsOre > 0 && ` netto — ${kr(data.refundsOre)}/mån kom tillbaka och är avräknat`}
          </li>
          <li>
            <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-accent" /> Kvar efter allt <b className="font-semibold text-ink tabular-nums">{kr(p.leftOre)}</b>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-ink-2">Vart det som blev över tog vägen</h3>
        <div className="relative" role="img" aria-label={`Kvar ${kr(p.leftOre)}: ${second.parts.map((x) => `${x.label} ${kr(x.ore)}`).join(", ")}.`} data-testid="flow-surplus-bar">
          <div className="relative h-7 overflow-hidden rounded-lg text-white">
            {second.parts
              .filter((x) => !x.subtracts)
              .map((x) => (
                <Segment key={x.key} part={x} colour={cn(SURPLUS_COLOUR[x.key], "border-r-2 border-card")} width={width} />
              ))}
          </div>
          {/* What takes away, under the end of the others: where it starts is where Kvar ends. */}
          {second.parts
            .filter((x) => x.subtracts)
            .map((x) => (
              <div key={x.key} className="relative mt-1 h-4" data-part={x.key}>
                <div className="absolute inset-y-0 rounded-[4px] bg-alarm-soft ring-1 ring-alarm/40 ring-inset" style={{ left: `${x.from * 100}%`, width: `${x.width * 100}%` }} />
                <span className="absolute top-0 pl-1.5 text-[10px] font-semibold leading-4 text-caution-text whitespace-nowrap" style={{ left: `${(x.from + x.width) * 100}%` }}>
                  −{kr(Math.abs(x.ore))}
                </span>
              </div>
            ))}
          {/* Where Kvar ends in the bar above. */}
          <div className="absolute -top-1 -bottom-1 w-0 border-l border-dashed border-ink" style={{ left: `${left.width * 100}%` }} aria-hidden data-testid="flow-left-mark" />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-2">
          <li>
            <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-positive" /> Till portföljen <b className="font-semibold text-ink tabular-nums">{kr(d.portfolioOre)}</b>
            {data.savingsRate !== null && ` · sparkvot ${percent(data.savingsRate)}`}
          </li>
          {d.bufferAccount && (
            <li>
              <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-wallet-savings" /> Till {d.bufferAccount.name} <b className="font-semibold text-ink tabular-nums">{kr(d.bufferOre)}</b> · kontots
              nettoförändring
            </li>
          )}
          <li>
            <span aria-hidden className={cn("mr-1.5 inline-block size-2 rounded-full", d.unexplainedOre < 0 ? "bg-alarm-soft ring-1 ring-alarm/40" : "bg-ink-3")} /> Oförklarat{" "}
            <b className="font-semibold text-ink tabular-nums">{kr(d.unexplainedOre)}</b>
            {d.unexplainedOre < 0 && " · mer sattes undan än vad som blev över — saldona minskade"}
          </li>
          <li>
            <span aria-hidden className="mr-1.5 inline-block h-3 w-0 border-l border-dashed border-ink align-middle" /> = Kvar {kr(p.leftOre)}
          </li>
        </ul>
      </div>

      {csn && (
        <div className="border-t border-hairline pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 className="text-[13px] font-semibold">CSN</h3>
            <p className="text-xs text-ink-2 tabular-nums">
              Återstår <b className="font-semibold text-ink">{kr(csn.remainingOre)}</b> · betalt i år <b className="font-semibold text-ink">{kr(csn.paidThisYearOre)}</b>
              {csn.payoffMonth && (
                <>
                  {" "}
                  · slutbetalt{" "}
                  <b className="font-semibold text-ink">
                    {monthName(csn.payoffMonth)} {csn.payoffMonth.slice(0, 4)}
                  </b>
                </>
              )}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="img" aria-label={`${percent(paidShare)} av lånet betalt sedan ${dm(csn.anchorDate)}`}>
            <div className="h-full min-w-2 rounded-full bg-ink" style={{ width: `${paidShare * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {kr(csn.paidSinceAnchorOre)} av {kr(csn.anchorOre)} betalt sedan {dm(csn.anchorDate)}
            {csn.rateOre !== null && ` · takten i år är ${kr(csn.rateOre)}/mån på ${csn.chargesThisYear} dragningar`}
            {csn.monthsLeft !== null && ` · ${Math.round(csn.monthsLeft / 12)} år kvar`}. Ingen antagen ränteändring och ingen extraamortering.
          </p>
        </div>
      )}
    </Card>
  );
}
