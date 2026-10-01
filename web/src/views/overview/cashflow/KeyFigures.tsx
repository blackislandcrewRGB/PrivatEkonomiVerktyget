import type { ReactNode } from "react";
import type { Cashflow as Data } from "../../../api";
import { Card } from "../../../components/Card";
import { Switch } from "../../../components/Switch";
import { cn } from "../../../lib/cn";
import { dm, kr, plusDays } from "../format";

/** What the Avanza part of today's figure is: the cash entered, plus what was moved there since. */
function liquidTitle(l: Data["liquid"]): string {
  const parts = l.accounts.map((a) => `likvida på ${a.name} ${kr(a.ore)} (inlagt ${dm(a.date)})`);
  if (l.depositedOre && l.since) parts.push(`${l.depositedOre > 0 ? "insatt" : "uttaget"} sedan ${dm(l.since)} ${kr(Math.abs(l.depositedOre))}`);
  return `${parts.join(", ")}. Går att föra över till banken vilken dag som helst, och en överföring till Avanza stannar i samma pott.`;
}

/** Whether the lowest day is the day before a salary comes in. */
export function lowestBeforeSalary(data: Pick<Data, "lowest" | "days">): boolean {
  const next = data.days.find((d) => d.date === plusDays(data.lowest.date, 1));
  return !!next?.events.some((e) => e.kind === "income" && /^lön/i.test(e.name));
}

const signedKr = (ore: number) => `${ore > 0 ? "+" : ""}${kr(ore)}`;

function Figure({ label, value, note, tone, title }: { label: string; value: string; note?: ReactNode; tone: "grey" | "orange" | "green"; title?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-inset px-3.5 py-3",
        tone === "grey" && "bg-card-inset",
        tone === "orange" && "bg-caution-soft",
        tone === "green" && "bg-positive-soft",
      )}
    >
      <p className={cn("text-[11px]", tone === "grey" && "text-ink-2", tone === "orange" && "text-caution-text", tone === "green" && "text-positive-text")}>{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {note && (
        <p className="mt-0.5 truncate text-[11px] text-ink-2 tabular-nums" title={title}>
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Kassaflöde's first card: safe to spend (the lowest point minus the buffer)
 * large, today, the lowest point and the 90th day in three boxes, the two
 * switches with the daily pace beside them, and the curve under it all.
 */
export function KeyFigures({
  data,
  partner,
  onPartner,
  onFoodOnly,
  onBuffer,
  children,
}: {
  data: Data;
  partner: boolean;
  onPartner: (on: boolean) => void;
  onFoodOnly: (on: boolean) => void;
  onBuffer: () => void;
  children?: ReactNode;
}) {
  const end = data.days.at(-1)!;
  const bank = data.start - data.liquid.totalOre;
  return (
    <Card aria-labelledby="cashflow-title" className="@container flex flex-col gap-5">
      <div className="flex flex-col gap-5 @[52rem]:flex-row @[52rem]:items-start @[52rem]:justify-between">
        <div className="shrink-0">
          <h2 id="cashflow-title" className="text-[13px] font-medium text-ink-2">
            Safe to spend
          </h2>
          <p className={cn("mt-1 text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums", data.safeToSpend < 0 && "text-alarm")} data-testid="safe-to-spend">
            {kr(data.safeToSpend)}
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
            lägsta punkten minus bufferten
            <span className="rounded-full bg-card-inset px-2 py-0.5 font-semibold text-ink tabular-nums">{kr(data.buffer)}</span>
            <button type="button" className="text-accent hover:underline" onClick={onBuffer}>
              ändra
            </button>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 @[34rem]:grid-cols-3 @[52rem]:w-[42rem]" data-testid="cashflow-figures">
          <Figure
            tone="grey"
            label={`I dag ${dm(data.today)}`}
            value={kr(data.start)}
            note={data.liquid.totalOre > 0 ? `bank ${kr(bank)} · Avanza ${kr(data.liquid.totalOre)}` : undefined}
            title={data.liquid.totalOre > 0 ? liquidTitle(data.liquid) : undefined}
          />
          <Figure tone="orange" label={`Lägsta punkt · ${dm(data.lowest.date)}`} value={kr(data.lowest.balance)} note={lowestBeforeSalary(data) ? "dagen före lönen" : undefined} />
          <Figure tone="green" label={`Om 90 dagar · ${dm(end.date)}`} value={kr(end.balance)} note={`${signedKr(end.balance - data.start)} från i dag`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch
          checked={data.foodOnly}
          onCheckedChange={onFoodOnly}
          title="Efter ett stort köp: räkna bara med maten på kortet, som betalas med kortfakturan. Från banken dras bara bränslet. Hyran, de fasta utgifterna och kortfakturorna räknas alltid. Kommer ihåg valet."
        >
          Räkna bara med mat på kortet
        </Switch>
        <Switch checked={partner} onCheckedChange={onPartner}>
          Räkna med betalningar från {data.partnerName} (uppskattade)
        </Switch>
        <p className="text-xs text-ink-2 @[40rem]:ml-auto">
          Rörliga utgifter <b className="font-semibold text-ink tabular-nums">{kr(data.variable.perDay)}/dag</b> dras varje dag
        </p>
      </div>
      {children}
    </Card>
  );
}
