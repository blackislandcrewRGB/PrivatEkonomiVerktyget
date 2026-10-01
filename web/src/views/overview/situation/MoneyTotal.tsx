import type { BalanceSheet } from "../../../api";
import { Card } from "../../../components/Card";
import { Switch } from "../../../components/Switch";
import { cn } from "../../../lib/cn";
import { kr } from "../format";
import { moneyParts } from "./moneyBar";

/**
 * Pengar totalt: the money (bank, ISK securities and cash) large, the two
 * nets as pills beside the switch for the illiquid, and a bar of what the
 * figure is made of with its legend.
 */
export function MoneyTotal({ data, showIlliquid, onIlliquid }: { data: BalanceSheet; showIlliquid: boolean; onIlliquid: (on: boolean) => void }) {
  const t = data.totals;
  const netExCsn = showIlliquid ? t.netExCsnWithIlliquidOre : t.netExCsnOre;
  const netIncCsn = showIlliquid ? t.netIncCsnWithIlliquidOre : t.netIncCsnOre;
  const money = t.moneyOre + (showIlliquid ? t.illiquidOre : 0);
  const parts = moneyParts(data, showIlliquid);
  const sum = parts.reduce((s, p) => s + Math.max(0, p.ore), 0);
  const illiquidNames = data.illiquid.map((r) => r.name.toLocaleLowerCase("sv")).join(", ");

  return (
    <Card aria-labelledby="networth-title" className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-4 @[40rem]:flex-row @[40rem]:items-start @[40rem]:justify-between">
        <div className="min-w-0">
          <h2 id="networth-title" className="text-[13px] font-medium text-ink-2">
            Pengar totalt
          </h2>
          {/* Neutral on purpose: this is what is, not something that went up. */}
          <p className={cn("mt-1 text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums", money < 0 && "text-alarm")}>{kr(money)}</p>
          <p className="mt-2 text-xs text-ink-2">
            bankkontona, värdepapperen och likviderna på ISK{showIlliquid ? " och det illikvida" : ""} · din del, aldrig hushållets
          </p>
        </div>
        <div className="flex flex-col gap-3 @[40rem]:items-end">
          {data.illiquid.length > 0 && (
            <Switch checked={showIlliquid} onCheckedChange={onIlliquid}>
              Visa illikvida{illiquidNames ? ` (${illiquidNames})` : ""}
            </Switch>
          )}
          <p className="flex flex-wrap gap-2 text-xs @[40rem]:justify-end" data-testid="networth-line">
            <span className="rounded-full bg-card-inset px-3 py-1 text-ink-2">
              Nettoförmögenhet exkl. CSN <b className={cn("font-semibold tabular-nums", netExCsn < 0 ? "text-caution-text" : "text-ink")}>{kr(netExCsn)}</b>
            </span>{" "}
            <span className={cn("rounded-full px-3 py-1 text-ink-2", netIncCsn < 0 ? "bg-alarm-soft" : "bg-card-inset")}>
              med CSN <b className={cn("font-semibold tabular-nums", netIncCsn < 0 ? "text-caution-text" : "text-ink")}>{kr(netIncCsn)}</b>
            </span>
          </p>
        </div>
      </div>

      {parts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]"
            role="img"
            aria-label={`Pengar totalt fördelat: ${parts.map((p) => `${p.name} ${kr(p.ore)}`).join(", ")}.`}
            data-testid="networth-bar"
          >
            {parts.map((p) => (
              <div key={p.key} data-part={p.key} className={cn("min-w-1", p.colour)} style={{ flexGrow: sum > 0 ? Math.max(0, p.ore) / sum : 1, flexBasis: 0 }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5 whitespace-nowrap">
                <span aria-hidden className={cn("size-2 rounded-full", p.colour)} />
                {p.name} <b className="font-semibold text-ink tabular-nums">{kr(p.ore)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.notes.length > 0 && (
        <ul className="space-y-1 border-t border-hairline pt-3 text-xs text-caution-text">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
