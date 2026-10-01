import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { getJson, sendJson, type ReferenceHousehold, type ReferenceHouseholdResponse, type ReferencePerson, type ReferencePersonRole } from "../../../api";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import { CompactRow, Editable } from "../compact";
import { referenceSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Referensbudget: vilka Konsumentverkets hushållskostnader räknas för. The
 * persons, each with the age group and food variant the reference is priced
 * by, and the items that don't apply to this household (water and
 * electricity in the rent, the child items without children). No birth date
 * is kept; an exact age is optional and only moves the footnotes.
 */
export function ReferenceSection({ open, onToggle, match }: SectionProps) {
  const [data, setData] = useState<ReferenceHouseholdResponse | null>(null);
  const [draft, setDraft] = useState<ReferenceHousehold>({ persons: [], excluded: [] });
  useEffect(() => {
    getJson<ReferenceHouseholdResponse>("/reference-budget/household").then(setData, () => setData(null));
  }, []);
  if (!data?.options) return null;
  const s = referenceSummary(data);
  if (!match("Referensbudget", "Konsumentverket", s.summary, s.hint)) return null;
  const { options, partnerName, household } = data;
  const ageLabel = (key: string) => options.ageGroups.find((g) => g.key === key)?.label ?? key;
  const foodName = (key: string) => options.food.find((f) => f.key === key)?.name.replace(/^Livsmedel, /, "") ?? key;
  const itemName = (key: string) => options.items.find((i) => i.key === key)?.name ?? key;
  const nameOf = (p: ReferencePerson) => (p.role === "me" ? "Jag" : p.role === "partner" ? partnerName : (p.name ?? ""));
  // The food variants are chosen per person, not excluded.
  const excludable = options.items.filter((i) => !options.food.some((f) => f.key === i.key));
  const newPerson = (role: ReferencePersonRole): ReferencePerson => ({ role, ...(role === "other" ? { name: "" } : {}), ageGroup: "25-50", food: options.food[0]?.key ?? "", age: null });
  const setPerson = (i: number, patch: Partial<ReferencePerson>) => setDraft((d) => ({ ...d, persons: d.persons.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  return (
    <CompactRow id="referensbudget" name="Referensbudget" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <Editable
        description={`Hushållet som Konsumentverkets beräknade hushållskostnader (${options.year}) räknas för i Analys. Åldersgrupp och matvariant per person, och poster som inte gäller er, till exempel el och vatten som ingår i hyran.`}
        onEdit={() => setDraft(household ?? { persons: [newPerson("me")], excluded: [] })}
        onSave={async () => {
          setData(await sendJson<ReferenceHouseholdResponse>("PUT", "/reference-budget/household", draft));
        }}
        edit={
        <div className="space-y-4">
          <div className="space-y-2">
            {draft.persons.map((p, i) => (
              <div key={i} className="grid items-end gap-2 @[40rem]:grid-cols-[10rem_9rem_minmax(0,1fr)_5rem_2rem]">
                {p.role === "other" ? (
                  <label className="grid gap-1 text-[13px]">
                    <span className="text-[11px] text-ink-2">Namn</span>
                    <input aria-label={`Person ${i + 1}, namn`} className={FIELD} value={p.name ?? ""} onChange={(e) => setPerson(i, { name: e.target.value })} />
                  </label>
                ) : (
                  <div className="grid gap-1 text-[13px]">
                    <span className="text-[11px] text-ink-2">{p.role === "me" ? "Du" : "Partner"}</span>
                    <span className="flex h-8 items-center">{nameOf(p)}</span>
                  </div>
                )}
                <label className="grid gap-1 text-[13px]">
                  <span className="text-[11px] text-ink-2">Åldersgrupp</span>
                  <select aria-label={`${nameOf(p) || `Person ${i + 1}`}, åldersgrupp`} className={FIELD} value={p.ageGroup} onChange={(e) => setPerson(i, { ageGroup: e.target.value })}>
                    {options.ageGroups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[13px]">
                  <span className="text-[11px] text-ink-2">Mat</span>
                  <select aria-label={`${nameOf(p) || `Person ${i + 1}`}, mat`} className={FIELD} value={p.food} onChange={(e) => setPerson(i, { food: e.target.value })}>
                    {options.food.map((f) => (
                      <option key={f.key} value={f.key}>
                        {foodName(f.key)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[13px]">
                  <span className="text-[11px] text-ink-2">Ålder (valfri)</span>
                  <input
                    aria-label={`${nameOf(p) || `Person ${i + 1}`}, ålder`}
                    inputMode="numeric"
                    className={cn(FIELD, "tabular-nums")}
                    value={p.age ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      // Digits only: anything else is left as it was, rather than saved as nothing.
                      if (v === "" || /^\d{1,3}$/.test(v)) setPerson(i, { age: v === "" ? null : Number(v) });
                    }}
                  />
                </label>
                {p.role === "me" ? (
                  <span />
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`Ta bort ${nameOf(p) || `person ${i + 1}`}`} onClick={() => setDraft((d) => ({ ...d, persons: d.persons.filter((_, j) => j !== i) }))}>
                    <X />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              {!draft.persons.some((p) => p.role === "partner") && (
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, persons: [...d.persons, newPerson("partner")] }))}>
                  <Plus /> {partnerName === "partnern" ? "Partner" : partnerName}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, persons: [...d.persons, newPerson("other")] }))}>
                <Plus /> Person
              </Button>
            </div>
            <p className="text-xs text-ink-3">Åldern behövs bara för fotnoterna: hygien är lägre för 18–19 år och över 65, och internet och mobil är lägre med barn under 8.</p>
          </div>
          <fieldset>
            <legend className="text-[11px] text-ink-2">Räknas inte för er</legend>
            <div className="mt-1 grid gap-x-4 gap-y-1 @[40rem]:grid-cols-2">
              {excludable.map((it) => (
                <label key={it.key} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={draft.excluded.includes(it.key)}
                    onChange={(e) => setDraft((d) => ({ ...d, excluded: e.target.checked ? [...d.excluded, it.key] : d.excluded.filter((k) => k !== it.key) }))}
                  />
                  {it.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        }
      >
      {household ? (
          <div className="space-y-2 text-[13px]">
            <ul className="space-y-0.5">
              {household.persons.map((p, i) => (
                <li key={i}>
                  {nameOf(p)} <span className="text-ink-2">· {ageLabel(p.ageGroup)}{p.age != null && ` (${p.age} år)`} · {foodName(p.food)}</span>
                </li>
              ))}
            </ul>
            <p className="text-ink-2">
              {household.persons.length} {household.persons.length === 1 ? "person" : "personer"} i hushållet.{" "}
              {household.excluded.length > 0 ? `Räknas inte: ${household.excluded.map(itemName).join(", ")}.` : "Alla poster räknas."}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">Inte inställt än. Ange vilka som bor i hushållet, så kan Analys jämföra era utgifter med referensen.</p>
        )}
      </Editable>
    </CompactRow>
  );
}
