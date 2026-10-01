import { useState } from "react";
import { sendJson, type Contact, type Settings } from "../../../api";
import { CompactRow, Editable } from "../compact";
import { partnerSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Partner: Swish received from these numbers is Inkomst › Från partner and
 * counts in the shared economy, not as ordinary income; and my own name, for
 * my initial in Delad ekonomi. The page loads them (with the contacts, for
 * the number's name).
 */
export function PartnerSection({
  open,
  onToggle,
  match,
  numbers,
  setNumbers,
  ownName,
  setOwnName,
  partnerName,
  contacts,
}: SectionProps & {
  numbers: string[];
  setNumbers: (n: string[]) => void;
  ownName: string | null;
  setOwnName: (n: string | null) => void;
  partnerName: string;
  contacts: Contact[];
}) {
  const [numbersDraft, setNumbersDraft] = useState("");
  const [ownNameDraft, setOwnNameDraft] = useState("");
  const s = partnerSummary(numbers, contacts, partnerName, ownName);
  if (!match("Partner", "Swish", partnerName, s.summary, s.hint)) return null;
  return (
    <CompactRow id="partner" name="Partner" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
          <Editable
            description="Swish mottagen från de här numren blir Inkomst › Från partner och räknas i den delade ekonomin, inte som vanlig inkomst. Gäller kommande importer."
            onEdit={() => {
              setNumbersDraft(numbers.join(", "));
              setOwnNameDraft(ownName ?? "");
            }}
            onSave={async () => {
              const s = await sendJson<Settings>("PUT", "/settings", {
                partnerSwishNumbers: numbersDraft
                  .split(/[,;\n]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
                ownName: ownNameDraft,
              });
              setNumbers(s.partnerSwishNumbers);
              setOwnName(s.ownName);
            }}
            edit={
              <div className="grid gap-3">
                <label className="grid gap-1 text-[13px]">
                  <span className="text-[11px] text-ink-2">Swish-nummer, flera med komma</span>
                  <input autoFocus className={FIELD} value={numbersDraft} onChange={(e) => setNumbersDraft(e.target.value)} placeholder="07x-xxx xx xx" />
                </label>
                <label className="grid gap-1 text-[13px]">
                  <span className="text-[11px] text-ink-2">Ditt namn (valfritt: din initial i Delad ekonomi)</span>
                  <input className={FIELD} value={ownNameDraft} onChange={(e) => setOwnNameDraft(e.target.value)} maxLength={40} aria-label="Ditt namn" />
                </label>
              </div>
            }
          >
            <p className="mb-2 text-[13px] text-ink-2">Ditt namn: {ownName ?? "inte angivet"}</p>
            {numbers.length === 0 ? (
              <p className="text-[13px] text-ink-2">Inget nummer inlagt.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {numbers.map((n) => (
                  <li key={n} className="rounded-full bg-card-inset px-2.5 py-0.5 font-mono text-xs">
                    {n}
                    {contacts.find((c) => c.counterparty === n) && <span className="ml-1.5 font-sans text-ink-2">{contacts.find((c) => c.counterparty === n)!.name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Editable>
    </CompactRow>
  );
}
