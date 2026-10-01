import { useEffect, useState } from "react";
import { getJson, type IskOverview, type IskQuarter } from "../../../api";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { openSettings } from "../../../shell/routes";
import { listSv } from "../../settings/summaries";
import { dm, kr } from "../format";

/** '2,96 %' from basis points. */
export const ratePct = (bp: number) => `${(bp / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

const SOURCE: Record<IskQuarter["source"], string> = {
  entered: "inmatat",
  computed: "beräknat",
  today: "dagens värde",
  first: "saknas – första kända värdet",
};

/**
 * Balansräkningen's ISK tax (Design v2): this year's tax on the capital base
 * (the quarters' values and the deposits, less the allowance), what it is
 * built of in a popover, and the declared years' bases worked back out of
 * box 7.1. Everything about this year is an estimate until the year is over.
 */
export function IskTaxBox() {
  const [data, setData] = useState<IskOverview | null>(null);
  useEffect(() => {
    getJson<IskOverview>("/tax/isk").then((d) => setData(d?.current ? d : null), () => setData(null));
  }, []);
  if (!data) return null;
  const t = data.current;
  const rate = t.rule.rateBp;
  const latest = [...data.declared].sort((a, b) => b.year - a.year)[0];
  const rows: [string, string, string?][] = [
    ...t.quarters.map((q): [string, string, string] => [`Värde ${dm(q.date)}`, kr(q.valueOre), SOURCE[q.source]]),
    [`Insättningar t.o.m. ${dm(t.deposits.through)}`, kr(t.deposits.ore), `${t.deposits.count} st`],
  ];
  return (
    <div className="mt-2 rounded-inset bg-card-inset px-3.5 py-3" data-testid="isk-tax">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <p className="min-w-0">
          <span className="font-medium">ISK-skatt {t.year}</span>{" "}
          <span className="rounded-full bg-caution-soft px-1.5 py-px text-[10px] font-medium text-caution-text">uppskattning</span>
        </p>
        <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums" data-figure="isk-tax">
          {t.taxOre === null ? <span className="font-normal text-caution-text">räntan saknas</span> : `${t.estimated && t.taxOre > 0 ? "~" : ""}${kr(t.taxOre)}`}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-2 tabular-nums">
        underlag {kr(t.capitalBaseOre)} · fribelopp {kr(t.rule.allowanceOre)}
        {t.taxableBaseOre === 0 ? " · under fribeloppet" : rate !== null ? ` · ${ratePct(rate)} × 30 %` : ""} · dras via slutskatten {t.year + 1}
      </p>
      {t.missing.length > 0 && (
        <p className="mt-1 text-[11px] text-caution-text">
          ISK-värdet {listSv(t.missing.map(dm))} saknas: skriv av det från Avanza under{" "}
          <button type="button" className="font-semibold underline" onClick={() => openSettings("deklaration")}>
            Inställningar › Deklaration
          </button>
          .
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="font-semibold text-accent hover:underline">
              Visa uträkning
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 border-hairline bg-card text-[12px] text-ink" aria-label={`Uträkning av ISK-skatten ${t.year}`}>
            <p className="mb-2 font-semibold">Kapitalunderlag {t.year}</p>
            <table className="w-full tabular-nums">
              <tbody>
                {rows.map(([label, value, note]) => (
                  <tr key={label}>
                    <td className="py-0.5 pr-2">{label}</td>
                    <td className="py-0.5 text-right">{value}</td>
                    <td className={cn("py-0.5 pl-2 text-[10px]", note?.startsWith("saknas") ? "text-caution-text" : "text-ink-3")}>{note}</td>
                  </tr>
                ))}
                <tr className="border-t border-hairline font-medium">
                  <td className="py-1 pr-2">÷ 4 = underlag</td>
                  <td className="py-1 text-right">{kr(t.capitalBaseOre)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="py-0.5 pr-2">− fribelopp</td>
                  <td className="py-0.5 text-right">{kr(t.rule.allowanceOre)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="py-0.5 pr-2">× schablonränta</td>
                  <td className="py-0.5 text-right">{rate === null ? "–" : ratePct(rate)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="py-0.5 pr-2">= schablonintäkt att beskatta</td>
                  <td className="py-0.5 text-right">{t.standardIncomeOre === null ? "–" : kr(t.standardIncomeOre)}</td>
                  <td />
                </tr>
                <tr className="border-t border-hairline font-semibold">
                  <td className="py-1 pr-2">× 30 % = skatt</td>
                  <td className="py-1 text-right">{t.taxOre === null ? "–" : kr(t.taxOre)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] leading-snug text-ink-3">
              Kvartal som inte har börjat räknas med dagens värde, och bara insättningarna hittills är med. Regeln: {t.rule.source}.
            </p>
          </PopoverContent>
        </Popover>
        <button type="button" className="font-semibold text-accent hover:underline" onClick={() => openSettings("deklaration")}>
          Ränta och kvartalsvärden
        </button>
      </div>
      {latest && latest.capitalBaseOre !== null && (
        <p className="mt-1.5 border-t border-hairline pt-1.5 text-[11px] text-ink-2 tabular-nums" data-testid="isk-declared">
          {latest.year} enligt deklarationen: underlag {kr(latest.capitalBaseOre)} ({kr(latest.standardIncomeOre)} på rad 7.1 ÷ {ratePct(latest.rateBp!)}) · skatt{" "}
          {kr(latest.taxOre)}
          {latest.allowanceOre > 0 && ` efter fribeloppet ${kr(latest.allowanceOre)}`}
          {data.compared && data.compared.year === latest.year && (
            <>
              {" "}
              · verktyget {kr(data.compared.ownBaseOre)} ({data.compared.diffOre >= 0 ? "+" : "−"}
              {kr(Math.abs(data.compared.diffOre))})
            </>
          )}
        </p>
      )}
    </div>
  );
}
