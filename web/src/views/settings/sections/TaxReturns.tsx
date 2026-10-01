import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { getJson, parseKr, sendJson, type TaxReturn, type TaxReturnBoxes } from "../../../api";
import { cn } from "../../../lib/cn";
import { formatKr } from "../../../lib/format";
import { dayMonthYear, TAX_BOXES } from "../../../lib/taxReturns";
import { CompactRow, Field } from "../compact";
import { taxReturnsSummary } from "../summaries";
import { BUTTON, FIELD } from "../ui";
import type { SectionProps } from "./types";
import { IskRules } from "./IskRules";
import { RefundDay } from "./RefundDay";

type Draft = { year: string; submittedAt: string; boxes: Record<keyof TaxReturnBoxes, string> };

const kronor = (ore: number | null) => (ore === null ? "" : String(ore / 100));
const emptyDraft = (year: number): Draft => ({ year: String(year), submittedAt: "", boxes: { employmentIncome: "", commuteDeduction: "", iskStandardIncome: "", capitalIncome: "", capitalExpenses: "" } });
const draftOf = (r: TaxReturn): Draft => ({
  year: String(r.incomeYear),
  submittedAt: r.submittedAt ?? "",
  boxes: Object.fromEntries(TAX_BOXES.map((b) => [b.key, kronor(r.boxes[b.key])])) as Draft["boxes"],
});

/**
 * Deklaration: the income years' returns, one line each with the five boxes.
 * They come from Skatteverket's receipts in Importer; a year can also be
 * entered or corrected here, and is then marked as entered by hand.
 */
export function TaxReturnsSection({ open, onToggle, match }: SectionProps) {
  const [list, setList] = useState<TaxReturn[] | null>(null);
  // The year being changed, 'new' for one being added.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(new Date().getFullYear() - 1));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = () => getJson<TaxReturn[]>("/tax-returns").then(setList, () => setList(null));
  useEffect(() => {
    load();
  }, []);
  if (!list) return null;
  const s = taxReturnsSummary(list);
  if (!match("Deklaration", "deklarationskvittens", "Skatteverket", "inkomstår", "ISK", "schablonränta", "fribelopp", s.summary, s.hint)) return null;

  const start = (r: TaxReturn | null) => {
    setError(null);
    setConfirmDelete(false);
    if (r) {
      setDraft(draftOf(r));
      setEditing(r.incomeYear);
    } else {
      const latest = Math.max(new Date().getFullYear() - 2, ...list.map((x) => x.incomeYear));
      setDraft(emptyDraft(Math.min(latest + 1, new Date().getFullYear() - 1)));
      setEditing("new");
    }
  };
  const save = async () => {
    setError(null);
    const year = Number(draft.year);
    if (!/^\d{4}$/.test(draft.year.trim())) return setError("Skriv inkomståret, till exempel 2025.");
    if (editing === "new" && list.some((r) => r.incomeYear === year)) return setError(`${year} finns redan: ändra det i stället.`);
    const boxes: Record<string, number | null> = {};
    for (const b of TAX_BOXES) {
      const text = draft.boxes[b.key].trim();
      if (!text) boxes[b.key] = null;
      else {
        const ore = parseKr(text);
        if (ore === null) return setError(`Skriv ${b.number} i kronor.`);
        boxes[b.key] = ore;
      }
    }
    try {
      await sendJson("PUT", `/tax-returns/${year}`, { submittedAt: draft.submittedAt.trim() || null, boxes });
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (year: number) => {
    if (!confirmDelete) return setConfirmDelete(true);
    await sendJson("DELETE", `/tax-returns/${year}`, {});
    setEditing(null);
    load();
  };

  const form = (
    <div className="space-y-3 rounded-inset bg-card p-3" data-testid="tax-return-form">
      <div className="grid gap-3 @[40rem]:grid-cols-[6rem_10rem]">
        <Field label="Inkomstår">
          <input
            aria-label="Inkomstår"
            inputMode="numeric"
            disabled={editing !== "new"}
            className={cn(FIELD, "tabular-nums")}
            value={draft.year}
            onChange={(e) => setDraft({ ...draft, year: e.target.value })}
          />
        </Field>
        <Field label="Skickad (ÅÅÅÅ-MM-DD)">
          <input aria-label="Skickad" className={cn(FIELD, "tabular-nums")} placeholder="2026-03-21" value={draft.submittedAt} onChange={(e) => setDraft({ ...draft, submittedAt: e.target.value })} />
        </Field>
      </div>
      <div className="grid items-end gap-3 @[40rem]:grid-cols-5">
        {TAX_BOXES.map((b) => (
          <Field key={b.key} label={`${b.number} ${b.label}`}>
            <input
              aria-label={`${b.number} ${b.label}`}
              inputMode="decimal"
              placeholder="–"
              className={cn(FIELD, "text-right tabular-nums")}
              value={draft.boxes[b.key]}
              onChange={(e) => setDraft({ ...draft, boxes: { ...draft.boxes, [b.key]: e.target.value } })}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON.blue} onClick={save}>
          Spara
        </button>
        <button type="button" className={BUTTON.link} onClick={() => setEditing(null)}>
          Avbryt
        </button>
        {editing !== "new" && editing !== null && (
          <button type="button" className={cn(BUTTON.danger, "ml-auto text-[13px]")} onClick={() => remove(editing)}>
            {confirmDelete ? `Ja, ta bort ${editing}` : "Ta bort året"}
          </button>
        )}
        {error && <span className="basis-full text-[12px] text-alarm">{error}</span>}
      </div>
    </div>
  );

  const th = "px-2 py-1.5 text-right text-[11px] font-medium text-ink-3 first:pl-0";
  return (
    <CompactRow id="deklaration" name="Deklaration" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <div className="space-y-3">
        <p className="text-[12px] leading-snug text-ink-2">
          Raderna ur inkomstdeklarationen per inkomstår, i kronor. Dra Skatteverkets kvittens (Mina sidor › Deklaration) till Importer, eller mata in raderna
          här. Namn, personnummer och kvittensnummer sparas aldrig.
        </p>
        {list.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13px]">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={cn(th, "text-left")}>År</th>
                  <th className={cn(th, "text-left")}>Skickad</th>
                  {TAX_BOXES.map((b) => (
                    <th key={b.key} className={th} title={b.label}>
                      {b.number}
                    </th>
                  ))}
                  <th className={th}>
                    <span className="sr-only">Källa och ändra</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.incomeYear} data-year={r.incomeYear} className="border-b border-hairline last:border-b-0">
                    <td className="py-1.5 pr-2 font-semibold tabular-nums">{r.incomeYear}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink-2 tabular-nums">{r.submittedAt ? dayMonthYear(r.submittedAt) : "–"}</td>
                    {TAX_BOXES.map((b) => (
                      <td key={b.key} className={cn("px-2 py-1.5 text-right whitespace-nowrap tabular-nums", r.boxes[b.key] === null && "text-ink-3")}>
                        {r.boxes[b.key] === null ? "–" : formatKr(r.boxes[b.key]!, { whole: true }).replace(/\s*kr$/, "")}
                      </td>
                    ))}
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      <span
                        className={cn(
                          "mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          r.source === "pdf" ? "bg-accent-soft text-accent" : "bg-card-inset text-ink-2",
                        )}
                      >
                        {r.source === "pdf" ? "kvittens" : "för hand"}
                      </span>
                      <button type="button" className={BUTTON.link} onClick={() => start(r)} aria-label={`Ändra ${r.incomeYear}`}>
                        Ändra
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing !== null ? (
          form
        ) : (
          <button type="button" className={BUTTON.grey} onClick={() => start(null)}>
            <Plus className="size-3.5" aria-hidden /> Lägg till inkomstår
          </button>
        )}
        <RefundDay />
        <IskRules year={new Date().getFullYear()} />
      </div>
    </CompactRow>
  );
}
