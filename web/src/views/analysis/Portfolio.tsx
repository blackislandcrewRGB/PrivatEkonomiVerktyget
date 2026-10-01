import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Wallet } from "lucide-react";
import {
  ACCOUNT_NAMES,
  ZONE_NAMES,
  formatScaled,
  getJson,
  sendJson,
  shortDate,
  sourceName,
  type InstrumentZone,
  type PortfolioValue,
  type PriceSyncResult,
  type ValuedHolding,
} from "../../api";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { BUTTON } from "../settings/ui";
import { CsvButton, Money, pct, wholeKr } from "./common";
import { OpeningDialog } from "./OpeningDialog";
import { CashDialog, InstrumentDialog, InstrumentPanel, TradeDialog } from "./PortfolioDialogs";
import { allocation, type AllocationKey } from "./savings/allocation";

/**
 * Innehav på ISK (Design v2): the portfolio, priced.
 *
 * What it answers is what the money is worth today and how it is divided
 * between the base and the bet zone — not what happened since yesterday.
 * Short movements are noise, so there is no change since the last fetch, no
 * arrow, and nothing coloured green or red. The price carries the day it is
 * from, because a price from Friday shown on a Monday is only honest if it
 * says so.
 */

/** The base blue, the bet zone orange, the cash light blue (tokens, so the dark theme has its own). */
const COLOUR: Record<AllocationKey, string> = { base: "bg-accent", bet: "bg-caution", cash: "bg-wallet-isk" };
const TEXT: Record<AllocationKey, string> = { base: "text-white", bet: "text-white", cash: "text-[#0f2740]" };
const NAME: Record<AllocationKey, string> = { base: ZONE_NAMES.base, bet: ZONE_NAMES.bet, cash: "Likvider" };

/** '73 st' / '0,75 st', the way a quantity is written. */
const quantity = (quantityE4: number) => `${formatScaled(quantityE4, 4)} st`;
/** '64,8 %'. */
const share1 = (x: number) => `${(x * 100).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export function Portfolio() {
  const [data, setData] = useState<PortfolioValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trading, setTrading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cash, setCash] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(() => {
    getJson<PortfolioValue>("/savings/portfolio").then(setData, (e: Error) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  const fetchPrices = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await sendJson<PriceSyncResult>("POST", "/savings/prices/sync", {});
      load();
      const failed = [...result.prices.filter((p) => !p.ok), ...result.rates.filter((r) => !r.ok)];
      notify({
        text: failed.length === 0 ? `Kurserna är hämtade (${result.prices.length} instrument).` : `${failed.length} kunde inte hämtas: ${failed[0].error}`,
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;

  const { policy, holdings, accounts, reconciliation } = data;
  // The base first, then the bet zone; inside a zone the largest holding first.
  const rows = [...holdings].sort((a, b) => (a.zone === b.zone ? (b.valueOre ?? -1) - (a.valueOre ?? -1) : a.zone === "base" ? -1 : 1));
  const shareOf = (h: ValuedHolding) => (data.totalOre > 0 && h.valueOre !== null ? h.valueOre / data.totalOre : null);
  const largest = Math.max(0, ...holdings.map((h) => h.valueOre ?? 0));
  // Which sources the numbers on this page actually came from. There is more
  // than one now, and 'Riksbanken' printed on a rate that came from Yahoo
  // would be the kind of small lie this whole view exists to avoid.
  const sourcesOf = (pick: (h: ValuedHolding) => string | null) => [...new Set(holdings.map(pick).filter((s): s is string => s !== null))].map(sourceName);
  const bar = allocation(data);
  const accountNames = accounts.map((a) => ACCOUNT_NAMES[a.account]).join(" och ") || "ISK";

  return (
    <>
      <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="portfolio-title" data-card="portfolio">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-[16rem] flex-1 basis-0">
            <div className="text-[12px] text-ink-3">
              <h2 id="portfolio-title" className="inline text-[13px] font-semibold text-ink-2">
                Innehav på {accountNames}
              </h2>
              {data.priceDate ? (
                <>
                  {" "}
                  · kurser {shortDate(data.priceDate)} ({sourcesOf((h) => h.priceSource).join(", ")})
                  {sourcesOf((h) => h.rateSource).length > 0 && <>, växelkurs från {sourcesOf((h) => h.rateSource).join(", ")}</>} · oberoende av perioden
                  {data.stale.length > 0 && (
                    <span className="text-caution-text">
                      {" "}
                      · {data.stale.length === 1 ? `${data.stale[0].name} värderas` : `${data.stale.length} innehav värderas`} med en kurs äldre än tre bankdagar
                    </span>
                  )}
                </>
              ) : (
                " · inga kurser hämtade ännu"
              )}
            </div>
            {holdings.length > 0 && (
              <>
                {/* Neutral on purpose: a portfolio's value is not an income, and green would read as a gain since yesterday. */}
                <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.02em] tabular-nums" data-testid="portfolio-total">
                  {wholeKr(bar.total)}
                </p>
                <p className="mt-1.5 text-[12px] text-ink-2 tabular-nums">
                  värdepapper <b className="font-semibold text-ink">{wholeKr(data.totalOre)}</b>
                  {bar.cash > 0 && (
                    <>
                      {" "}
                      + likvider <b className="font-semibold text-ink">{wholeKr(bar.cash)}</b>
                    </>
                  )}
                  {data.investedOre !== null && <span className="text-ink-3"> · insatt netto {wholeKr(data.investedOre)}</span>}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON.grey} onClick={() => setCash(true)}>
              <Wallet className="size-3.5" aria-hidden /> Likvider
            </button>
            <button type="button" className={BUTTON.grey} disabled={busy} onClick={() => void fetchPrices()}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden /> Hämta kurser
            </button>
            <button type="button" className={BUTTON.grey} onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden /> Instrument
            </button>
            {holdings.length === 0 && (
              <button type="button" className={BUTTON.grey} onClick={() => setOpening(true)}>
                Startinnehav
              </button>
            )}
            <button type="button" className={BUTTON.blue} onClick={() => setTrading(true)}>
              Registrera affär
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              Inga innehav ännu. Skriv av vad som står hos Avanza i dag — antal och snittinköp per instrument — så hämtas kurserna härifrån.
            </p>
            <button type="button" className={BUTTON.blue} onClick={() => setOpening(true)}>
              Lägg in startinnehav
            </button>
          </div>
        ) : (
          <>
            <div data-part="allocation">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-[11px] text-ink-3">
                <span>
                  Fördelning mot policyn · mål basen {Math.round(bar.target.base * 100)} % / bet-zonen {Math.round(bar.target.bet * 100)} %
                </span>
                <span>strecket visar målet</span>
              </div>
              <div className="relative mt-1.5">
                <div className="flex h-[22px] w-full gap-0.5 overflow-hidden rounded-[11px]" role="img" aria-label={bar.segments.map((x) => `${NAME[x.key]} ${wholeKr(x.ore)}`).join(", ")}>
                  {bar.segments
                    .filter((x) => x.width > 0)
                    .map((x) => (
                      <span
                        key={x.key}
                        className={cn("flex min-w-0 items-center px-2.5 text-[11px] font-semibold", COLOUR[x.key], TEXT[x.key])}
                        style={{ width: `${x.width * 100}%` }}
                        data-segment={x.key}
                        data-ore={x.ore}
                        data-width={x.width}
                        title={`${NAME[x.key]} ${wholeKr(x.ore)}${x.share !== null ? ` · ${share1(x.share)} av värdepapperen` : ""}`}
                      >
                        {/* The cash is too narrow for a label; its title says it. */}
                        {x.key !== "cash" && (
                          <>
                            <span className="hidden truncate tabular-nums @[40rem]:inline">
                              {NAME[x.key]} {x.share !== null && `${share1(x.share)} · `}
                              {wholeKr(x.ore)}
                            </span>
                            {/* On a phone only the share fits; the title has the rest. */}
                            <span className="truncate tabular-nums @[40rem]:hidden">{x.share !== null ? share1(x.share) : wholeKr(x.ore)}</span>
                          </>
                        )}
                      </span>
                    ))}
                </div>
                <span className="absolute top-full mt-0.5 flex -translate-x-px items-center gap-1 text-[10px] text-ink-3" style={{ left: `${bar.mark * 100}%` }} data-mark={bar.mark}>
                  <span className="h-3 w-0.5 rounded-full bg-ink" aria-hidden />
                  mål {Math.round(bar.target.base * 100)}/{Math.round(bar.target.bet * 100)}
                </span>
              </div>
            </div>

            <div className="pt-3">
              {policy.state === "over" ? (
                <p className="flex items-start gap-2.5 rounded-inset bg-caution-soft px-4 py-2.5 text-[12px] text-ink-2" role="note" aria-label="Bet-zonen">
                  <span aria-hidden className="w-2 shrink-0 text-center font-bold text-caution-text">
                    !
                  </span>
                  <span>{policy.text}</span>
                </p>
              ) : (
                <p className="text-[12px] text-ink-2" data-testid="policy">
                  {policy.text}
                </p>
              )}
            </div>

            {data.missing.length > 0 && (
              <p className="rounded-inset bg-caution-soft px-4 py-2.5 text-[12px] text-ink-2">
                {data.missing.map((h) => h.name).join(", ")} saknar {data.missing[0].missing === "rate" ? "valutakurs" : "kurs"} och räknas inte med i summan.
              </p>
            )}

            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full text-[13px]" aria-label="Instrument">
                <thead>
                  <tr className="border-b border-hairline text-[11px] text-ink-3">
                    <th className="py-2 pl-5 pr-3 text-left font-normal sm:pl-6">Instrument</th>
                    <th className="hidden px-3 py-2 text-left font-normal @[40rem]:table-cell">Zon</th>
                    <th className="px-3 py-2 text-right font-normal">Antal</th>
                    <th className="hidden px-3 py-2 text-right font-normal @[40rem]:table-cell">Kurs</th>
                    <th className="px-3 py-2 text-right font-normal">Värde</th>
                    <th className="hidden py-2 pl-3 pr-5 text-left font-normal sm:pr-6 @[40rem]:table-cell">Andel</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const share = shareOf(h);
                    return (
                      <tr key={`${h.instrumentId}-${h.account}`} className="border-b border-hairline hover:bg-band" data-holding={h.instrumentId}>
                        <td className="w-full max-w-0 py-2 pl-5 pr-3 sm:pl-6">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            {/* On a phone the zone is the dot before the name. */}
                            <span className={cn("inline-block size-2 shrink-0 self-center rounded-full @[40rem]:hidden", COLOUR[h.zone as InstrumentZone])} title={ZONE_NAMES[h.zone]} />
                            <button type="button" onClick={() => setOpenId(h.instrumentId)} className="min-w-0 truncate text-left font-medium hover:underline">
                              {h.name}
                            </button>
                            <span className="hidden shrink-0 text-[10px] text-ink-3 @[40rem]:inline">{ACCOUNT_NAMES[h.account]}</span>
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 @[40rem]:table-cell">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("inline-block size-2 shrink-0 rounded-full", COLOUR[h.zone as InstrumentZone])} />
                            {ZONE_NAMES[h.zone]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2">{quantity(h.quantityE4)}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2 @[40rem]:table-cell">
                          {h.priceE4 === null ? (
                            <span className="text-caution-text">kurs saknas</span>
                          ) : (
                            <span
                              title={h.stale ? `Kurs från ${shortDate(h.priceDate!)}: äldre än tre bankdagar. Innehavet värderas med den tills en ny kurs hämtas.` : `Kurs från ${shortDate(h.priceDate!)}`}
                            >
                              {formatScaled(h.priceE4, 4, 2)} {h.currency}
                              {h.stale && <span className="pl-1.5 text-[11px] text-caution-text">{shortDate(h.priceDate!)} · gammal</span>}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{h.valueOre === null ? <span className="text-ink-3">–</span> : <Money ore={h.valueOre} />}</td>
                        <td className="hidden py-2 pl-3 pr-5 sm:pr-6 @[40rem]:table-cell">
                          <span className="flex items-center gap-2">
                            <span className="block h-1.5 w-24 rounded-full bg-track">
                              <span className={cn("block h-full rounded-full", COLOUR[h.zone as InstrumentZone])} style={{ width: `${largest > 0 && h.valueOre ? (h.valueOre / largest) * 100 : 0}%` }} />
                            </span>
                            <span className="w-11 text-right text-[12px] tabular-nums text-ink-2">{share === null ? "–" : pct(share)}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px] text-ink-3">
              <span>
                {reconciliation.enteredOre === null ? (
                  reconciliation.text
                ) : (
                  <>
                    Den {shortDate(reconciliation.on)}: beräknat {wholeKr(reconciliation.computedOre)}
                    {reconciliation.cashOre !== null && <> (varav {wholeKr(reconciliation.cashOre)} likvider)</>} mot inmatat {wholeKr(reconciliation.enteredOre)} ·{" "}
                    <span className={cn(reconciliation.differenceOre !== null && Math.abs(reconciliation.differenceOre) > 100000 && "text-caution-text")}>{reconciliation.text}</span>
                  </>
                )}
              </span>
              <CsvButton
                filename="innehav"
                header={["Instrument", "Konto", "Zon", "Antal", "Kurs", "Valuta", "Kursdatum", "Värde SEK"]}
                rows={() =>
                  rows.map((h) => [
                    h.name,
                    ACCOUNT_NAMES[h.account],
                    ZONE_NAMES[h.zone],
                    formatScaled(h.quantityE4, 4),
                    h.priceE4 === null ? "" : formatScaled(h.priceE4, 4),
                    h.currency,
                    h.priceDate ?? "",
                    h.valueOre === null ? "" : (h.valueOre / 100).toFixed(2).replace(".", ","),
                  ])
                }
              />
            </div>
          </>
        )}
      </section>

      <OpeningDialog open={opening} onOpenChange={setOpening} onSaved={load} />
      <TradeDialog open={trading} onOpenChange={setTrading} onSaved={load} />
      <InstrumentDialog open={adding} onOpenChange={setAdding} onSaved={load} />
      <CashDialog open={cash} accounts={accounts} onOpenChange={setCash} onSaved={load} />
      <InstrumentPanel instrumentId={openId} onOpenChange={(o) => !o && setOpenId(null)} onChanged={load} />
    </>
  );
}
