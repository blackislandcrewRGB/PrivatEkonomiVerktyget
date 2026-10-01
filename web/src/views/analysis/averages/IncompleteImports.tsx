import { navigate } from "../../../shell/routes";
import { monthLabel } from "../common";

const SOURCE: Record<string, string> = { swedbank: "Swedbank", norwegian: "Bank Norwegian", mastercard: "Mastercard" };

/**
 * Snitt's warning (Design v2): the period has months an account is only
 * partly imported for, so the averages may come out too low. An orange row
 * with Importera › to the imports; nothing when every month is whole.
 */
export function IncompleteImports({ incomplete }: { incomplete: { source: string; months: string[] }[] }) {
  if (incomplete.length === 0) return null;
  const what = incomplete.map((i) => `${SOURCE[i.source] ?? i.source} ${i.months.map((m) => monthLabel(m).replace(".", "")).join(", ")}`).join("; ");
  return (
    <p className="flex items-start gap-2.5 rounded-inset bg-caution-soft px-4 py-3 text-[13px] text-ink-2" role="note" aria-label="Ofullständig import">
      <span aria-hidden className="w-2 shrink-0 text-center font-bold text-caution-text">
        !
      </span>
      <span className="min-w-0 flex-1">Perioden innehåller månader med ofullständig import: {what}. Snitten kan bli för låga.</span>
      <button type="button" onClick={() => navigate("imports")} className="shrink-0 whitespace-nowrap font-medium text-accent hover:underline">
        Importera ›
      </button>
    </p>
  );
}
