import { useEffect, useState, type ReactNode } from "react";
import { RECEIPT_STORE_NAMES, getJson, type GrocerySummary } from "../../../api";
import { cn } from "../../../lib/cn";
import { CsvButton, Money, query, wholeKr } from "../common";
import { ShelfList, ShelfMonths } from "./ShelfMonths";

/**
 * What the receipts say the food was (Design v2).
 *
 * The coverage comes first and is written in words, because every number
 * under it is built on a part of the groceries: 'kvitton täcker 52 av 84
 * matköp' is the difference between a figure that can be trusted and one that
 * quietly reads as the whole truth. The bar is the kronor with a receipt of
 * all the kronor spent on food. The shelves are what the question was —
 * what do we spend on dairy — and the months say whether it is moving.
 */

function Box({ label, value, hint, tone, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "positive"; testId: string }) {
  return (
    <div className={cn("min-w-0 rounded-inset px-3.5 py-3", tone === "positive" ? "bg-positive-soft" : "bg-card-inset")} data-box={testId}>
      <p className={cn("text-[11px]", tone === "positive" ? "text-positive-text" : "text-ink-2")}>{label}</p>
      <p className={cn("mt-0.5 text-[20px] font-bold leading-tight tabular-nums", tone === "positive" && "text-positive-text")}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

export function GroceryOverview({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<GrocerySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<GrocerySummary>(`/products/summary?${query({ from, to })}`).then(
      (d) => alive && setData(d),
      (e: Error) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [from, to]);

  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;
  const { coverage, groups, months, extras, stores } = data;
  if (coverage.purchases === 0 && groups.length === 0) return null;

  const total = groups.reduce((s, g) => s + g.totalOre, 0);
  const lines = groups.reduce((s, g) => s + g.times, 0);
  // Kronor with a receipt of the kronor spent on food.
  const covered = coverage.spentOre > 0 ? Math.min(1, Math.max(0, coverage.receiptOre / coverage.spentOre)) : 0;
  const discount = -extras.discountOre;

  return (
    <section className="@container space-y-5 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="grocery-overview-title" data-card="overview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="grocery-overview-title" className="text-[15px] font-semibold">
          Vad maten blev
        </h2>
        <CsvButton
          filename="matvaror-per-hylla"
          header={["Hylla", "Kronor", "Andel", "Rader"]}
          rows={() => groups.map((g) => [g.name, (g.totalOre / 100).toFixed(2).replace(".", ","), total > 0 ? `${Math.round((g.totalOre / total) * 100)} %` : "", g.times])}
        />
      </div>

      <div className="space-y-2" data-part="coverage">
        {coverage.purchases === 0 ? (
          <p className="text-[12px] text-ink-2">Inga matköp i perioden att jämföra kvittona med.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[12px]">
              <p className="text-ink-2 tabular-nums">
                Kvitton täcker{" "}
                <strong className="font-semibold text-ink">
                  {coverage.withReceipt} av {coverage.purchases} matköp
                </strong>{" "}
                · {wholeKr(coverage.receiptOre)} av {wholeKr(coverage.spentOre)}
              </p>
              <p className="text-ink-3">resten av maten vet verktyget bara summan av</p>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-track"
              role="img"
              aria-label={`${Math.round(covered * 100)} % av kronorna på mat har kvitto`}
            >
              <div className="h-full rounded-full bg-positive" style={{ width: `${covered * 100}%` }} data-covered={covered} />
            </div>
          </>
        )}
        {stores.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Butiker">
            {stores.map((s) => (
              <li key={s.store} className="rounded-full bg-card-inset px-2.5 py-0.5 text-[11px] text-ink-2 tabular-nums">
                {RECEIPT_STORE_NAMES[s.store as keyof typeof RECEIPT_STORE_NAMES] ?? s.store} {s.receipts} {s.receipts === 1 ? "kvitto" : "kvitton"} · {wholeKr(s.totalOre)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 @[44rem]:grid-cols-4">
        <Box testId="items" label="Varor på kvittona" value={wholeKr(total)} hint={`${lines} ${lines === 1 ? "rad" : "rader"}`} />
        <Box
          testId="discounts"
          tone="positive"
          label="Rabatter"
          value={discount > 0 ? `+${wholeKr(discount)}` : <Money ore={-discount} />}
          hint={`medlemspris och kampanjer${total > 0 && discount > 0 ? ` · ${((discount / total) * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %` : ""}`}
        />
        <Box testId="deposit" label="Pant" value={wholeKr(extras.depositOre)} hint="betald, inte återlämnad" />
        <Box testId="bags" label="Kassar" value={wholeKr(extras.bagOre)} hint={extras.bags !== null ? `ca ${extras.bags} ${extras.bags === 1 ? "kasse" : "kassar"}` : undefined} />
      </div>

      {groups.length > 0 && (
        <div className="grid gap-6 @[48rem]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <ShelfList groups={groups} />
          <ShelfMonths groups={groups} months={months} />
        </div>
      )}
    </section>
  );
}
