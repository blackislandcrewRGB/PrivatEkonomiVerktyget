import type { ManualDataItem } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { Row } from "./Row";

/**
 * Behöver fyllas i: what is late, never given or soon due, first and apart,
 * with an orange edge (red when something is late) and a blue Fyll i on
 * each row. Not there at all when nothing needs doing.
 */
export function NeedsCard({ items, thisYear }: { items: ManualDataItem[]; thisYear: string }) {
  if (items.length === 0) return null;
  const late = items.filter((i) => i.status !== "soon").length;
  const soon = items.length - late;
  return (
    <Card aria-labelledby="manual-now" className={cn("@container border-l-4 py-4 sm:py-5", late > 0 ? "border-alarm" : "border-caution")} data-tone={late > 0 ? "late" : "soon"}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline pb-2">
        <h2 id="manual-now" className="text-[15px] font-semibold">
          Behöver fyllas i
        </h2>
        <span className="text-xs font-medium text-caution-text">
          {[late > 0 && `${late} behöver fyllas i`, soon > 0 && `${soon} snart dags`].filter(Boolean).join(" · ")}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {items.map((i) => (
          <Row key={i.key} item={i} thisYear={thisYear} action="button" />
        ))}
      </ul>
    </Card>
  );
}
