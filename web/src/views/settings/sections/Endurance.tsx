import { useEffect, useState } from "react";
import { formatSek, getJson, parseKr, sendJson, type Account, type NetworthSettings } from "../../../api";
import { cn } from "../../../lib/cn";
import { CompactRow, Editable, Field } from "../compact";
import { enduranceSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Uthållighet och a-kassa: which account the buffer stands on, and the
 * unemployment insurance's own numbers. They are settings and not constants
 * because they are a political decision — the ceiling and the steps have
 * moved twice in two years. The tax is the rate the payslips actually show
 * unless something else is written in.
 */
export function EnduranceSection({ open, onToggle, match }: SectionProps) {
  const [data, setData] = useState<NetworthSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState({ account: "", cap: "", days: "", tax: "", steps: "" });
  useEffect(() => {
    getJson<NetworthSettings>("/networth/settings").then(setData, () => setData(null));
    getJson<Account[]>("/accounts").then(setAccounts, () => setAccounts([]));
  }, []);
  if (!data) return null;
  const s = enduranceSummary(data);
  if (!match("Uthållighet och a-kassa", s.summary, s.hint)) return null;
  const a = data.akassa;
  const banks = accounts.filter((x) => x.kind === "bank" && x.trackBalance);
  const stepText = (steps: { days: number; rate: number }[]) => steps.map((x) => `${Math.round(x.rate * 100)}/${x.days}`).join(" ");

  return (
    <CompactRow id="uthallighet" name="Uthållighet och a-kassa" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <Editable
        description="Bufferten mäts mot ett konto, och a-kassan räknas på snittet av dina lönespecar."
        onEdit={() =>
          setDraft({
            account: String(data.bufferAccount?.id ?? ""),
            cap: String(Math.round(a.incomeCapOre / 100)),
            days: String(a.daysPerMonth),
            tax: a.taxRate === null ? "" : String(Math.round(a.taxRate * 1000) / 10),
            steps: stepText(a.steps),
          })
        }
        onSave={async () => {
          const capOre = parseKr(draft.cap);
          if (capOre === null) throw new Error("Skriv taket i kronor per månad.");
          const daysPerMonth = Number(draft.days.replace(",", "."));
          if (!(daysPerMonth > 0)) throw new Error("Ersättningsdagar per månad ska vara fler än noll.");
          // '80/100 70/100 65/100': the share and the days it lasts.
          const steps = draft.steps
            .trim()
            .split(/\s+/)
            .map((part) => {
              const [rate, days] = part.split("/").map((x) => Number(x.replace(",", ".")));
              if (!(rate > 0 && rate <= 100) || !(days > 0)) throw new Error(`'${part}' ska vara procent/dagar, till exempel 80/100.`);
              return { rate: rate / 100, days };
            });
          const tax = draft.tax.trim() === "" ? null : Number(draft.tax.replace(",", ".")) / 100;
          if (tax !== null && !(tax > 0 && tax <= 1)) throw new Error("Skattesatsen skrivs i procent, eller lämnas tom för lönespecarnas egen.");
          const r = await sendJson<NetworthSettings>("PUT", "/networth/settings", {
            bufferAccountId: draft.account === "" ? null : Number(draft.account),
            akassa: { incomeCapOre: capOre, daysPerMonth, steps, taxRate: tax },
          });
          setData(r);
        }}
        edit={
          <div className="grid gap-3 @[40rem]:grid-cols-2">
            <Field label="Buffertkonto">
              <select aria-label="Buffertkonto" className={FIELD} value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })}>
                <option value="">Inget</option>
                {banks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tak, ersättningsgrundande inkomst (kr/mån)">
              <input aria-label="Tak" inputMode="decimal" className={cn(FIELD, "tabular-nums")} value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: e.target.value })} />
            </Field>
            <Field label="Nivåer (procent/dagar)">
              <input aria-label="Nivåer" className={FIELD} placeholder="80/100 70/100 65/100" value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} />
            </Field>
            <Field label="Ersättningsdagar per månad">
              <input aria-label="Ersättningsdagar per månad" inputMode="decimal" className={cn(FIELD, "tabular-nums")} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
            </Field>
            <Field label="Preliminärskatt på ersättningen (%), tom = lönespecarnas egen" className="@[40rem]:col-span-2">
              <input aria-label="Preliminärskatt" inputMode="decimal" className={cn(FIELD, "w-32 tabular-nums")} value={draft.tax} onChange={(e) => setDraft({ ...draft, tax: e.target.value })} />
            </Field>
          </div>
        }
      >
        <p className="text-[13px]">
          Buffertkonto <span className="font-semibold">{data.bufferAccount?.name ?? "inget valt"}</span>
        </p>
        <p className="text-[12px] text-ink-2">
          Tak <span className="tabular-nums">{formatSek(a.incomeCapOre)}</span>/mån · {a.steps.map((x) => `${Math.round(x.rate * 100)} % i ${x.days} dagar`).join(", ")} · {a.daysPerMonth} dagar/mån · skatt{" "}
          {a.taxRate === null
            ? `${data.payslipTaxRate === null ? "–" : (data.payslipTaxRate * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % enligt lönespecarna`
            : `${(a.taxRate * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`}
        </p>
      </Editable>
    </CompactRow>
  );
}
