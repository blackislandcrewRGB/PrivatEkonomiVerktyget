import { useCallback, useEffect, useState } from "react";
import { getJson, parseKr, sendJson, shortDate, type RealSavings, type SavingsHolding, type SavingsOverview } from "../../api";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { isoDate, kr, Section } from "./common";
import { Portfolio } from "./Portfolio";
import { ValueCard } from "./savings/ValueCard";
import { ReadingsCard } from "./savings/ReadingsCard";
import { SavedCard } from "./savings/SavedCard";
import { SavedTable } from "./savings/SavedTable";
import { RealCard } from "./savings/RealCard";
import { RealTable } from "./savings/RealTable";
import { BufferCard } from "./savings/BufferCard";
import type { ViewProps } from "./AnalysisView";

const input = "mt-0.5 block h-8 rounded-md border border-hairline bg-card px-2 text-sm text-ink";

/**
 * Sparande (Design v2): the holdings on the ISK against the policy; the
 * savings' value, entered by hand, with what it grew beyond the money put
 * in; the savings after inflation – the ISK in today's money, per quarter,
 * and the buffer's interest against prices; and what went into savings
 * (Swish to Avanza) and back out, month by month and as a share of the
 * income. The e-savings account is a buffer, not savings.
 */
export function Savings({ from, to, openTransactions }: ViewProps) {
  const [data, setData] = useState<SavingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      getJson<SavingsOverview>(`/savings?from=${from}&to=${to}`).then(
        (d) => setData(d),
        (e) => setError(String(e)),
      ),
    [from, to],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Not tied to the period: since the first value on the ISK.
  const [real, setReal] = useState<RealSavings | null>(null);
  const loadReal = useCallback(() => void getJson<RealSavings>("/savings/real").then(setReal, () => setReal(null)), []);
  useEffect(() => {
    if (data) loadReal();
  }, [data, loadReal]);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;

  const open = (month?: string) =>
    data.categoryId !== null && openTransactions(month ? { period: month, categoryId: String(data.categoryId) } : { period: "custom", from, to, categoryId: String(data.categoryId) });

  return (
    <div className="space-y-4">
      <Portfolio />
      <Holdings data={data} reload={load} />

      {real && (
        <div className="@container">
          <div className="grid gap-4 @[56rem]:grid-cols-12">
            <div className="min-w-0 @[56rem]:col-span-7">
              <RealCard data={real} onStatements={loadReal} />
            </div>
            {real.buffer && (
              <div className="min-w-0 @[56rem]:col-span-5">
                <BufferCard buffer={real.buffer} kpiMonth={real.kpiMonth} />
              </div>
            )}
          </div>
        </div>
      )}
      {real && real.periods.length > 0 && <RealTable data={real} />}

      <SavedCard data={data} onOpen={open} />

      <SavedTable data={data} onOpen={(month) => open(month)} />
    </div>
  );
}

/** The savings' value, entered by hand, and what it grew beyond the money put in. Not tied to the period. */
function Holdings({ data, reload }: { data: SavingsOverview; reload: () => void }) {
  const fail = (e: unknown) => notify({ text: (e as Error).message });
  const [name, setName] = useState("Avanza ISK");
  const [first, setFirst] = useState("");
  const firstOre = first.trim() ? parseKr(first) : null;
  const p = data.portfolio;
  const single = data.holdings.length === 1 ? data.holdings[0] : null;

  // The first value can be entered with the name, so it doesn't end up as the name.
  const create = () =>
    sendJson<SavingsHolding>("POST", "/savings/holdings", { name })
      .then((h) => (firstOre !== null ? sendJson("PUT", `/savings/holdings/${h.id}/values`, { date: isoDate(new Date()), value: firstOre }) : null))
      .then(() => {
        setFirst("");
        reload();
      })
      .catch(fail);
  const removeValue = (h: SavingsHolding, date: string, value: number) =>
    sendJson("DELETE", `/savings/holdings/${h.id}/values/${date}`, {})
      .then(() => {
        notify({
          text: `${h.name}: värdet ${shortDate(date)} (${kr(value)}) är borttaget.`,
          action: { label: "Ångra", run: () => void sendJson("PUT", `/savings/holdings/${h.id}/values`, { date, value }).then(reload, fail) },
        });
        reload();
      })
      .catch(fail);
  const enter = (run: () => void) => (e: React.KeyboardEvent) => {
    // Explicit: implicit submission doesn't fire for every Enter (as in BulkLabelDialog).
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };

  if (!data.holdings.length) {
    const ok = !!name.trim() && (!first.trim() || firstOre !== null);
    return (
      <Section title="Värdet på ditt sparande" subtitle="För in vad ditt ISK är värt då och då. Då syns hur mycket som är insatta pengar och hur mycket som är värdeförändring.">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) create();
          }}
        >
          <label className="text-xs text-ink-2">
            Namn
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter(() => ok && create())} aria-label="Namn på sparandet" className={cn(input, "w-48")} />
          </label>
          <label className="text-xs text-ink-2">
            Värde i dag (kr)
            <input
              inputMode="decimal"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              onKeyDown={enter(() => ok && create())}
              aria-label="Värde i dag"
              placeholder="125 000"
              className={cn(input, "w-36 text-right tabular-nums")}
            />
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={!ok}>
            Lägg till
          </Button>
        </form>
      </Section>
    );
  }

  return (
    <div className="@container">
      <div className="grid gap-4 @[56rem]:grid-cols-12">
        <div className="min-w-0 @[56rem]:col-span-7">
          {p ? (
            <ValueCard portfolio={p} />
          ) : (
            <Section title="Värdet på ditt sparande" subtitle="För in ett värde för att börja följa avkastningen.">
              <p className="text-[12px] text-ink-3">Inga värden än.</p>
            </Section>
          )}
        </div>
        <div className="min-w-0 space-y-4 @[56rem]:col-span-5">
          {data.holdings.map((h) => (
            <ReadingsCard key={h.id} holding={h} points={single && p ? p.points : null} reload={reload} onRemoveValue={removeValue} />
          ))}
        </div>
      </div>
    </div>
  );
}
