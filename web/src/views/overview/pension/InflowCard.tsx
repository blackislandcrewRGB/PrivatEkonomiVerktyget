import type { PensionInflow } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { useWidth } from "../../../lib/useWidth";
import { dm, kr } from "../format";
import { inflowParts } from "./inflowBar";

const PENSIONABLE_SHARE = 0.93;
const pct = (v: number) => `${(v * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;
/** '4 477' without 'kr', for a label inside the bar. */
const bare = (ore: number) => kr(ore).replace(/\s*kr$/, "");
/** Room for a label at about 6,5 px a character and the padding. */
const fits = (text: string, px: number) => px >= text.length * 6.5 + 16;

/**
 * Det avsätts till din pension: what the salary sets aside each month, part
 * by part in a bar and as rows with the rule and when it is credited —
 * nothing about what it becomes. The SAF-LO premium last written down
 * stands beside the worked-out one, so the two can be compared.
 */
export function InflowCard({ inflow: f, className }: { inflow: PensionInflow; className?: string }) {
  const [ref, width] = useWidth(560);
  const parts = inflowParts(f);
  const sum = parts.reduce((s, p) => s + Math.max(0, p.ore), 0);
  const base = f.baseAmount;
  const rows = [
    { ...parts[0], rule: "16 % av pensionsgrundande inkomst", credited: "krediteras årsvis, i december året efter", note: undefined as string | undefined },
    {
      ...parts[1],
      rule: "2,5 % av pensionsgrundande inkomst",
      credited: "krediteras årsvis, i december året efter",
      note: f.premiumFunds.length ? `nya avsättningar går till samma fond som i dag (${f.premiumFunds.join(", ")}) så länge fondvalet inte ändras` : undefined,
    },
    {
      ...parts[2],
      rule: "4,5 % av bruttolönen",
      credited: "betalas in månadsvis",
      note: f.safLoLatest ? `senast registrerade premie ${kr(f.safLoLatest.amountOre)}${f.safLoLatest.date ? ` (${dm(f.safLoLatest.date)})` : ""}` : undefined,
    },
  ];

  return (
    <Card aria-labelledby="inflow-title" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="inflow-title" className="text-base font-semibold">
          Det avsätts till din pension
        </h2>
        <p className="text-[22px] font-bold tabular-nums" data-testid="inflow-total">
          ~{bare(f.totalOre)} <span className="text-[13px] font-normal text-ink-2">kr/mån</span>
        </p>
      </div>

      <div ref={ref} className="flex h-6 gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`Varje månad: ${parts.map((p) => `${p.name.toLocaleLowerCase("sv")} ${kr(p.ore)}`).join(", ")}.`} data-testid="inflow-bar">
        {parts.map((p) => {
          const px = sum > 0 ? (Math.max(0, p.ore) / sum) * width : 0;
          const label = fits(`${p.short} ${bare(p.ore)}`, px) ? `${p.short} ${bare(p.ore)}` : fits(bare(p.ore), px) ? bare(p.ore) : "";
          return (
            <div
              key={p.key}
              data-part={p.key}
              className={cn("flex min-w-1 items-center overflow-hidden whitespace-nowrap px-2.5 text-[11px] font-semibold", p.colour)}
              style={{ flexGrow: sum > 0 ? Math.max(0, p.ore) / sum : 1, flexBasis: 0 }}
            >
              {label}
            </div>
          );
        })}
      </div>

      <ul className="divide-y divide-hairline border-t border-hairline">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 py-3" data-inflow={r.key}>
            <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.colour.split(" ")[0])} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{r.name}</span>
              <span className="block text-[11px] text-ink-2">
                {r.rule} · {r.credited}
                {r.note && ` · ${r.note}`}
              </span>
            </span>
            <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums">{kr(r.ore)}/mån</span>
          </li>
        ))}
      </ul>

      <p className="rounded-inset bg-card-inset px-3.5 py-3 text-[11px] text-ink-2">
        Ingen antagen avkastning, bara det som sätts av. Räknat på snittet av {f.payslips} lönespec{f.payslips === 1 ? "" : "ar"} ({dm(f.from)}–{dm(f.to)}): bruttolön {kr(f.grossOre)}/mån,
        pensionsgrundande inkomst {kr(f.pensionableOre)}/mån (brutto × {pct(PENSIONABLE_SHARE)}
        {f.capped ? ", begränsad av taket" : ""}). Taket är 7,5 inkomstbasbelopp = {kr(f.capOre)}/år, med inkomstbasbeloppet {kr(base.amountOre)} för {base.year} ({base.source})
        {base.year !== f.forYear ? ` — beloppet för ${f.forYear} är inte inlagt än` : ""}.
      </p>
    </Card>
  );
}
