import { useState, type ReactNode } from "react";
import { getJson, type TaxRefund } from "../../api";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/cn";
import { openSettings } from "../../shell/routes";

/** Whole kronor, from kronor: '61 833 kr'. */
export const krk = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("sv-SE")} kr`;
const pct = (fraction: number) => `${(fraction * 100).toLocaleString("sv-SE", { maximumFractionDigits: 3 })} %`;
const dmy = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))} ${iso.slice(0, 4)}`;

/** A line of the arithmetic: the operator is in the label ('− Grundavdrag'), the amount without a sign. */
function Row({ label, value, note, strong }: { label: ReactNode; value: number | null; note?: string; strong?: boolean }) {
  return (
    <tr className={cn(strong && "border-t border-hairline font-semibold")}>
      <td className="py-0.5 pr-2 align-top">
        {label}
        {note && <span className="block text-[10px] font-normal text-ink-3">{note}</span>}
      </td>
      <td className="py-0.5 text-right align-top tabular-nums">{value === null ? "–" : krk(value)}</td>
    </tr>
  );
}

/**
 * The refund's arithmetic, step by step as Skatteverket counts: what goes
 * in and where it comes from, the final tax with its roundings, the
 * preliminary tax paid, and what is left. Always an estimate.
 */
export function TaxRefundTable({ r }: { r: TaxRefund }) {
  const t = r.finalTax;
  const i = r.input;
  const p = r.preliminary;
  return (
    <div className="space-y-2 text-[12px]" data-testid="tax-refund-breakdown">
      <p className="font-semibold">
        Skatten för {r.incomeYear} <span className="rounded-full bg-caution-soft px-1.5 py-px text-[10px] font-medium text-caution-text">uppskattning</span>
      </p>
      <table className="w-full">
        <tbody>
          <Row label="Lön (1.1)" value={i.salary.value} note={i.salary.from} />
          <Row label="− Reseavdrag (2.1)" value={i.commuteDeduction.value} note={i.commuteDeduction.from} />
          {t && (
            <>
              <Row label="= Fastställd förvärvsinkomst" value={t.ffi} strong />
              <Row label="− Grundavdrag" value={t.basicDeduction} note="uppåt till hundratal" />
              <Row label="= Beskattningsbar förvärvsinkomst" value={t.bfi} note="nedåt till hundratal" strong />
              <Row label={`Kommunal skatt ${pct(t.ki)}`} value={t.municipalTax} />
              <Row label="Begravningsavgift" value={t.burialFee} />
              {t.churchFee > 0 && <Row label="Kyrkoavgift" value={t.churchFee} />}
              {t.stateTax > 0 && <Row label="Statlig skatt 20 %" value={t.stateTax} />}
              <Row label="Allmän pensionsavgift 7 %" value={t.pensionFee} />
              <Row label="Public service-avgift" value={t.publicService} />
              <Row label={`Kapital ${krk(t.capitalSurplus)} × 30 %`} value={t.capitalTax} note={`7.1 ${krk(i.iskStandardIncome.value)} + 7.2 ${krk(i.capitalIncome.value)} − 8.1 ${krk(i.capitalExpenses.value)}`} />
              <Row label="− Reduktion för pensionsavgiften" value={t.pensionFeeReduction} />
              <Row label="− Jobbskatteavdrag" value={t.jobTaxCredit} note={`arbetsinkomst ${krk(t.workIncome)}`} />
              <Row label="− Reduktion för förvärvsinkomst" value={t.earnedIncomeReduction} />
              {t.capitalDeficitReduction > 0 && <Row label="− Reduktion för kapitalunderskott" value={t.capitalDeficitReduction} />}
              <Row label="= Slutlig skatt" value={t.total} strong />
            </>
          )}
          {p && (
            <>
              <Row label="Preliminärskatt på lönespecarna" value={p.payslips} note={`${p.payslipMonths} ${p.payslipMonths === 1 ? "spec" : "specar"}`} />
              {p.forecastMonths > 0 && <Row label="+ inlagda månader, prognosens skatt" value={p.forecast} note={`${p.forecastMonths} mån`} />}
              {p.estimatedMonths > 0 && <Row label="+ övriga månader, specarnas andel" value={p.estimated} note={`${p.estimatedMonths} mån`} />}
              <Row label="+ bankens 30 % på räntan (7.2)" value={p.bank} />
              <Row label="= Preliminärskatt" value={p.total} strong />
            </>
          )}
        </tbody>
      </table>
      {r.refund !== null ? (
        <p className={cn("rounded-inset px-2.5 py-1.5 font-semibold", r.refund >= 0 ? "bg-positive-soft text-positive-text" : "bg-alarm-soft text-alarm")} data-figure="refund">
          {r.refund >= 0 ? "Återbäring" : "Kvarskatt"} {krk(Math.abs(r.refund))} · {dmy(r.payDate)}
        </p>
      ) : (
        <p className="text-ink-2">{r.missing ?? (p ? "" : `Preliminärskatten för ${r.incomeYear} finns inte i verktyget (inga lönespecar det året), så bara den slutliga skatten räknas.`)}</p>
      )}
      <p className="text-[10px] leading-snug text-ink-3">
        Bara raderna ovan är med: andra avdrag och reduktioner, räntor på skattekontot och ändringar Skatteverket gör syns först i slutskattebeskedet. Satser och belopp:{" "}
        <button type="button" className="font-semibold text-accent hover:underline" onClick={() => openSettings("lon")}>
          Inställningar › Lön
        </button>
        .
      </p>
    </div>
  );
}

/** A button that opens the year's arithmetic in a popover, fetched when opened. */
export function TaxRefundPopover({ year, children, className }: { year: number; children: ReactNode; className?: string }) {
  const [data, setData] = useState<TaxRefund | null>(null);
  return (
    <Popover onOpenChange={(o) => o && !data && getJson<TaxRefund>(`/tax/refund/${year}`).then(setData, () => setData(null))}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("font-semibold text-accent hover:underline", className)}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] max-w-[calc(100vw-2rem)] border-hairline bg-card text-ink" aria-label={`Uträkning av skatten för ${year}`}>
        {data ? <TaxRefundTable r={data} /> : <p className="text-[12px] text-ink-3">Räknar …</p>}
      </PopoverContent>
    </Popover>
  );
}
