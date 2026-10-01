import type { BalanceSheet, SheetRow } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { dm, kr } from "../format";
import { IskTaxBox } from "./IskTax";

const longMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });

/** A bar's share of the largest row, at least 1 % so a small one still shows. */
const share = (ore: number, top: number) => `${top > 0 ? Math.max(1, (Math.max(0, ore) / top) * 100) : 0}%`;

/** A card's debt by the month it is paid (in the bar: this month red, a later one lighter): 'betalas i september 6 514 kr (25/9) · i oktober 3 617 kr (25/10)'. */
function paymentMonths(payments: NonNullable<SheetRow["payments"]>) {
  const months = new Map<string, { amountOre: number; days: string[] }>();
  for (const p of payments) {
    const m = months.get(p.payDate.slice(0, 7)) ?? { amountOre: 0, days: [] };
    m.amountOre += p.amountOre;
    m.days.push(dm(p.payDate));
    months.set(p.payDate.slice(0, 7), m);
  }
  return [...months].filter(([, m]) => m.amountOre > 0);
}

function Row({ row, tone, top, on }: { row: SheetRow; tone: "asset" | "debt"; top: number; on: string }) {
  const months = tone === "debt" && row.payments && !row.unknown ? paymentMonths(row.payments) : [];
  return (
    <li className="py-3" data-row={row.key}>
      <p className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0">
          <span className="font-medium">{row.name}</span> <span className="text-[11px] text-ink-3">{row.basis}</span>
        </span>
        <span className={cn("shrink-0 whitespace-nowrap font-semibold tabular-nums", tone === "debt" && "text-caution-text")}>
          {row.unknown ? <span className="font-normal text-caution-text">okänd</span> : `${tone === "debt" ? "−" : ""}${kr(row.amountOre)}`}
        </span>
      </p>
      {!row.unknown && (
        <div className="mt-1.5 h-1 rounded-full bg-track" aria-hidden>
          {months.length > 0 ? (
            <div className="flex h-1 gap-px overflow-hidden rounded-full" style={{ width: share(row.amountOre, top) }}>
              {months.map(([month, m]) => (
                <span key={month} className={cn("h-full", months.length === 1 || month === on.slice(0, 7) ? "bg-alarm" : "bg-alarm/40")} style={{ flexGrow: m.amountOre, flexBasis: 0 }} />
              ))}
            </div>
          ) : (
            <div className={cn("h-1 rounded-full", tone === "debt" ? "bg-alarm" : "bg-accent")} style={{ width: share(row.amountOre, top) }} />
          )}
        </div>
      )}
      {months.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-2 tabular-nums" data-testid="debt-payments">
          betalas{" "}
          {months.map(([month, m], i) => (
            <span key={month}>
              {i > 0 && " · "}i {longMonth(month)} <b className="font-semibold text-ink">{kr(m.amountOre)}</b> ({m.days.join(", ")})
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

function Rows({ rows, tone, on }: { rows: SheetRow[]; tone: "asset" | "debt"; on: string }) {
  const top = Math.max(0, ...rows.filter((r) => !r.unknown).map((r) => r.amountOre));
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((r) => (
        <Row key={r.key} row={r} tone={tone} top={top} on={on} />
      ))}
    </ul>
  );
}

/**
 * Balansräkningen as two cards: Tillgångar, each row with a bar against
 * the largest, and Skulder with the cards' debts in red (a card's split by
 * the month it is paid) and the student loan apart in a grey box.
 */
export function Sheet({ data, showIlliquid }: { data: BalanceSheet; showIlliquid: boolean }) {
  return (
    <div role="group" aria-label="Balansräkning" className="grid gap-5 lg:grid-cols-2">
      <Card aria-labelledby="assets-title" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="assets-title" className="text-base font-semibold">
            Tillgångar
          </h2>
          <span className="text-[15px] font-bold tabular-nums">{kr(data.totals.liquidOre + (showIlliquid ? data.totals.illiquidOre : 0))}</span>
        </div>
        <Rows rows={data.liquid} tone="asset" on={data.on} />
        <IskTaxBox />
        {showIlliquid && data.illiquid.length > 0 && (
          <div className="mt-2 border-t border-hairline pt-3">
            <h3 className="text-xs font-medium text-ink-2">Illikvida tillgångar</h3>
            <Rows rows={data.illiquid} tone="asset" on={data.on} />
            <p className="text-[11px] text-ink-3">Värda något, men inte pengar förrän någon köper dem. Därför på egen rad.</p>
          </div>
        )}
      </Card>

      <Card aria-labelledby="debts-title" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="debts-title" className="text-base font-semibold">
            Skulder
          </h2>
          <span className="text-[15px] font-bold text-caution-text tabular-nums">−{kr(data.totals.debtsOre)}</span>
        </div>
        {data.debts.length > 0 ? <Rows rows={data.debts} tone="debt" on={data.on} /> : <p className="py-3 text-[13px] text-ink-2">Inga skulder utöver studielånet.</p>}
        {data.csn && (
          <div className="mt-2 rounded-inset bg-card-inset px-3.5 py-3" data-testid="csn-loan">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <div className="min-w-0">
                <h3 className="inline font-medium">Studielån · {data.csn.name}</h3> <span className="text-[11px] text-ink-3">{data.csn.basis}</span>
              </div>
              <span className="shrink-0 whitespace-nowrap font-semibold text-ink-2 tabular-nums">−{kr(data.csn.amountOre)}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-2">Står utanför den stora siffran: det är en skuld mot en livsinkomst, inte mot årets pengar.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
