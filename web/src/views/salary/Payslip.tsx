import type { SalaryModel } from "../../api";
import { cn } from "../../lib/cn";
import { kr } from "../overview/format";
import { h, rate } from "./format";

/** '17,5 × 200,04', or empty for a line without a quantity. */
const calc = (l: SalaryModel["lines"][number]) => (l.quantity !== null && l.unitPrice !== null ? `${h(l.quantity)} × ${rate(l.unitPrice)}` : "");

/**
 * A month's forecast as a payslip: code, line, how it is reckoned and the
 * amount; Bruttolön and Nettolön in bold under a black line, the tax with
 * where it comes from. On a phone the reckoning goes under the line.
 */
export function Payslip({ m, compact = false }: { m: SalaryModel; compact?: boolean }) {
  const td = "py-1.5 align-baseline";
  const sum = "border-t border-ink font-semibold";
  return (
    <table className="w-full text-[13px]" aria-label="Lönerader">
      <tbody>
        {m.lines.map((l, i) => (
          <tr key={`${l.code}-${i}`} className="border-t border-hairline first:border-t-0">
            <td className={cn(td, "w-12 pr-2 text-[11px] text-ink-3")}>{l.code}</td>
            <td className={cn(td, "pr-3")}>
              {l.name}
              {l.unverified && <span className="ml-2 rounded-full bg-caution-soft px-1.5 py-px text-[10px] font-medium text-caution-text">antagen regel</span>}
              {compact && calc(l) && <span className="block text-[11px] text-ink-3 tabular-nums">{calc(l)}</span>}
            </td>
            {!compact && <td className={cn(td, "whitespace-nowrap pr-3 text-right text-[11px] text-ink-3 tabular-nums")}>{calc(l)}</td>}
            <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>{kr(l.amount)}</td>
          </tr>
        ))}
        <tr className={sum} data-sum="gross">
          <td />
          <td className={td}>Bruttolön</td>
          {!compact && <td />}
          <td className={cn(td, "text-right tabular-nums")}>{kr(m.gross)}</td>
        </tr>
        <tr className="border-t border-hairline">
          <td />
          <td className={td}>
            Skatt
            {compact && <span className="block text-[11px] text-ink-3">{m.taxSource}</span>}
          </td>
          {!compact && <td className={cn(td, "pr-3 text-right text-[11px] text-ink-3")}>{m.taxSource}</td>}
          <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>−{kr(m.tax)}</td>
        </tr>
        <tr className={sum} data-sum="net">
          <td />
          <td className={td}>Nettolön</td>
          {!compact && <td />}
          <td className={cn(td, "text-right tabular-nums")}>{kr(m.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}
