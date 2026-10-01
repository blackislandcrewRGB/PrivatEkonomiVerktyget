import type { ApiCosts as ApiCostsData } from "../../api";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { openTransactions } from "../../shell/openTransactions";
import { kr, monthShort } from "./format";

const longMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });

/** Provider colours by their place over the year, the largest first (tokens, so both themes). */
const PROVIDER_COLOURS = ["var(--v2-caution)", "var(--v2-job)", "var(--v2-positive)", "var(--v2-yellow)", "var(--v2-accent)", "var(--v2-alarm)", "var(--v2-eating-out)"];

/** The donut: r 48, 16 wide, around a 130 px box. */
const R = 48;
const C = 2 * Math.PI * R;

/**
 * API-kostnader: what the category API has cost per provider over the last
 * 12 months as a donut with the total in the middle, beside it a table of
 * this month and the 12 per provider, and under it a small bar per month
 * (this month in full colour) that opens that month's rows. Nothing is
 * shown without the category or without any cost in a year.
 */
export function ApiCosts({ data: d, className }: { data: ApiCostsData | null; className?: string }) {
  if (!d || d.categoryId == null || (!d.year && !d.thisMonth)) return null;

  const color = new Map(d.providers.map((p, i) => [p.name, PROVIDER_COLOURS[i % PROVIDER_COLOURS.length]]));
  const max = Math.max(1, ...d.months.map((m) => m.total));
  const open = (month: string) => openTransactions({ period: month, categoryId: String(d.categoryId) });
  const yearTotal = d.providers.reduce((s, p) => s + Math.max(0, p.year), 0);
  let at = 0;
  const segments = d.providers
    .filter((p) => p.year > 0)
    .map((p) => {
      const len = yearTotal ? (C * p.year) / yearTotal : 0;
      const seg = { name: p.name, dash: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, offset: (-at).toFixed(2) };
      at += len;
      return seg;
    });

  return (
    <Card aria-labelledby="api-costs-title" className={cn("flex flex-col gap-3 sm:py-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="api-costs-title" className="text-base font-semibold">
          API-kostnader
        </h2>
        <p className="text-xs text-ink-2 tabular-nums">
          {longMonth(d.month)} hittills <b className="font-semibold text-ink">{kr(d.thisMonth)}</b> · snitt {kr(d.averagePerMonth)}/mån · 12 månader {kr(d.year)}
        </p>
      </div>

      <div className="flex flex-col items-center gap-[18px] sm:flex-row">
        <svg
          width="130"
          height="130"
          viewBox="0 0 130 130"
          role="img"
          aria-label={`Fördelning de senaste 12 månaderna, ${kr(d.year)}: ${d.providers.map((p) => `${p.name} ${kr(p.year)}`).join(", ")}.`}
          className="shrink-0"
        >
          <g transform="rotate(-90 65 65)" fill="none" strokeWidth="16">
            <circle cx="65" cy="65" r={R} className="stroke-track" />
            {segments.map((s) => (
              <circle key={s.name} cx="65" cy="65" r={R} stroke={color.get(s.name)} strokeDasharray={s.dash} strokeDashoffset={s.offset} data-provider={s.name} />
            ))}
          </g>
          <text x="65" y="63" textAnchor="middle" fontSize="16" fontWeight="700" className="fill-ink">
            {kr(d.year).replace(/\s*kr$/, "")}
          </text>
          <text x="65" y="79" textAnchor="middle" fontSize="10" className="fill-ink-2">
            kr / 12 mån
          </text>
        </svg>

        <table className="w-full min-w-0 flex-1 text-xs">
          <thead>
            <tr className="text-[10px] text-ink-3">
              <th className="pb-1.5 text-left font-normal">Provider</th>
              <th className="pb-1.5 text-right font-normal">{longMonth(d.month)}</th>
              <th className="pb-1.5 text-right font-normal">12 månader</th>
            </tr>
          </thead>
          <tbody>
            {d.providers.map((p) => (
              <tr key={p.name} className="border-t border-hairline">
                <td className="py-1">
                  <span className="inline-flex items-center gap-[7px]">
                    <span className="size-2 rounded-full" style={{ background: color.get(p.name) }} aria-hidden />
                    {p.name}
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{p.thisMonth ? kr(p.thisMonth) : <span className="text-ink-3">–</span>}</td>
                <td className="py-1 text-right font-semibold tabular-nums">{kr(p.year)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-12 items-end gap-1 border-t border-hairline pt-2.5" data-testid="api-cost-bars">
        {d.months.map((m) => (
          <button
            key={m.month}
            type="button"
            onClick={() => open(m.month)}
            className="group flex h-8 flex-col items-stretch justify-end"
            title={`${longMonth(m.month)} ${m.month.slice(0, 4)}: ${kr(m.total)}${Object.entries(m.byProvider)
              .sort(([, a], [, b]) => b - a)
              .map(([name, ore]) => `\n${name} ${kr(ore)}`)
              .join("")}\nVisa raderna.`}
            aria-label={`${longMonth(m.month)}: ${kr(m.total)}`}
          >
            <span
              className={cn("min-h-0.5 rounded-[3px] bg-accent group-hover:opacity-100", m.month === d.month ? "opacity-100" : m.total > 0 ? "opacity-55" : "opacity-15")}
              style={{ height: `${(Math.max(0, m.total) / max) * 100}%` }}
            />
          </button>
        ))}
        {d.months.map((m) => (
          <span key={m.month} className="text-center text-[9px] text-ink-3">
            {monthShort(`${m.month}-01`)}
          </span>
        ))}
      </div>
    </Card>
  );
}
