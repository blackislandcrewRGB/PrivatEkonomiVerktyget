import { useEffect, useState } from "react";
import { getJson, parseKr, sendJson, type IskSettings } from "../../../api";
import { cn } from "../../../lib/cn";
import { formatKr } from "../../../lib/format";
import { Field } from "../compact";
import { BUTTON, FIELD } from "../ui";

const kr = (ore: number) => formatKr(ore, { whole: true });
const pct = (bp: number) => `${(bp / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 })} %`;
const QUARTERS = ["01-01", "04-01", "07-01", "10-01"];
const quarterLabel = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

/**
 * Inställningar › Deklaration, the ISK part: the standard rate and the
 * allowance per year with where they come from, and the ISK's value at the
 * start of each quarter this year, for the quarters before the holdings were
 * entered (Avanza › ISK › Värdeutveckling).
 */
export function IskRules({ year }: { year: number }) {
  const [data, setData] = useState<IskSettings | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState({ year: "", rate: "", allowance: "", source: "" });
  const [quarters, setQuarters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = () =>
    getJson<IskSettings>("/tax/isk/settings").then((d) => {
      setData(d);
      setQuarters(Object.fromEntries(QUARTERS.map((q) => [`${year}-${q}`, String((d.quarters.find((x) => x.date === `${year}-${q}`)?.valueOre ?? 0) / 100 || "")])));
    }, () => setData(null));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);
  if (!data) return null;

  const start = (y: number | null) => {
    setError(null);
    const r = data.rules.find((x) => x.year === y);
    setDraft(
      r
        ? { year: String(r.year), rate: r.rateBp === null ? "" : String(r.rateBp / 100).replace(".", ","), allowance: String(r.allowanceOre / 100), source: r.source }
        : { year: String(year + 1), rate: "", allowance: String((data.rules.at(-1)?.allowanceOre ?? 0) / 100), source: "" },
    );
    setEditing(y ?? "new");
  };
  const saveRule = async () => {
    setError(null);
    const rate = draft.rate.trim() === "" ? null : Number(draft.rate.replace(",", "."));
    const allowance = parseKr(draft.allowance || "0");
    if (rate !== null && !Number.isFinite(rate)) return setError("Skriv räntan i procent, till exempel 3,55.");
    if (allowance === null) return setError("Skriv fribeloppet i kronor.");
    try {
      setData(await sendJson<IskSettings>("PUT", "/tax/isk/rules", { year: Number(draft.year), rateBp: rate === null ? null : Math.round(rate * 100), allowanceOre: allowance, source: draft.source }));
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveQuarters = async () => {
    setError(null);
    setSaved(false);
    try {
      for (const [date, text] of Object.entries(quarters)) {
        const value = text.trim() === "" ? null : parseKr(text);
        if (text.trim() !== "" && value === null) return setError(`Skriv värdet ${quarterLabel(date)} i kronor.`);
        const before = data.quarters.find((q) => q.date === date)?.valueOre ?? null;
        if (value !== before) setData(await sendJson<IskSettings>("PUT", `/tax/isk/quarters/${date}`, { valueOre: value }));
      }
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 border-t border-hairline pt-4" data-testid="isk-rules">
      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold">ISK: schablonränta och fribelopp</h3>
        <p className="text-[12px] leading-snug text-ink-2">
          Räntan är statslåneräntan den 30 november året innan plus 1 procentenhet, lägst 1,25 % (Riksgälden sätter statslåneräntan i början av december). Skatten är
          30 % av schablonintäkten.
        </p>
        <ul className="divide-y divide-hairline text-[13px]">
          {[...data.rules].reverse().map((r) => (
            <li key={r.year} data-rule={r.year} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
              <span className="w-10 font-semibold tabular-nums">{r.year}</span>
              <span className={cn("w-24 tabular-nums", r.rateBp === null && "text-caution-text")}>{r.rateBp === null ? "räntan saknas" : pct(r.rateBp)}</span>
              <span className="w-36 tabular-nums text-ink-2">{r.allowanceOre ? `fribelopp ${kr(r.allowanceOre)}` : "inget fribelopp"}</span>
              <span className="min-w-0 flex-1 basis-48 text-[11px] text-ink-3">{r.source}</span>
              <button type="button" className={BUTTON.link} onClick={() => start(r.year)} aria-label={`Ändra ISK-regeln för ${r.year}`}>
                Ändra
              </button>
            </li>
          ))}
        </ul>
        {editing !== null ? (
          <div className="space-y-3 rounded-inset bg-card p-3" data-testid="isk-rule-form">
            <div className="grid gap-3 @[40rem]:grid-cols-[5rem_7rem_9rem_minmax(0,1fr)]">
              <Field label="År">
                <input aria-label="År" inputMode="numeric" disabled={editing !== "new"} className={cn(FIELD, "tabular-nums")} value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
              </Field>
              <Field label="Ränta (%)">
                <input aria-label="Schablonränta" inputMode="decimal" placeholder="3,55" className={cn(FIELD, "text-right tabular-nums")} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
              </Field>
              <Field label="Fribelopp (kr)">
                <input aria-label="Fribelopp" inputMode="decimal" className={cn(FIELD, "text-right tabular-nums")} value={draft.allowance} onChange={(e) => setDraft({ ...draft, allowance: e.target.value })} />
              </Field>
              <Field label="Källa">
                <input aria-label="Källa" placeholder="statslåneräntan 30/11 2025 (2,55 %) + 1" className={FIELD} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={BUTTON.blue} onClick={saveRule}>
                Spara
              </button>
              <button type="button" className={BUTTON.link} onClick={() => setEditing(null)}>
                Avbryt
              </button>
              {error && <span className="text-[12px] text-alarm">{error}</span>}
            </div>
          </div>
        ) : (
          <button type="button" className={BUTTON.link} onClick={() => start(null)}>
            Lägg till år
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold">ISK-värde vid kvartalens början {year}</h3>
        <p className="text-[12px] leading-snug text-ink-2">
          Kapitalunderlaget är värdet 1/1, 1/4, 1/7 och 1/10 plus årets insättningar, delat med fyra. Verktyget räknar själv de kvartal då innehaven finns inlagda; skriv
          av de andra från Avanza. Ett tomt fält räknas av verktyget.
        </p>
        <div className="grid max-w-2xl grid-cols-2 items-end gap-3 @[30rem]:grid-cols-4">
          {QUARTERS.map((q) => {
            const date = `${year}-${q}`;
            return (
              <Field key={date} label={quarterLabel(date)}>
                <input
                  aria-label={`ISK-värde ${quarterLabel(date)} ${year}`}
                  inputMode="decimal"
                  placeholder="räknas"
                  className={cn(FIELD, "text-right tabular-nums")}
                  value={quarters[date] ?? ""}
                  onChange={(e) => (setSaved(false), setQuarters({ ...quarters, [date]: e.target.value }))}
                />
              </Field>
            );
          })}
          <div className="col-span-full flex items-center gap-3">
            <button type="button" className={BUTTON.grey} onClick={saveQuarters}>
              Spara värdena
            </button>
            {saved && <span className="text-[12px] text-positive-text">Sparat</span>}
            {error && editing === null && <span className="text-[12px] text-alarm">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
