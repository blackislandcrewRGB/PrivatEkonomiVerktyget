import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { uploadAvanzaStatements, type RealSavings } from "../../../api";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { BUTTON } from "../../settings/ui";
import { monthLabel, wholeKr } from "../common";
import { signedKr } from "./ValueCard";

/** '+16,1 %' / '−2,9 %', one decimal with the sign. */
export const signedPct = (x: number | null) => {
  if (x === null) return "–";
  const v = Math.round(x * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
};
/** '1 jan 2026'. */
export const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
/** 'augusti 2026'. */
export const kpiName = (month: string) => monthLabel(month, true);

const toneOf = (ore: number | null) => (ore === null || Math.round(ore / 100) === 0 ? "zero" : ore > 0 ? "up" : "down");

/**
 * Sparandet efter inflation (Design v2): the real gain in large type – what
 * the ISK is worth beyond the money put in counted at today's prices – with
 * the real, nominal and inflation rates under it, and a bar of today's
 * value: what was put in, what inflation took of the gain, and the real
 * gain (a loss marked in red past the value). The ISK tax, paid through the
 * final tax, is taken off at the end.
 */
export function RealCard({ data, onStatements }: { data: RealSavings; onStatements: () => void }) {
  const t = data.totals;
  const net = !!data.avanza?.statements.some((s) => s.account === "credit");
  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="real-title" data-card="real">
      <div>
        <h2 id="real-title" className="text-[15px] font-semibold">
          Sparandet efter inflation
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-3">
          hela ISK:t, värdepapper och likvider{net ? ", minus krediten" : ""}
          {t ? ` · sedan ${longDate(t.since)}` : ""} · pengarna räknade i dagens penningvärde enligt KPI
          {data.kpiMonth ? ` (${kpiName(data.kpiMonth)})` : ""}
        </p>
      </div>
      {!t ? (
        <p className="text-[13px] text-ink-3">Det behövs två värden på ISK:t för att mäta något: för in ett kvartalsvärde från Avanza.</p>
      ) : (
        <>
          <Hero t={t} />
          {t.netTodayOre !== null && t.inflationOre !== null && t.realGainOre !== null && <Bar t={t} />}
        </>
      )}
      <Statements data={data} onStatements={onStatements} />
    </section>
  );
}

type Totals = NonNullable<RealSavings["totals"]>;

function Hero({ t }: { t: Totals }) {
  const real = t.realGainOre;
  const tone = toneOf(real);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3" data-part="hero">
      <div>
        <p className="text-[12px] text-ink-2">Real vinst, i dagens penningvärde</p>
        <p
          className={cn("text-[40px] font-bold leading-none tracking-tight tabular-nums", tone === "up" ? "text-positive-text" : tone === "down" ? "text-alarm" : "text-ink")}
          data-tone={tone}
          data-figure="real-gain"
        >
          {real === null ? "–" : signedKr(real)}
        </p>
        <p className="mt-1.5 text-[12px] text-ink-2 tabular-nums" data-figure="rates">
          real avkastning <b className="text-ink">{signedPct(t.real)}</b> · nominellt {signedPct(t.nominal)} · inflation {signedPct(t.inflation)}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[12px] tabular-nums" data-part="facts">
        <dt className="text-ink-2">Värde {longDate(t.until)}</dt>
        <dd className="text-right font-semibold">{wholeKr(t.endOre)}</dd>
        <dt className="text-ink-2">Start {longDate(t.since)}</dt>
        <dd className="text-right">{wholeKr(t.startOre)}</dd>
        <dt className="text-ink-2">Insatt netto sedan dess</dt>
        <dd className="text-right">{signedKr(t.netOre)}</dd>
        {t.creditInterestOre !== null && t.creditInterestOre > 0 && (
          <>
            <dt className="text-ink-2" title="Räntan gör skulden större och finns därför redan i värdet">
              Ränta på krediten, ingår
            </dt>
            <dd className="text-right text-ink-2" data-figure="credit-interest">
              {wholeKr(t.creditInterestOre)}
            </dd>
          </>
        )}
        {t.iskTaxOre !== null && t.iskTaxOre > 0 && (
          <>
            <dt className="text-ink-2">Efter ISK-skatt</dt>
            <dd className="text-right" data-figure="after-tax">
              {signedKr(t.realGainAfterTaxOre ?? 0)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * Today's value from what makes it up: put in (grey), what inflation took
 * (orange) and the real gain (green). Below the line of keeping up, the part
 * short of it is red instead.
 */
function Bar({ t }: { t: Totals }) {
  const nominalIn = t.startOre + t.netOre;
  const inflation = Math.max(0, t.inflationOre!);
  const real = t.realGainOre!;
  const whole = Math.max(t.endOre, t.netTodayOre!, 1);
  const w = (ore: number) => `${(Math.max(0, ore) / whole) * 100}%`;
  const legend = [
    { key: "in", label: "Insatt", value: wholeKr(nominalIn), dot: "bg-ink-3" },
    { key: "inflation", label: "Inflationen", value: wholeKr(inflation), dot: "bg-caution" },
    real >= 0
      ? { key: "real", label: "Real vinst", value: wholeKr(real), dot: "bg-positive" }
      : { key: "real", label: "Real förlust", value: wholeKr(-real), dot: "bg-alarm" },
  ];
  return (
    <div className="space-y-2" data-part="bar">
      <div className="relative flex h-6 w-full overflow-hidden rounded-[7px] bg-track" role="img" aria-label={`Värdet ${wholeKr(t.endOre)}: insatt ${legend[0].value}, inflationen ${legend[1].value}, ${legend[2].label.toLowerCase()} ${legend[2].value}`}>
        <span className="h-full bg-ink-3/60" style={{ width: w(Math.min(nominalIn, t.netTodayOre!)) }} data-segment="in" />
        {/* A sliver at least, so a small part is still there to see. */}
        <span className="h-full bg-caution" style={{ width: w(inflation), minWidth: Math.round(inflation / 100) > 0 ? 3 : 0 }} data-segment="inflation" />
        {real >= 0 && <span className="h-full bg-positive" style={{ width: w(real) }} data-segment="real" />}
        {real < 0 && (
          <span
            className="absolute inset-y-0 bg-alarm/70 [background-image:repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,0.35)_4px_8px)]"
            style={{ left: w(t.endOre), width: w(-real) }}
            data-segment="loss"
          />
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5" data-legend={l.key}>
            <span className={cn("size-2 rounded-full", l.dot)} aria-hidden />
            {l.label} <span className="font-semibold text-ink tabular-nums">{l.value}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-3">
        Insatt är startvärdet och det du satt in netto. Inflationen är vad det behövt öka bara för att köpa lika mycket i dag; resten är real vinst. ISK-skatten betalas via
        slutskatten året efter och finns inte i värdet.
      </p>
    </div>
  );
}

/** '2024–2025', or one year. */
const years = (from: string, to: string) => (from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from.slice(0, 4)}–${to.slice(0, 4)}`);

/**
 * Avanza's kontobesked read in (ISK and credit, the years each covers) and
 * the button to read more: the money put in, the credit's debt and its
 * interest come from them for those years. The file isn't kept.
 */
function Statements({ data, onStatements }: { data: RealSavings; onStatements: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const statements = data.avanza?.statements ?? [];
  const span = (account: "isk" | "credit") => {
    const own = statements.filter((s) => s.account === account);
    return own.length ? years(own[0].periodFrom, own.at(-1)!.periodTo) : null;
  };
  const read = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const read = await uploadAvanzaStatements(files);
      notify({ text: `${read.length === 1 ? "Ett kontobesked" : `${read.length} kontobesked`} från Avanza inläst.` });
      onStatements();
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const isk = span("isk");
  const credit = span("credit");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3" data-part="statements">
      <p className="min-w-0 flex-1 basis-60 text-[11px] text-ink-3">
        {isk || credit
          ? `Kontobesked från Avanza: ${[isk && `ISK ${isk}`, credit && `kredit ${credit}`].filter(Boolean).join(" · ")}. För de åren kommer insättningar, uttag och skulden på krediten därifrån; efter dem från banken.`
          : "Läs in Avanzas kontobesked (ISK och kreditkonto) för år före bankdatan, eller om ISK:t lånat av en kredit. Bara belopp och datum sparas, inte filen."}
      </p>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Kontobesked från Avanza" onChange={(e) => void read([...(e.target.files ?? [])])} />
      <button type="button" className={BUTTON.grey} disabled={busy} onClick={() => input.current?.click()}>
        <FileUp className="size-3.5" aria-hidden /> {busy ? "Läser …" : "Läs in kontobesked"}
      </button>
    </div>
  );
}
