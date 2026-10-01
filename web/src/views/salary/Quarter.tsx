import { TriangleAlert } from "lucide-react";
import type { SalaryModel } from "../../api";
import { kr } from "../overview/format";
import { h, monthName, monthShort } from "./format";

/** 'en timme till är värd 200 kr brutto; från 199,3 tim 300 kr', or null when the quarter already passes. */
export const hourValue = (t: SalaryModel["thresholds"]) =>
  !t.passes && t.next ? `en timme till är värd ${kr(t.next.before)} brutto; från ${h(t.next.at)} tim ${kr(t.next.after)}` : null;

/** The quarter passes full time on average: the overtime, what it pays and the month it is settled with. */
export function QuarterOvertime({ t }: { t: SalaryModel["thresholds"] }) {
  if (!t.passes || !t.quarter) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-[10px] bg-caution-soft px-3 py-2 text-[12px] text-caution-text" data-testid="quarter-overtime">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Kvartalet passerar heltid i snitt: {h(t.quarter.hours)} tim mot {h(t.quarter.limit)} ({h(t.fullTimeHours)} × 3,{" "}
        {t.quarter.months.map((q) => `${monthShort(q.month)} ${h(q.hours)}${q.entered ? "" : " antaget"}`).join(", ")}). {h(t.quarter.over)} tim är övertid: mertid
        plus 50 %, {kr(t.overtimeRate)}/tim i stället för {kr(t.mertidRate)}/tim (brutto)
        {t.quarter.settle !== t.quarter.over && `, varav ${h(t.quarter.over - t.quarter.settle)} redan som övertid per pass/vecka`}. Antaget att det regleras med lönen för{" "}
        {monthName(t.quarter.settlesIn)}.
      </span>
    </p>
  );
}
