import { useState } from "react";
import { Plus } from "lucide-react";
import { parseKr, sendJson, type PensionStatementCheck, type PensionStatementFigures } from "../../../api";
import { Card } from "../../../components/Card";
import { Button } from "../../../components/ui/button";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { kr } from "../format";
import { field } from "./ForecastCard";

const FIGURES: { key: keyof PensionStatementFigures; label: string; short: string }[] = [
  { key: "pensionableIncomeOre", label: "Pensionsgrundande inkomst", short: "PGI" },
  { key: "incomePensionRightOre", label: "Inkomstpension", short: "Inkomstpension" },
  { key: "premiumPensionRightOre", label: "Premiepension", short: "Premiepension" },
];

/** The ceiling: 7,5 income base amounts. */
const CAP_BASE_AMOUNTS = 7.5;

const signedKr = (ore: number) => (ore === 0 ? "±0 kr" : `${ore > 0 ? "+" : "−"}${kr(Math.abs(ore))}`);

/** The ceiling a year's income is drawn against: that year's when the check has it, else this year's. */
export const capFor = (c: PensionStatementCheck, fallbackOre: number | null) => (c.computed ? Math.round(c.computed.baseAmount.amountOre * CAP_BASE_AMOUNTS) : fallbackOre);

const COLUMNS = "@[44rem]:grid-cols-[8.5rem_minmax(0,1fr)_8.5rem_7rem_7rem_7rem_3.5rem]";

/** The salary declared for the year, the PGI it gives and how far the envelope's is from it. */
function Declared({ c }: { c: PensionStatementCheck }) {
  const d = c.declared;
  if (!d) return <span className="block text-[11px] text-ink-3">ingen deklaration</span>;
  return (
    <>
      <span className="block text-[13px]">{kr(d.employmentIncomeOre)}</span>
      <span className="block text-[11px] text-ink-2" title="Deklarerad lön × 0,93 (allmän pensionsavgift), högst taket, mot årsbeskedets PGI">
        PGI {kr(d.pensionableIncomeOre)} ({signedKr(d.diffOre)})
      </span>
    </>
  );
}

/**
 * Årsbeskeden, typed in from the orange envelope, each beside what the tool
 * works out for the same year from the payslips paid out in it. The point is
 * the check: if the two disagree, either the arithmetic or the payslips are
 * missing something, and the envelope is the one that is right. A bar shows
 * the pensionable income against the ceiling. On a phone each year is a
 * small card.
 */
export function StatementsCard({ checks, capOre, capYear, onChanged }: { checks: PensionStatementCheck[]; capOre: number | null; capYear: number | null; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ year: "", pensionableIncomeOre: "", incomePensionRightOre: "", premiumPensionRightOre: "" });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const year = Number(draft.year);
    const amounts = FIGURES.map((f) => parseKr(draft[f.key]));
    if (!Number.isInteger(year) || amounts.some((a) => a === null)) {
      setError("Fyll i året och alla tre beloppen i kronor.");
      return;
    }
    try {
      await sendJson("POST", "/networth/pension/statements", {
        year,
        pensionableIncomeOre: amounts[0],
        incomePensionRightOre: amounts[1],
        premiumPensionRightOre: amounts[2],
      });
      setAdding(false);
      setError(null);
      setDraft({ year: "", pensionableIncomeOre: "", incomePensionRightOre: "", premiumPensionRightOre: "" });
      notify({ text: `Årsbeskedet för ${year} är inlagt.` });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (c: PensionStatementCheck) => {
    await sendJson("DELETE", `/networth/pension/statements/${c.statement.id}`, {});
    onChanged();
  };

  return (
    <Card aria-labelledby="statements-title" className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="statements-title" className="text-base font-semibold">
          Årsbesked
        </h2>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-accent hover:underline">
          <Plus className="size-3.5" aria-hidden /> Lägg in årsbesked
        </button>
      </div>

      {adding && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-inset bg-card-inset p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-[11px] text-ink-2">
            Inkomstår
            <input aria-label="Inkomstår" inputMode="numeric" placeholder="2024" className={cn(field, "w-20 tabular-nums")} value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
          </label>
          {FIGURES.map((f) => (
            <label key={f.key} className="grid gap-1 text-[11px] text-ink-2">
              {f.label} (kr)
              <input aria-label={f.label} inputMode="decimal" className={cn(field, "w-36 text-right tabular-nums")} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            </label>
          ))}
          <Button size="sm" type="submit">
            Spara
          </Button>
          <p className="w-full text-[11px] text-ink-3">Kuvertet gäller inkomståret två år bakåt: Årsbesked 2026 redovisar pensionsrätterna för 2024.</p>
          {error && <p className="w-full text-xs text-caution-text">{error}</p>}
        </form>
      )}

      {checks.length === 0 && !adding && (
        <p className="rounded-inset bg-card-inset px-3.5 py-3 text-xs text-ink-2">Inga inlagda. Det orangea kuvertet anger pensionsgrundande inkomst och pensionsrätter per inkomstår; lagt här ställs det mot verktygets egen beräkning.</p>
      )}

      {checks.length > 0 && (
        <div>
          <div aria-hidden className={cn("hidden gap-x-4 border-b border-hairline pb-1.5 text-[11px] text-ink-3 @[44rem]:grid", COLUMNS)}>
            <span>Inkomstår</span>
            <span>Pensionsgrundande inkomst</span>
            <span className="text-right">Deklarerad lön</span>
            {FIGURES.map((f) => (
              <span key={f.key} className="text-right">
                {f.short}
              </span>
            ))}
            <span />
          </div>
          <ul className="divide-y divide-hairline">
            {checks.map((c) => {
              const cap = capFor(c, capOre);
              const share = cap ? Math.min(1, c.statement.pensionableIncomeOre / cap) : null;
              return (
                <li key={c.statement.id} className={cn("grid grid-cols-3 items-start gap-x-4 gap-y-2 py-3 @[44rem]:items-center", COLUMNS)} data-year={c.statement.year}>
                  <div className="col-span-2 @[44rem]:col-span-1">
                    <p className="text-[15px] font-semibold tabular-nums">{c.statement.year}</p>
                    <p className="text-[11px] text-ink-2">
                      {c.computed ? `beräknat på ${c.computed.payslips} av 12 lönespecar${c.computed.capped ? ", vid taket" : ""}` : `inga lönespecar för ${c.statement.year} att jämföra med`}
                    </p>
                    {c.declared && (
                      <p className="text-[11px] text-ink-2 @[44rem]:hidden" data-declared-narrow>
                        deklarerad lön {kr(c.declared.employmentIncomeOre)} → PGI {kr(c.declared.pensionableIncomeOre)} ({signedKr(c.declared.diffOre)})
                      </p>
                    )}
                  </div>
                  <div className="col-span-3 row-start-2 @[44rem]:col-span-1 @[44rem]:row-start-auto">
                    {share !== null && (
                      <div className="h-2 rounded-full bg-track" role="img" aria-label={`Pensionsgrundande inkomst ${kr(c.statement.pensionableIncomeOre)} av taket ${kr(cap!)}`}>
                        <div className="h-2 min-w-2 rounded-full bg-accent" style={{ width: `${share * 100}%` }} data-bar />
                      </div>
                    )}
                  </div>
                  <div className="hidden text-right tabular-nums @[44rem]:block" data-declared>
                    <Declared c={c} />
                  </div>
                  {FIGURES.map((f, i) => (
                    <div key={f.key} className={cn("text-right tabular-nums", i === 0 ? "row-start-3 @[44rem]:row-start-auto" : "row-start-3 @[44rem]:row-start-auto")}>
                      <span className="block text-[11px] text-ink-3 @[44rem]:hidden">{f.short}</span>
                      <span className={cn("block text-[13px]", i === 0 && "font-semibold")}>{kr(c.statement[f.key])}</span>
                      {c.computed && c.diff && (
                        <span className="block text-[11px] text-ink-2">
                          beräknat {kr(c.computed[f.key])} ({signedKr(c.diff[f.key])})
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="col-start-3 row-start-1 text-right @[44rem]:col-start-auto @[44rem]:row-start-auto">
                    <button type="button" onClick={() => void remove(c)} aria-label={`Ta bort årsbeskedet för ${c.statement.year}`} className="text-[11px] text-ink-2 hover:text-alarm">
                      Ta bort
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {capOre !== null && (
            <p className="mt-1 text-[11px] text-ink-3">
              Stapeln visar pensionsgrundande inkomst mot taket 7,5 inkomstbasbelopp: {kr(capOre)}/år{capYear ? ` med beloppet för ${capYear}` : ""}, eller det årets belopp när året jämförs med lönespecarna.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
