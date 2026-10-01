import { useState } from "react";
import { Fuel, UtensilsCrossed } from "lucide-react";
import { parseKr, sendJson, type EstimateAverage, type ExpenseEstimates } from "../../api";
import { Card } from "../../components/Card";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import type { Share } from "../../lib/share";
import { navigate } from "../../shell/routes";
import { kr } from "../overview/format";

// Apple's field: a thin grey edge, 8 px corners, the figure to the right.
const input = "h-8 w-28 rounded-lg border border-neutral-bar bg-card px-2.5 text-right text-[13px] text-ink tabular-nums outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20";
const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
const span = (a: EstimateAverage) => `${monthShort(a.from)}–${monthShort(a.to)}`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Uppskattat: food and fuel per month next to the fixed expenses. Food is the
 * last three months' average for Livsmedel, Restaurang & café and Hämtmat,
 * unless the household's amount is entered; fuel comes from Pendling &
 * bränsle; my part is the share that has been mine.
 */
export function Estimates({ data, share, onChanged }: { data: ExpenseEstimates; share: Share; onChanged: (d: ExpenseEstimates) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const { food, fuel } = data;
  // Empty while the average is used: an entered amount is shown to be changed or cleared.
  const value = draft ?? (food.source !== "entered" || food.amount === null ? "" : String(Math.round(food.amount / 100)));

  const save = async (amount: number | null) => {
    try {
      onChanged(await sendJson<ExpenseEstimates>("PUT", "/recurring-expenses/estimates", { food: amount }));
      setDraft(null);
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const submit = () => {
    const v = value.trim();
    if (v === "") return save(null);
    const ore = parseKr(v);
    if (ore === null) return notify({ text: "Skriv beloppet i kronor." });
    return save(ore);
  };
  const shown = (x: { amount: number | null; mine: number | null }) => (share === "mine" ? x.mine : x.amount);

  return (
    <Card aria-labelledby="estimates-title" className="text-sm">
      {/* The explanation inline with the title, in the secondary colour. */}
      <div className="text-ink-2">
        <h2 id="estimates-title" className="inline text-base font-semibold text-ink">
          Uppskattat
        </h2>{" "}
        <span className="text-xs">
          · Mat och bränsle per månad, som om de vore fasta. {share === "mine" ? "Din del är andelen som varit din de senaste tre månaderna." : "Hela hushållets."}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-hairline">
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-positive-soft text-positive-text">
            <UtensilsCrossed className="size-4" />
          </span>
          <span className="min-w-0 flex-1 basis-[14rem]">
            <span className="font-medium">Mat</span>
            <span className="block text-[11px] text-ink-3">
              livsmedel, restaurang och hämtmat: snitt {span(food.average)} {kr(food.average.household)}/mån, din del {kr(food.average.mine)} ({pct(food.average.mineShare)})
              {food.source === "entered" ? (
                <button type="button" className="ml-2 font-medium text-accent hover:underline" onClick={() => save(null)}>
                  använd snittet
                </button>
              ) : (
                food.source === "average" && <span>. Räknas med snittet, skriv ett belopp för att ändra.</span>
              )}
            </span>
          </span>
          <label className="flex items-center gap-2 max-sm:ml-12">
            <span className="text-xs text-ink-2">hushållet</span>
            <input
              aria-label="Mat per månad, hushållet"
              inputMode="decimal"
              placeholder={food.average.household > 0 ? Math.round(food.average.household / 100).toLocaleString("sv-SE") : "t.ex. 8 000"}
              className={input}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <span className="text-xs text-ink-2">kr/mån</span>
          </label>
          {draft !== null && (
            <Button size="sm" onClick={submit} className="h-8 rounded-lg border-0 bg-accent px-3 text-[13px] font-semibold text-white hover:bg-accent-hover">
              Spara
            </Button>
          )}
          <span className={cn("ml-auto w-24 text-right font-bold tabular-nums", shown(food) === null && "text-ink-3")}>{shown(food) === null ? "–" : kr(shown(food)!)}</span>
        </li>
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-caution-soft text-caution-text">
            <Fuel className="size-4" />
          </span>
          <span className="min-w-0 flex-1 basis-[14rem]">
            <span className="font-medium">Bränsle</span>
            <span className="block text-[11px] text-ink-3">
              {fuel.source === "forecast"
                ? `enligt Pendling & bränsle (${fuel.shifts} pass den här månaden)`
                : fuel.source === "average"
                  ? `snitt ${span(fuel.average)}, fyll i pass i Pendling & bränsle för en prognos`
                  : "fyll i pass och literpris i Pendling & bränsle"}
              {fuel.amount !== null && `, din del ${pct(fuel.average.mineShare)}`}
              <button type="button" className="ml-2 font-medium text-accent hover:underline" onClick={() => navigate("commute")}>
                öppna
              </button>
            </span>
          </span>
          <span className={cn("ml-auto w-24 text-right font-bold tabular-nums", shown(fuel) === null && "text-ink-3")}>{shown(fuel) === null ? "–" : kr(shown(fuel)!)}</span>
        </li>
      </ul>
    </Card>
  );
}
