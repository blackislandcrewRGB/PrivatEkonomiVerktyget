import { useEffect, useState } from "react";
import { getJson, sendJson } from "../../../api";
import { cn } from "../../../lib/cn";
import { BUTTON, FIELD } from "../ui";

/**
 * When the tax refund is expected: a day the year after the income year
 * (10 June by default; with a return filed digitally by the end of March
 * and nothing changed, Skatteverket pays in April).
 */
export function RefundDay() {
  const [day, setDay] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    getJson<{ settings: { payoutDay: string } }>("/tax/refund").then(
      (d) => (setDay(d.settings.payoutDay), setDraft(d.settings.payoutDay)),
      () => setDay(null),
    );
  }, []);
  if (day === null) return null;
  const save = async () => {
    try {
      const s = await sendJson<{ payoutDay: string }>("PUT", "/tax/refund/settings", { payoutDay: draft.trim() });
      setDay(s.payoutDay);
      setNote({ text: "Sparat", error: false });
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-4 text-[13px]" data-testid="refund-day">
      <span className="min-w-0 flex-1 basis-64">
        <span className="font-semibold">Skatteåterbäringen väntas</span>
        <span className="block text-[11px] text-ink-3">dagen året efter inkomståret (MM-DD); i Kassaflöde när den är inom 90 dagar, annars i Framåt</span>
      </span>
      <input aria-label="Dag för skatteåterbäringen" className={cn(FIELD, "w-24 text-center tabular-nums")} value={draft} onChange={(e) => (setNote(null), setDraft(e.target.value))} />
      <button type="button" className={BUTTON.grey} onClick={save} disabled={draft.trim() === day}>
        Spara
      </button>
      {note && <span className={cn("text-[12px]", note.error ? "text-alarm" : "text-positive-text")}>{note.text}</span>}
    </div>
  );
}
