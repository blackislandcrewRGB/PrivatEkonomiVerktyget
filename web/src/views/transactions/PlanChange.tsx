import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { getJson, parseKr, sendJson, type Transaction } from "../../api";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { formatKr } from "../../lib/format";
import { cn } from "../../lib/cn";

interface Candidate {
  id: number;
  name: string;
  planName: string | null;
  amount: number;
  currency: "EUR" | "USD" | null;
  vatPercent: number | null;
  /** The purchase's month and day: where the new plan starts. */
  from: string;
  day: number;
}

const input = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";
const monthText = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });

/**
 * 'Byt plan för …', on a purchase that looks like a fixed expense at a new
 * price and day (ChatGPT's 249 kr on the 28th, then 937 kr on the 6th): the
 * purchase becomes the first charge of the new plan. The plan before keeps
 * the months before, and both charges count.
 */
export function PlanChangeFromCharge({ row, foreign, onChanged }: { row: Transaction; foreign: { amount: number | null; currency: string | null } | null; onChanged: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [open, setOpen] = useState<Candidate | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setOpen(null);
    setCandidates([]);
    getJson<Candidate[]>(`/transactions/${row.id}/plan-candidates`).then(
      (c) => live && setCandidates(Array.isArray(c) ? c : []),
      () => live && setCandidates([]),
    );
    return () => {
      live = false;
    };
  }, [row.id, row.recurringExpenseId]);

  // One priced in a currency is changed from the charge's amount in it (before VAT); without that the panel of the expense does it.
  const usable = candidates.filter((c) => !c.currency || (foreign?.currency === c.currency && foreign.amount));
  if (usable.length === 0) return null;

  const priceOf = (c: Candidate) => (c.currency ? { foreignAmount: Math.round(Math.abs(foreign!.amount!) / (1 + (c.vatPercent ?? 0) / 100)) } : { amount: parseKr(price) ?? Math.abs(row.amount) });
  const plain = (ore: number) => String(ore / 100).replace(".", ",");
  const save = async () => {
    if (!open) return;
    if (!open.currency && !(parseKr(price) && parseKr(price)! > 0)) return notify({ text: "Skriv planens pris i kronor." });
    setBusy(true);
    try {
      await sendJson("POST", `/recurring-expenses/${open.id}/change-plan`, { transactionId: row.id, from: open.from, anchorDay: open.day, ...priceOf(open), ...(name.trim() ? { name: name.trim() } : {}) });
      const target = open;
      setOpen(null);
      onChanged();
      notify({
        text: `${target.name} har bytt plan: ${formatKr(parseKr(price) ?? Math.abs(row.amount))} från ${monthText(target.from)}. Dragningen före räknas kvar på den gamla planen.`,
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("POST", `/recurring-expenses/${target.id}/undo-plan-change`, { transactionId: row.id });
            onChanged();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <>
        {usable.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => (setName(""), setPrice(plain(Math.abs(row.amount))), setOpen(c))}
            className="flex items-center gap-2 text-left text-muted hover:text-foreground"
          >
            <Repeat className="size-4 shrink-0" /> Byt plan för {c.name}…
          </button>
        ))}
      </>
    );
  }
  return (
    <form
      aria-label="Byt plan"
      className="space-y-2 rounded-lg border border-border bg-canvas p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm font-medium">Byt plan för {open.name}</p>
      <p className={cn("text-xs text-muted tabular-nums")}>
        {open.name} kostade {formatKr(open.amount)}{open.planName ? ` (${open.planName})` : ""}. Det här köpet, {formatKr(Math.abs(row.amount))}, blir första dragningen på den nya planen: från {monthText(open.from)}, dragen den {open.day}:e. Månaderna före behåller sitt pris och sin dag, och dragningarna räknas var för sig.
      </p>
      {!open.currency && (
        <div className="space-y-1">
          <label className="block text-xs text-muted">
            Planens pris per månad
            <span className="flex items-center gap-2">
              <input aria-label="Planens pris" inputMode="decimal" className={cn(input, "w-28 text-right tabular-nums")} value={price} onChange={(e) => setPrice(e.target.value)} />
              <span>kr</span>
            </span>
          </label>
          {parseKr(price) !== open.amount + Math.abs(row.amount) && (
            <button type="button" className="text-left text-xs text-link hover:underline" onClick={() => setPrice(plain(open.amount + Math.abs(row.amount)))}>
              Köpet är bara mellanskillnaden: {formatKr(open.amount)} + {formatKr(Math.abs(row.amount))} = {formatKr(open.amount + Math.abs(row.amount))} per månad
            </button>
          )}
          {parseKr(price) !== null && parseKr(price) !== Math.abs(row.amount) && (
            <p className="text-xs text-muted">Månaden planen börjar väntas på {formatKr(Math.abs(row.amount))}, det som drogs. Därefter väntas {formatKr(parseKr(price)!)}.</p>
          )}
        </div>
      )}
      <label className="block text-xs text-muted">
        Namn på planen (valfritt)
        <input className={input} value={name} placeholder="Pro" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Byt plan
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(null)}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
