import { useState, type RefObject } from "react";
import { Check, ClipboardCopy, Trash2, X } from "lucide-react";
import { getJson, sendJson, type Account, type Affordability, type Cashflow as Data, type PlannedPayment } from "../../../api";
import { Amount } from "../../../components/Amount";
import { Card } from "../../../components/Card";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Switch } from "../../../components/Switch";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { dm, kr } from "../format";

export interface Scenario {
  direction: "out" | "in";
  amount: string;
  date: string;
  description: string;
  /** Paid with: '' is the bank, else a card's id. */
  accountId: string;
  shared: boolean;
  /** Paid from the cash flow, or with money taken from the savings on ISK. */
  funding: "cash" | "savings";
}

export const EMPTY: Scenario = {
  direction: "out",
  amount: "",
  date: "",
  description: "",
  accountId: "",
  shared: false,
  funding: "cash",
};

/** 'köpt 24/9 på Bank Norwegian, dras 25/10 · delat, halva tillbaka 25/10'. */
export function paymentText(p: { date: string } & PlannedPayment, partnerName: string): string | null {
  const parts = [
    p.card ? (p.payDate !== p.date ? `köpt ${dm(p.date)} på ${p.card}, dras ${dm(p.payDate)}` : `på ${p.card}`) : null,
    p.partnerDate ? `delat, ${partnerName}s halva ${kr(p.partnerHalf)} tillbaka ${dm(p.partnerDate)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase("sv") + s.slice(1);
const period = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * The answer in one sentence, from the server's verdict: green is Ja (the
 * lowest point before and after, and where it lands), yellow Knappt (under
 * the buffer, or the server's reason when it is something else), red Nej
 * (under zero, or the server's reason).
 */
export function answerText(v: Affordability): string {
  const { before, after, verdict, input, limits, reasons } = v;
  if (verdict === "green") {
    return `Ja. Lägsta punkten blir ${kr(after.lowest.balance)} den ${dm(after.lowest.date)} i stället för ${kr(before.lowest.balance)}, och du landar på ${kr(after.end.balance)} den ${dm(after.end.date)}.`;
  }
  if (verdict === "yellow") {
    if (input.funding === "cash" && after.safeToSpend < 0 && after.lowest.balance >= 0) {
      return `Knappt – lägsta punkten blir ${kr(after.lowest.balance)} den ${dm(after.lowest.date)}, under bufferten på ${kr(limits.buffer)}.`;
    }
    return `Knappt – ${period(lowerFirst(reasons[0] ?? v.headline))}`;
  }
  if (input.funding === "cash" && after.lowest.balance < 0) return `Nej – kassan går under noll den ${dm(after.lowest.date)} (${kr(after.lowest.balance)}).`;
  return `Nej – ${period(lowerFirst(reasons[0] ?? v.headline))}`;
}

const ANSWER = {
  green: {
    box: "bg-positive-soft",
    icon: "bg-positive",
    label: "Ja",
    Icon: Check,
  },
  yellow: {
    box: "bg-caution-soft",
    icon: "bg-caution",
    label: "Knappt",
    Icon: () => <span className="text-[13px] font-bold leading-none">!</span>,
  },
  red: { box: "bg-alarm-soft", icon: "bg-alarm", label: "Nej", Icon: X },
} as const;

const field =
  "h-9 min-w-0 rounded-lg border border-ink-3/35 bg-card px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20";

const monthsText = (m: number | null) => (m === null ? "–" : `${m.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} mån`);

/**
 * Har jag råd?: a purchase (or an income) against the cash flow. As soon as
 * the amount and the day are there, the answer shows under the fields —
 * Ja, Knappt or Nej, the server's verdict — with the choice of where the
 * money comes from and Spara som planerad beside it, and the figures
 * behind it folded away. Saved ones are listed under it.
 */
export function AffordCard({
  data,
  scenario,
  setScenario,
  cards,
  verdict,
  active,
  onSave,
  onChanged,
  amountRef,
  sectionRef,
  partner,
}: {
  data: Data;
  scenario: Scenario;
  setScenario: (f: (s: Scenario) => Scenario) => void;
  cards: Account[];
  /** The server's answer for a purchase (none for an income). */
  verdict: Affordability | null;
  /** Amount and day are there and the day is in the 90. */
  active: boolean;
  onSave: () => void;
  onChanged: () => void;
  amountRef: RefObject<HTMLInputElement | null>;
  sectionRef: RefObject<HTMLElement | null>;
  partner: boolean;
}) {
  const [copyText, setCopyText] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const out = scenario.direction === "out";
  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setScenario((s) => ({ ...s, [k]: v }));
  const pay: PlannedPayment | null = verdict && (verdict.payment.card || verdict.payment.partnerDate) ? verdict.payment : null;

  // Kopiera läget: shown first, then copied (with the purchase when there is one).
  const openSnapshot = async () => {
    try {
      const q = new URLSearchParams();
      if (verdict) {
        q.set("amount", String(verdict.input.amount));
        q.set("date", verdict.input.date);
        if (verdict.input.accountId !== null) q.set("accountId", String(verdict.input.accountId));
        if (verdict.input.shared) q.set("shared", "1");
        if (verdict.input.funding === "savings") q.set("funding", "savings");
        if (!verdict.input.partner) q.set("partner", "0");
      }
      const r = await getJson<{ markdown: string }>(`/afford/snapshot${q.size ? `?${q}` : ""}`);
      setCopyText(r.markdown);
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? "");
      notify({ text: "Läget är kopierat. Klistra in det i en Claude-chatt." });
      setCopyText(null);
    } catch {
      notify({
        text: "Kunde inte kopiera. Markera texten och kopiera den själv.",
      });
    }
  };
  const remove = async (id: number) => {
    await sendJson("DELETE", `/cashflow/planned/${id}`, {});
    onChanged();
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {out && (
        <select aria-label="Pengarna tas från" className={cn(field, "h-8 pr-7")} value={scenario.funding} onChange={(e) => set("funding", e.target.value as Scenario["funding"])}>
          <option value="cash">Från kassaflödet</option>
          <option value="savings">Från sparandet på ISK</option>
        </select>
      )}
      <Button
        size="sm"
        disabled={!active}
        onClick={onSave}
        className="h-8 rounded-lg border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        Spara som planerad
      </Button>
    </div>
  );
  const answer = active && out && verdict ? ANSWER[verdict.verdict] : null;

  return (
    <Card ref={sectionRef} aria-labelledby="scenario-title" className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="scenario-title" className="text-base font-semibold">
          Har jag råd?
        </h2>
        <button
          type="button"
          onClick={openSnapshot}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          title="Läget som text att klistra in i en Claude-chatt, utan namn och kontonummer"
        >
          <ClipboardCopy className="size-3.5" aria-hidden /> Kopiera läget
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 @[40rem]:flex @[40rem]:flex-wrap @[40rem]:items-center">
        <SegmentedControl
          label="Utgift eller inkomst"
          appearance="v2"
          options={[
            { value: "out", label: "Utgift" },
            { value: "in", label: "Inkomst" },
          ]}
          value={scenario.direction}
          onChange={(v) => set("direction", v)}
          className="col-span-2 w-fit"
        />
        <div className="relative">
          <input
            ref={amountRef}
            aria-label="Belopp"
            inputMode="decimal"
            placeholder="Belopp"
            className={cn(field, "w-full pr-8 text-right tabular-nums @[40rem]:w-32")}
            value={scenario.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-3" aria-hidden>
            kr
          </span>
        </div>
        <input
          aria-label="Datum"
          type="date"
          min={data.today}
          max={data.horizon}
          className={cn(field, "w-full @[40rem]:w-36")}
          value={scenario.date}
          onChange={(e) => set("date", e.target.value)}
        />
        <input
          aria-label="Beskrivning"
          placeholder="Beskrivning, t.ex. Resa i november"
          className={cn(field, "col-span-2 @[40rem]:min-w-32 @[40rem]:flex-1")}
          value={scenario.description}
          onChange={(e) => set("description", e.target.value)}
        />
        {out && (
          <>
            <select aria-label="Betalas med" className={cn(field, "pr-7 @[40rem]:w-44")} value={scenario.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">Bankkontot</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Switch checked={scenario.shared} onCheckedChange={(on) => set("shared", on)}>
              Delat med {data.partnerName}
            </Switch>
          </>
        )}
      </div>

      {answer && verdict ? (
        <div
          className={cn("flex flex-col gap-3 rounded-inset px-4 py-3.5 @[40rem]:flex-row @[40rem]:items-center", answer.box)}
          data-testid="afford-verdict"
          data-verdict={verdict.verdict}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-white", answer.icon)} aria-hidden>
              <answer.Icon className="size-4" strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <p data-testid="afford-answer">
                <span className="sr-only">{answer.label}: </span>
                {answerText(verdict)}
              </p>
              {pay && (
                <p className="mt-1 text-xs text-ink-2" data-testid="scenario-payment">
                  {paymentText({ date: scenario.date, ...pay }, data.partnerName)}
                  {pay.partnerDate && !partner && ` (räknas inte: betalningar från ${data.partnerName} är avslagna)`}
                </p>
              )}
            </div>
          </div>
          {actions}
        </div>
      ) : (
        actions
      )}

      {answer && verdict && (
        <div>
          <button type="button" className="text-xs text-accent hover:underline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            {details ? "Dölj uträkningen" : "Visa uträkningen"}
          </button>
          {details && <Details v={verdict} onFromSavings={() => set("funding", "savings")} />}
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        Räknas mot kassaflödet (lönerna, fakturorna och {data.partnerName}s betalningar) och sparandet. Sparad räknas den in i prognosen tills dagen passerat.
      </p>

      <Dialog open={copyText !== null} onOpenChange={(o) => !o && setCopyText(null)}>
        <DialogContent aria-describedby="snapshot-desc" className="max-w-2xl">
          <DialogTitle>Kopiera läget</DialogTitle>
          <DialogDescription id="snapshot-desc" className="mt-1">
            Det här kopieras{verdict ? ", med köpet" : ""}. Beloppen är avrundade till hundratal kronor. Namn, kontonummer, arbetsgivare, hyresvärd och enskilda köp är utelämnade,
            och {data.partnerName} heter "partnern".
          </DialogDescription>
          <pre data-testid="snapshot-text" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-muted p-3 text-xs">
            {copyText}
          </pre>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCopyText(null)}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={copy}>
              <ClipboardCopy /> Kopiera
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {data.planned.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-ink-2">Planerade</h3>
          <ul className="mt-1 divide-y divide-hairline text-[13px]">
            {data.planned.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="w-12 shrink-0 text-ink-2 tabular-nums">{dm(p.date)}</span>
                <span className="min-w-0 flex-1">
                  {p.description}
                  {paymentText(p, data.partnerName) && <span className="block text-xs text-ink-2">{paymentText(p, data.partnerName)}</span>}
                </span>
                <Amount ore={p.amount} size="sm" whole />
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Ta bort ${p.description}`} onClick={() => remove(p.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Why, and the figures the answer rests on before and after the purchase. */
function Details({ v, onFromSavings }: { v: Affordability; onFromSavings: () => void }) {
  // Kvar vid månadsskiftet: the 1sts the purchase touches (the first two).
  const starts = v.monthStarts.filter((m) => m.before !== m.after).slice(0, 2);
  const rows: [string, string, string][] = [
    ...starts.map((m): [string, string, string] => [`Kvar vid månadsskiftet ${dm(m.date)}`, kr(m.before), kr(m.after)]),
    ["Lägsta punkt", `${kr(v.before.lowest.balance)} (${dm(v.before.lowest.date)})`, `${kr(v.after.lowest.balance)} (${dm(v.after.lowest.date)})`],
    ["Safe to spend", kr(v.before.safeToSpend), kr(v.after.safeToSpend)],
    ["Uthållighet med sparandet", monthsText(v.before.withSavingsMonths), monthsText(v.after.withSavingsMonths)],
    ["Buffert", monthsText(v.before.bufferMonths), monthsText(v.after.bufferMonths)],
  ];
  return (
    <div className="mt-2 rounded-inset bg-card-inset p-4 text-[13px]" data-testid="afford-details">
      <p className="font-semibold">{v.headline}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {v.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {v.alternative && v.input.funding === "cash" && (
        <Button size="sm" className="mt-3" onClick={onFromSavings}>
          Räkna med pengar från ISK
        </Button>
      )}
      <table className="mt-3 w-full max-w-lg">
        <thead>
          <tr className="text-[11px] text-ink-3">
            <th className="py-1 text-left font-normal" />
            <th className="py-1 text-right font-normal">Utan köpet</th>
            <th className="py-1 text-right font-normal">Med köpet</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, before, after]) => (
            <tr key={label} className="border-t border-hairline">
              <td className="py-1 pr-3">{label}</td>
              <td className="py-1 text-right text-ink-2 tabular-nums">{before}</td>
              <td className="py-1 text-right font-medium tabular-nums">{after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-ink-3">
        Buffert är det som är kvar vid månadsskiftet (med likviderna på ISK), i månader av dina utgifter. Rött under {v.limits.redBelowMonths.toLocaleString("sv-SE")} månader med
        sparandet (Inställningar).
      </p>
    </div>
  );
}
