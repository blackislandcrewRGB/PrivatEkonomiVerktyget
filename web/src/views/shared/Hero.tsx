import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { sendJson, shortDate, type SharedMonth } from "../../api";
import { AnimatedNumber } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import type { Act } from "./SharedLists";
import { STATE_PILL, monthState } from "./status";
import { monthLabel } from "./summary";

const pad = (n: number) => String(n).padStart(2, "0");
const nextMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** 'Kim' -> 'K'; nothing given -> the fallback. */
const initial = (name: string | null | undefined, fallback: string) => (name?.trim() ? name.trim()[0].toLocaleUpperCase("sv") : fallback);

/** Whole kronor with spaces, as the buttons say it: '7 697'. */
const wholeKr = (ore: number) => Math.round(Math.abs(ore) / 100).toLocaleString("sv-SE");

/**
 * The month's result: me and the partner as avatars with what each laid out,
 * between them who pays whom in large type and a green arrow pointing to
 * the one who gets the money (none when even). Under it Stäm av (kvitt or
 * carried over) with a note, or, once settled, how it was settled and Lås upp.
 */
export function Hero({ data, act }: { data: SharedMonth; act: Act }) {
  const [note, setNote] = useState("");
  const s = data.settlement;
  const p = data.partnerName;
  const upcoming = !s && data.nextPayDate !== null;
  const figures = s ?? data.live;
  const result = figures.result;
  const next = monthLabel(nextMonth(data.month)).toLowerCase();
  const state = monthState(data);
  const pill = STATE_PILL[state];
  const settle = (carryForward: boolean) => act(() => sendJson("PUT", `/shared/${data.month}/settlement`, { note, carryForward }));

  return (
    <Card aria-labelledby="shared-hero-title" className="@container flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="shared-hero-title" className="text-[13px] font-medium text-ink-2">
          {upcoming ? `Att betala den ${shortDate(data.payDay)}` : `Resultat för ${monthLabel(data.month).toLowerCase()}`}
        </h2>
        <span data-state={state} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", pill.className)}>
          {state === "open" ? `${monthLabel(data.month).toLowerCase()} · ${pill.label}` : pill.label}
        </span>
      </div>

      {/* Wide: me, the result, the partner. Narrow: the two of us on a row over the result. */}
      <div className="grid grid-cols-2 items-center gap-y-4 @[28rem]:grid-cols-[auto_minmax(0,1fr)_auto] @[28rem]:gap-x-4">
        <Person who="Jag" letter={initial(data.ownName, "J")} laidOut={figures.iPaid} tone="bg-wallet-private" />
        <div className="col-span-2 row-start-2 min-w-0 text-center @[28rem]:col-span-1 @[28rem]:col-start-2 @[28rem]:row-start-1">
          <p className="text-[13px] text-ink-2">{result > 0 ? `${p} ska betala dig` : result < 0 ? `Du ska betala ${p}` : "Ni är jämna"}</p>
          <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums" data-figure="result">
            <AnimatedNumber value={Math.abs(result)} format={(v) => formatKr(v)} />
          </p>
          <Direction result={result} />
        </div>
        <Person who={p} letter={initial(p, "P")} laidOut={figures.partnerPaid} tone="bg-partner" className="justify-self-end @[28rem]:col-start-3 @[28rem]:justify-self-auto" />
      </div>

      {upcoming && (
        <p className="text-[13px] text-ink-2">
          Hela {monthLabel(data.month).toLowerCase()}, med räkningarna som betalas {shortDate(data.payDay)} och resten av månadens fasta utgifter.
        </p>
      )}

      <div className="mt-auto border-t border-hairline pt-4 text-[13px]">
        {s ? (
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 font-medium">
              <Check className="size-4 text-positive" aria-hidden /> Avstämd {new Date(s.settledAt).toLocaleDateString("sv-SE")}
              {s.note && <span className="font-normal text-ink-2"> · {s.note}</span>}
            </p>
            {s.result !== 0 && (
              <p className="text-ink-2">
                {s.carryForward ? `Resultatet förs över till ${next}.` : `Kvitt: skillnaden på ${Math.round(Math.abs(s.result) / 100)} kr är nollställd, och ${next} börjar på 0.`}
              </p>
            )}
            {data.deviates && (
              <p className="rounded-inset bg-alarm-soft px-3 py-2 text-caution-text">
                Avviker från avstämningen: med dagens data blir resultatet {data.live.result >= 0 ? "" : "−"}
                {Math.round(Math.abs(data.live.result) / 100)} kr. Ändrade rader är markerade i uträkningen. Lås upp och stäm av igen för att ta med ändringarna.
              </p>
            )}
            <Button size="sm" onClick={() => act(() => sendJson("DELETE", `/shared/${data.month}/settlement`, {}))} className={SECONDARY}>
              <Lock /> Lås upp
            </Button>
          </div>
        ) : (
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              settle(true);
            }}
          >
            <div className="flex flex-wrap gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anteckning, t.ex. Swishat 25/9"
                aria-label="Anteckning till avstämningen"
                className="h-9 min-w-0 flex-1 basis-32 rounded-lg border border-neutral-bar bg-card px-3 text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {data.live.result === 0 || data.beforeStart ? (
                <Button type="submit" size="sm" className={PRIMARY}>
                  Stäm av
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => settle(false)} title="Skillnaden är reglerad eller inte värd att föra vidare: nästa månad börjar på 0" className={PRIMARY}>
                    Stäm av: vi är kvitt
                  </Button>
                  <Button type="submit" size="sm" title="Skillnaden följer med som ingående belopp nästa månad" className={SECONDARY}>
                    För över {wholeKr(data.live.result)} kr till {next}
                  </Button>
                </>
              )}
            </div>
            <p className="text-[11px] text-ink-3">
              Låser hela månaden. <b>Kvitt</b>: skillnaden är reglerad (eller för liten att bry sig om) och nästa månad börjar på 0. <b>För över</b>: den följer med
              till nästa månad. Senare ändringar visas som avvikelser.
            </p>
          </form>
        )}
      </div>
    </Card>
  );
}

const PRIMARY = "h-9 rounded-lg border-0 bg-ink px-3.5 text-[13px] font-semibold text-card hover:bg-ink/85";
const SECONDARY = "h-9 rounded-lg border-0 bg-card-inset px-3.5 text-[13px] font-medium text-ink hover:bg-segment";

function Person({ who, letter, laidOut, tone, className }: { who: string; letter: string; laidOut: number; tone: string; className?: string }) {
  return (
    <div className={cn("flex w-24 flex-col items-center gap-1 text-center", className)} data-person={who}>
      <span aria-hidden className={cn("grid size-14 place-items-center rounded-full text-xl font-bold text-white", tone)}>
        {letter}
      </span>
      <span className="text-[13px] font-semibold">{who}</span>
      <span className="text-[11px] text-ink-3 tabular-nums">lagt ut {wholeKr(laidOut)} kr</span>
    </div>
  );
}

/**
 * A 2 px green line with its head at the one who gets the money: left (me)
 * when the partner pays, right (the partner) when I do. Even: no arrow.
 */
function Direction({ result }: { result: number }) {
  if (result === 0) return <p className="mt-3 text-[11px] text-ink-3">ni är kvitt</p>;
  const toMe = result > 0;
  return (
    <div className="mt-3" data-direction={toMe ? "to-me" : "to-partner"}>
      <svg viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden className="h-2.5 w-full overflow-visible text-positive">
        <line x1="0" x2="200" y1="5" y2="5" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The head drawn apart, so the stretched line doesn't distort it. */}
      <div className={cn("-mt-[11px] flex", toMe ? "justify-start" : "justify-end")} aria-hidden>
        <svg viewBox="0 0 10 12" className="h-3 w-2.5 text-positive">
          <path d={toMe ? "M10 0 L0 6 L10 12 Z" : "M0 0 L10 6 L0 12 Z"} fill="currentColor" />
        </svg>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-3">{toMe ? "← pengarna går åt det här hållet" : "pengarna går åt det här hållet →"}</p>
    </div>
  );
}
