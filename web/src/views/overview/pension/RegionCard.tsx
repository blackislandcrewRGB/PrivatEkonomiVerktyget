import type { PensionOverview } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { kr } from "../format";
import { CIRCUMFERENCE, R, donutSegments, regionName } from "./regions";

const percent = (share: number) => `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

/**
 * Placerbart kapital per region: the funds chosen, as a donut with the sum
 * in the middle and a legend with the share and the amount. The tilt
 * against the policy, when there is one, in an orange box.
 */
export function RegionCard({ data, className }: { data: Pick<PensionOverview, "regions" | "placeableOre" | "notes">; className?: string }) {
  const segments = donutSegments(data.regions);
  return (
    <Card aria-labelledby="regions-title" className={cn("flex flex-col gap-4", className)}>
      <h2 id="regions-title" className="text-base font-semibold">
        Placerbart kapital per region
      </h2>
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <svg
          width="130"
          height="130"
          viewBox="0 0 130 130"
          role="img"
          aria-label={`Placerbart ${kr(data.placeableOre)}: ${segments.map((s) => `${regionName(s.region)} ${percent(s.share)}, ${kr(s.amountOre)}`).join("; ")}.`}
          className="shrink-0"
          data-testid="region-donut"
        >
          <g transform="rotate(-90 65 65)" fill="none" strokeWidth="16">
            <circle cx="65" cy="65" r={R} className="stroke-track" />
            {segments.map((s) => (
              <circle key={s.region} cx="65" cy="65" r={R} stroke={s.colour} strokeDasharray={`${s.length.toFixed(2)} ${(CIRCUMFERENCE - s.length).toFixed(2)}`} strokeDashoffset={s.offset.toFixed(2)} data-region={s.region} />
            ))}
          </g>
          <text x="65" y="63" textAnchor="middle" fontSize="15" fontWeight="700" className="fill-ink">
            {kr(data.placeableOre).replace(/\s*kr$/, "")}
          </text>
          <text x="65" y="79" textAnchor="middle" fontSize="10" className="fill-ink-2">
            kr placerbart
          </text>
        </svg>
        <ul className="w-full min-w-0 flex-1 space-y-2 text-[13px]">
          {segments.map((s) => (
            <li key={s.region} className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: s.colour }} />
              <span className="flex-1">
                {regionName(s.region)} <b className="font-semibold tabular-nums">{percent(s.share)}</b>
              </span>
              <span className="text-ink-2 tabular-nums">{kr(s.amountOre)}</span>
            </li>
          ))}
        </ul>
      </div>
      {data.notes.map((n) => (
        <p key={n} className="flex gap-2 rounded-inset bg-caution-soft px-3.5 py-3 text-xs text-ink" role="note">
          <b aria-hidden className="font-bold text-caution-text">
            !
          </b>
          {n}
        </p>
      ))}
    </Card>
  );
}
