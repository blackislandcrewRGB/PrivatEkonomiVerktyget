import { shortDate, type SharedMonth } from "../../api";
import { navigate } from "../../shell/routes";
import { monthLabel } from "./summary";

const SOURCE_LABEL: Record<string, string> = { swedbank: "Swedbank", norwegian: "Bank Norwegian", mastercard: "Mastercard", csv: "CSV-filerna" };

/**
 * What the month's figures are missing or unsure of, as an orange box: an
 * account imported only up to a day (with Importera › to the imports), a
 * month before the start, last month not settled, and the server's warnings.
 * Nothing when all is well.
 */
export function Notices({ data }: { data: SharedMonth }) {
  const notices: { text: string; importLink?: boolean }[] = [];
  for (const i of data.incompleteImports) {
    notices.push({
      text: i.importedTo
        ? `${SOURCE_LABEL[i.source] ?? i.source} är importerad till och med ${shortDate(i.importedTo)}. Senare köp saknas (reserverade köp importeras inte).`
        : `${SOURCE_LABEL[i.source] ?? i.source} saknar importperiod.`,
      importLink: true,
    });
  }
  if (data.beforeStart) notices.push({ text: `Före startmånaden (${monthLabel(data.startMonth, true).toLowerCase()}): inget förs vidare härifrån.` });
  if (data.carryFrom && !data.carryFrom.reconciled) notices.push({ text: `${monthLabel(data.carryFrom.month)} är inte avstämd. Ingående belopp är dess aktuella resultat.` });
  notices.push(...data.warnings.map((text) => ({ text })));
  if (notices.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-inset bg-caution-soft px-4 py-3 text-[13px] text-ink-2" aria-label="Att känna till">
      {notices.map((n) => (
        <li key={n.text} className="flex items-start gap-2.5">
          <span aria-hidden className="w-2 shrink-0 text-center font-bold text-caution-text">
            !
          </span>
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.importLink && (
            <button type="button" onClick={() => navigate("imports")} className="shrink-0 whitespace-nowrap font-medium text-accent hover:underline">
              Importera ›
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
