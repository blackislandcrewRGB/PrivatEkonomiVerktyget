import { Equal, Minus, Plus } from "lucide-react";
import type { SharedFigures, SharedMonth } from "../../api";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { monthLabel } from "./summary";

type Sign = "" | "+" | "−" | "=";
const SIGN_ICON = { "": null, "+": Plus, "−": Minus, "=": Equal } as const;

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;

/**
 * Uträkning as a receipt: a line per term with its operator in a round grey
 * badge, a note under a name where it helps ('(15 393 − 0) / 2', 'avstämd,
 * kvitt'), the amount to the right; the result last, in bold under a black
 * rule. A settled month whose figures have moved shows the locked and the
 * current amount side by side, the changed ones struck through.
 */
export function Receipt({ data }: { data: SharedMonth }) {
  const s = data.settlement;
  const p = data.partnerName;
  const main: SharedFigures = s ?? data.live;
  const showBoth = !!s && data.deviates;
  const differs = (k: keyof SharedFigures) => showBoth && s![k] !== data.live[k];
  const any = (k: keyof SharedFigures) => main[k] !== 0 || data.live[k] !== 0;
  const whole = (ore: number) => Math.round(ore / 100).toLocaleString("sv-SE");
  const lines: { label: string; note?: string; key: keyof SharedFigures; sign: Sign; hide?: boolean }[] = [
    { label: "Delat som jag betalat", key: "iPaid", sign: "" },
    { label: `Delat som ${p} betalat`, key: "partnerPaid", sign: "−" },
    { label: "Hälften av skillnaden", note: `(${whole(main.iPaid)} − ${whole(main.partnerPaid)}) / 2`, key: "half", sign: "=" },
    { label: `${p}s köp som jag betalat`, key: "iPaidForPartner", sign: "+", hide: !any("iPaidForPartner") },
    { label: `Mina köp som ${p} betalat`, key: "partnerPaidForMe", sign: "−", hide: !any("partnerPaidForMe") },
    { label: `Från ${p}`, key: "fromPartner", sign: "−" },
    { label: `Till ${p}`, key: "toPartner", sign: "+" },
    {
      label: data.carryFrom ? `Ingående från ${monthLabel(data.carryFrom.month).toLowerCase()}` : "Ingående",
      note: data.carryFrom?.settledEven ? "avstämd, kvitt" : data.carryFrom?.reconciled ? "avstämd" : undefined,
      key: "carryIn",
      sign: "+",
      hide: !data.carryFrom && main.carryIn === 0,
    },
  ];
  return (
    <Card aria-labelledby="receipt-title" className="text-[13px]">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="receipt-title" className="text-base font-semibold">
          Uträkning
        </h2>
        {showBoth && <span className="text-[11px] text-ink-3">avstämt · nu</span>}
      </div>
      <ol>
        {lines
          .filter((l) => !l.hide)
          .map((l) => (
            <Line
              key={l.key}
              lineKey={l.key}
              sign={l.sign}
              label={l.label}
              note={l.note}
              value={main[l.key]}
              now={differs(l.key) ? data.live[l.key] : null}
              showBoth={showBoth}
              changed={differs(l.key)}
            />
          ))}
        <Line
          lineKey="result"
          sign="="
          total
          label={main.result >= 0 ? `${p} ska betala dig` : `Du ska betala ${p}`}
          value={Math.abs(main.result)}
          now={showBoth && data.live.result !== s!.result ? Math.abs(data.live.result) : null}
          showBoth={showBoth}
        />
      </ol>
      <p className="mt-4 text-[11px] text-ink-3">
        Hälften av det ni lagt ut var för sig, plus det som är helt den andras, minus det {p} redan swishat (netto). Ingående är förra månadens resultat.
      </p>
    </Card>
  );
}

function Line({
  lineKey,
  sign,
  label,
  note,
  value,
  now,
  showBoth,
  changed,
  total,
}: {
  lineKey: string;
  sign: Sign;
  label: string;
  note?: string;
  value: number;
  now: number | null;
  showBoth: boolean;
  changed?: boolean;
  total?: boolean;
}) {
  const Icon = SIGN_ICON[sign];
  return (
    <li
      data-line={lineKey}
      data-sign={sign}
      data-ore={value}
      className={cn("flex items-center gap-3 py-2.5", total ? "mt-1 border-t border-ink font-bold" : "border-t border-hairline first:border-t-0")}
    >
      <span aria-hidden className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", total ? "bg-ink text-card" : "bg-card-inset text-ink-2")}>
        {Icon && <Icon className="size-3" strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        {label}
        {note && <span className="ml-1.5 text-[11px] font-normal text-ink-3 tabular-nums">{note}</span>}
      </span>
      <span className={cn("tabular-nums", changed && "text-alarm line-through decoration-1")}>{kr(value)}</span>
      {showBoth && <span className="w-20 text-right tabular-nums text-alarm">{now !== null ? kr(now) : ""}</span>}
    </li>
  );
}
