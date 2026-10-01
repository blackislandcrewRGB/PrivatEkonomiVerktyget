import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { FIELD } from "../../settings/ui";
import { isoDate, monthLabel, shiftMonth } from "../common";
import {
  asKind,
  bName,
  monthPeriod,
  periodDays,
  periodName,
  quarterPeriod,
  rangeText,
  resolveB,
  yearPeriod,
  type BChoice,
  type Kind,
  type Period,
  type Relative,
} from "./periods";

const KIND_LABEL: Record<Kind, string> = { month: "Månad", quarter: "Kvartal", year: "År", custom: "Anpassat" };
const chip = "h-7 whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors";
const chipOn = "bg-ink text-card";
const chipOff = "bg-card-inset text-ink hover:bg-segment";

/** 'Månaden före', 'Kvartalet före', 'Året före', 'Perioden före'. */
const beforeLabel = (a: Period) => ({ month: "Månaden före", quarter: "Kvartalet före", year: "Året före", custom: "Perioden före" })[a.kind];

/** The months, quarters and years to pick from: two years back of months, eight quarters, three years. */
function choices() {
  const thisMonth = isoDate(new Date()).slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  return {
    month: Array.from({ length: 24 }, (_, i) => monthPeriod(shiftMonth(thisMonth, -i))),
    quarter: Array.from({ length: 8 }, (_, i) => {
      const q0 = y * 4 + Math.ceil(m / 3) - 1 - i;
      return quarterPeriod(Math.floor(q0 / 4), (q0 % 4) + 1);
    }),
    year: [y, y - 1, y - 2].map(yearPeriod),
  };
}

/**
 * The name as a picker: Månad, Kvartal, År or Anpassat, and the list or two
 * dates. The same picker for A and B.
 */
function Picker({ value, name, onPick, label }: { value: Period; name: string; onPick: (p: Period) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(value.kind);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const list = useMemo(choices, []);
  const pick = (p: Period) => {
    onPick(p);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setKind(value.kind);
          setFrom(value.from);
          setTo(value.to);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex min-w-0 items-center gap-1 text-left text-[15px] font-semibold hover:underline" aria-label={`Period ${label}: ${name}`}>
          <span className="truncate">{name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3">
        <SegmentedControl<Kind>
          label={`Periodtyp ${label}`}
          appearance="v2"
          size="sm"
          options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          value={kind}
          onChange={setKind}
        />
        {kind === "custom" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="date" aria-label={`Från ${label}`} className={cn(FIELD, "h-8")} value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-ink-3">–</span>
              <input type="date" aria-label={`Till ${label}`} className={cn(FIELD, "h-8")} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button
              type="button"
              disabled={!from || !to || from > to}
              onClick={() => pick({ kind: "custom", from, to })}
              className="h-8 w-full rounded-[9px] bg-accent text-[13px] font-semibold text-white disabled:opacity-50"
            >
              Välj
            </button>
          </div>
        ) : (
          <ul className="max-h-64 overflow-y-auto" role="listbox" aria-label={`${KIND_LABEL[kind]} ${label}`}>
            {list[kind].map((p) => {
              const on = p.from === value.from && p.to === value.to;
              return (
                <li key={p.from}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => pick(p)}
                    className={cn("block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] first-letter:uppercase hover:bg-card-inset", on && "bg-accent-soft font-semibold text-accent")}
                  >
                    {kind === "month" ? monthLabel(p.from.slice(0, 7), true) : periodName(p)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Badge({ letter }: { letter: "A" | "B" }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white", letter === "A" ? "bg-accent" : "bg-ink-2")} aria-hidden>
      {letter}
    </span>
  );
}

/**
 * Jämför perioder's two periods (Design v2): A with a blue badge and B with
 * a grey, each named as a picker with its dates and days under. A's chips
 * change its length (the period of that kind holding its start); B's are
 * relative to A — the period before, the same a year earlier, the twelve
 * months' average. ⇄ between them swaps A and B.
 */
export function PeriodCards({ a, b, onA, onB, onSwap }: { a: Period; b: BChoice; onA: (p: Period) => void; onB: (b: BChoice) => void; onSwap: (() => void) | null }) {
  const bPeriod = resolveB(a, b);
  const average = "relative" in b && b.relative === "snitt12";
  const relativeChip = (r: Relative, text: string) => {
    const on = "relative" in b && b.relative === r;
    return (
      <button key={r} type="button" aria-pressed={on} onClick={() => onB({ relative: r })} className={cn(chip, on ? chipOn : chipOff)} data-b={r}>
        {text}
      </button>
    );
  };
  const card = "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-card px-4 py-3.5 text-ink shadow-card sm:px-5";

  return (
    <div className="flex flex-col items-stretch gap-3 @[56rem]:flex-row @[56rem]:items-center" data-part="periods">
      <section className={card} aria-label="Period A" data-period="a">
        <Badge letter="A" />
        <div className="min-w-40 flex-1">
          <Picker label="A" value={a} name={periodName(a)} onPick={onA} />
          <p className="whitespace-nowrap text-[11px] text-ink-3 tabular-nums">
            {rangeText(a)} · {periodDays(a)} dagar
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Längd A">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={a.kind === k}
              onClick={() => onA(asKind(a, k))}
              className={cn(chip, a.kind === k ? chipOn : chipOff)}
              data-a={k}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={onSwap ?? undefined}
        disabled={!onSwap}
        aria-label="Byt A och B"
        title={onSwap ? "Byt A och B" : "Snittet går inte att byta till A"}
        className="grid size-9 shrink-0 place-items-center self-center rounded-full bg-segment text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <ArrowLeftRight className="size-4 rotate-90 @[56rem]:rotate-0" aria-hidden />
      </button>

      <section className={card} aria-label="Period B" data-period="b">
        <Badge letter="B" />
        <div className="min-w-40 flex-1">
          <Picker label="B" value={bPeriod} name={bName(a, b)} onPick={(p) => onB({ period: p })} />
          <p className="whitespace-nowrap text-[11px] text-ink-3 tabular-nums">
            {rangeText(bPeriod)}
            {average ? " · snittet i A:s längd" : ` · ${periodDays(bPeriod)} dagar`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jämför med">
          {relativeChip("fore", beforeLabel(a))}
          {relativeChip("ifjol", "Samma förra året")}
          {relativeChip("snitt12", "Snitt 12 mån")}
        </div>
      </section>
    </div>
  );
}
