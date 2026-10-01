import { useState } from "react";
import { Plus, X } from "lucide-react";
import { sendJson, type Contact } from "../../../api";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import { CompactRow, Editable } from "../compact";
import { contactsSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/** Kontakter: names shown in the lists instead of the Swish number. The page loads them (Partner uses them too). */
export function ContactsSection({ open, onToggle, match, contacts, onChanged }: SectionProps & { contacts: Contact[]; onChanged: () => void }) {
  const [contactDraft, setContactDraft] = useState<{ names: Record<string, string>; removed: number[]; added: { counterparty: string; name: string }[] }>({
    names: {},
    removed: [],
    added: [],
  });
  const s = contactsSummary(contacts);
  if (!match("Kontakter", "Swish-nummer", ...contacts.map((c) => c.name), s.hint)) return null;
  const reload = onChanged;
  return (
    <CompactRow id="kontakter" name="Kontakter" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
          <Editable
            description="Namn som visas i listorna i stället för Swish-numret."
            onEdit={() => setContactDraft({ names: Object.fromEntries(contacts.map((c) => [c.counterparty, c.name])), removed: [], added: [] })}
            onSave={async () => {
              for (const c of contacts) {
                if (contactDraft.removed.includes(c.id)) await sendJson("DELETE", `/contacts/${c.id}`, {});
                else if ((contactDraft.names[c.counterparty] ?? c.name).trim() && contactDraft.names[c.counterparty].trim() !== c.name) {
                  await sendJson("PUT", "/contacts", { counterparty: c.counterparty, name: contactDraft.names[c.counterparty].trim() });
                }
              }
              for (const a of contactDraft.added) if (a.counterparty.trim() && a.name.trim()) await sendJson("PUT", "/contacts", { counterparty: a.counterparty.trim(), name: a.name.trim() });
              reload();
            }}
            edit={
              <div className="space-y-2">
                {contacts
                  .filter((c) => !contactDraft.removed.includes(c.id))
                  .map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 font-mono text-xs">{c.counterparty}</span>
                      <input
                        aria-label={`Namn för ${c.counterparty}`}
                        className={FIELD}
                        value={contactDraft.names[c.counterparty] ?? ""}
                        onChange={(e) => setContactDraft((d) => ({ ...d, names: { ...d.names, [c.counterparty]: e.target.value } }))}
                      />
                      <Button size="icon" variant="ghost" aria-label={`Ta bort ${c.name}`} onClick={() => setContactDraft((d) => ({ ...d, removed: [...d.removed, c.id] }))}>
                        <X />
                      </Button>
                    </div>
                  ))}
                {contactDraft.added.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      aria-label="Nummer"
                      placeholder="Nummer"
                      className={cn(FIELD, "w-36 shrink-0 font-mono text-xs")}
                      value={a.counterparty}
                      onChange={(e) => setContactDraft((d) => ({ ...d, added: d.added.map((x, j) => (j === i ? { ...x, counterparty: e.target.value } : x)) }))}
                    />
                    <input
                      aria-label="Namn"
                      placeholder="Namn"
                      className={FIELD}
                      value={a.name}
                      onChange={(e) => setContactDraft((d) => ({ ...d, added: d.added.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                    />
                    <span className="size-8 shrink-0" />
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setContactDraft((d) => ({ ...d, added: [...d.added, { counterparty: "", name: "" }] }))}>
                  <Plus /> Ny kontakt
                </Button>
              </div>
            }
          >
            {contacts.length === 0 ? (
              <p className="text-[13px] text-ink-2">Inga kontakter ännu.</p>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                    <span className="w-36 shrink-0 font-mono text-[11px] text-ink-2">{c.counterparty}</span>
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Editable>
    </CompactRow>
  );
}
