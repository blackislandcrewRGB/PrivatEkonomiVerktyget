import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { formatSek, getJson, sendJson, type LabelRulePreview, type Transaction } from "../../api";
import { useShowPrivate } from "../../privacy";

// Small editors shared by the transaction list, its detail panel and 'Att granska'.

/**
 * The note field, with autocomplete from notes written before: the best
 * match is filled in grey as you type (Tab or → takes it), and a list below
 * shows the others (↑/↓ and Enter, or click). Notes used on the same merchant
 * and category come first. Saves on blur and Enter, unless commitOnBlur is
 * false (a dialog with its own buttons): then Enter or a pick saves, Escape cancels.
 */
export function NoteInput({
  value,
  rowId,
  onDone,
  onCancel,
  onChange,
  autoFocus = true,
  commitOnBlur = true,
  placeholder,
}: {
  value: string;
  rowId: number;
  onDone: (v: string) => void;
  onCancel?: () => void;
  /** The text as it is typed. */
  onChange?: (v: string) => void;
  autoFocus?: boolean;
  commitOnBlur?: boolean;
  placeholder?: string;
}) {
  const showPrivate = useShowPrivate();
  const [draft, setDraftState] = useState(value);
  // The blur that follows a pick must save the pick, not the text typed before it.
  const draftRef = useRef(value);
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
    onChange?.(v);
  };
  const [all, setAll] = useState<{ note: string; count: number }[]>([]);
  const [active, setActive] = useState(-1);
  const [atEnd, setAtEnd] = useState(true);
  // Suggestions only while the field has focus (in the detail panel it doesn't at first).
  const [focused, setFocused] = useState(autoFocus);
  const hasFocus = useRef(false);
  // Show a new value from outside (another row in the panel, a bulk change) unless typing.
  useEffect(() => {
    if (!hasFocus.current) {
      draftRef.current = value;
      setDraftState(value);
    }
  }, [value, rowId]);

  useEffect(() => {
    let live = true;
    getJson<{ note: string; count: number }[]>(`/transactions/notes?for=${rowId}${showPrivate ? "&showPrivate=1" : ""}`)
      .then((r) => live && setAll(Array.isArray(r) ? r : []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rowId, showPrivate]);

  const typed = draft.trim().toLocaleLowerCase("sv-SE");
  const matches = typed
    ? [
        ...all.filter((s) => s.note.toLocaleLowerCase("sv-SE").startsWith(typed)),
        ...all.filter((s) => !s.note.toLocaleLowerCase("sv-SE").startsWith(typed) && s.note.toLocaleLowerCase("sv-SE").includes(typed)),
      ].filter((s) => s.note.toLocaleLowerCase("sv-SE") !== typed)
    : all;
  const shown = focused ? matches.slice(0, 6) : [];
  // Grey completion: the first suggestion that starts with what is typed, while the caret is at the end.
  const ghost =
    typed && atEnd && draft === draft.trimStart() && shown[0]?.note.toLocaleLowerCase("sv-SE").startsWith(draft.toLocaleLowerCase("sv-SE"))
      ? shown[0].note.slice(draft.length)
      : "";

  const choose = (note: string) => {
    setDraft(note);
    setFocused(false);
    setActive(-1);
    onDone(note.trim());
  };
  const trackCaret = (el: HTMLInputElement) => setAtEnd(el.selectionStart === el.value.length);

  return (
    <div className="relative">
      <div className="relative">
        {ghost && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre rounded-md border border-transparent px-1.5 py-0.5">
            <span className="invisible">{draft}</span>
            <span className="text-subtle">{ghost}</span>
          </div>
        )}
        <input
          autoFocus={autoFocus}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-autocomplete="both"
          className="relative w-full rounded-md border border-border bg-transparent px-1.5 py-0.5 outline-none focus:border-ring"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(-1);
            setFocused(true);
            trackCaret(e.target);
          }}
          onSelect={(e) => trackCaret(e.currentTarget)}
          onFocus={() => {
            hasFocus.current = true;
            setFocused(true);
          }}
          onBlur={() => {
            hasFocus.current = false;
            setFocused(false);
            if (commitOnBlur) onDone(draftRef.current.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown.length) {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp" && shown.length) {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, -1));
            } else if ((e.key === "Tab" || e.key === "ArrowRight") && ghost) {
              e.preventDefault();
              setDraft(shown[0].note);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0) choose(shown[active].note);
              else if (commitOnBlur) (e.target as HTMLInputElement).blur();
              else onDone(draftRef.current.trim());
            } else if (e.key === "Escape") {
              if (onCancel) {
                e.stopPropagation();
                return onCancel();
              }
              setDraft(value);
              onDone(value);
            }
          }}
        />
      </div>
      {shown.length > 0 && (
        <ul role="listbox" className="absolute right-0 z-30 mt-1 min-w-full w-max max-w-64 overflow-hidden rounded-md border border-border bg-surface py-1 text-sm shadow-panel">
          {shown.map((s, i) => (
            <li
              key={s.note}
              role="option"
              aria-selected={i === active}
              // mousedown, so the pick happens before the input's blur saves the draft
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s.note);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer justify-between gap-3 px-2 py-1 ${i === active ? "bg-surface-hover" : ""}`}
            >
              <span className="truncate">{s.note}</span>
              <span className="text-xs text-subtle">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The same note on several rows (the bulk bar's 'Anteckning', or N with rows
 * selected). Starts with their note if they all share one; empty removes it.
 */
export function BulkNoteDialog({
  rows,
  onSave,
  onClose,
}: {
  rows: Transaction[] | null;
  onSave: (rows: Transaction[], note: string) => void;
  onClose: () => void;
}) {
  const common = rows && rows.every((r) => (r.note ?? "") === (rows[0].note ?? "")) ? (rows[0].note ?? "") : "";
  const text = useRef(common);
  useEffect(() => {
    text.current = common;
  }, [rows, common]);
  const save = (note: string) => {
    if (!rows) return;
    onClose();
    onSave(rows, note.trim());
  };
  return (
    <Dialog open={rows !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Anteckning för {rows?.length} rader</DialogTitle>
        <DialogDescription className="mt-1">
          Alla markerade rader får samma anteckning{common ? "" : ", och den ersätter det som står där nu"}. Lämna tomt för att ta bort den.
        </DialogDescription>
        {rows && (
          <div className="mt-3 text-sm">
            <NoteInput
              value={common}
              rowId={rows[0].id}
              placeholder="Vad är det här?"
              commitOnBlur={false}
              onChange={(v) => (text.current = v)}
              onDone={save}
              onCancel={onClose}
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={() => save(text.current)}>
            Spara på {rows?.length} rader
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same name on several rows (the bulk bar's 'Namn', or L with rows
 * selected), shown instead of the bank's text. Starts with their name if they
 * all share one; empty shows the bank's text again. 'Ge nya importer samma
 * namn' also saves a name rule (pattern suggested from the rows' texts), which
 * names new imports and the other rows without a name it matches.
 */
export function BulkLabelDialog({
  rows,
  onSave,
  onClose,
}: {
  rows: Transaction[] | null;
  onSave: (rows: Transaction[], label: string, rulePattern: string | null) => void;
  onClose: () => void;
}) {
  const common = rows && rows.every((r) => (r.label ?? "") === (rows[0].label ?? "")) ? (rows[0].label ?? "") : "";
  const [text, setText] = useState(common);
  const [makeRule, setMakeRule] = useState(true);
  const [pattern, setPattern] = useState("");
  const [preview, setPreview] = useState<LabelRulePreview | null>(null);
  const ids = rows?.map((r) => r.id).join(",") ?? "";
  const imported = !!rows?.some((r) => r.source !== "manual");

  useEffect(() => {
    setText(common);
    setMakeRule(true);
    setPattern("");
    setPreview(null);
    if (!ids) return;
    let live = true;
    getJson<({ pattern: string } & LabelRulePreview) | null>(`/label-rules/suggest?ids=${ids}`)
      .then((s) => live && s && setPattern(s.pattern))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ids, common]);

  // What else the rule would rename now, as the pattern is edited.
  useEffect(() => {
    const p = pattern.trim();
    if (!p || !ids) return setPreview(null);
    let live = true;
    const t = setTimeout(() => {
      getJson<LabelRulePreview>(`/label-rules/preview?pattern=${encodeURIComponent(p)}&exclude=${ids}`)
        .then((r) => live && setPreview(r))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pattern, ids]);

  const texts = rows ? [...new Set(rows.map((r) => r.descriptionClean))] : [];
  const rule = makeRule && imported && text.trim() !== "" && pattern.trim() !== "";
  const save = () => {
    if (!rows) return;
    onClose();
    onSave(rows, text.trim(), rule ? pattern.trim() : null);
  };
  const n = rows?.length ?? 0;
  return (
    <Dialog open={rows !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Namn för {n === 1 ? "raden" : `${n} rader`}</DialogTitle>
        <DialogDescription className="mt-1">
          Visas i stället för bankens text ({texts.slice(0, 2).join(", ")}
          {texts.length > 2 ? ` och ${texts.length - 2} till` : ""}). Lämna tomt för att visa bankens text igen.
        </DialogDescription>
        <form
          className="mt-3 space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            aria-label="Namn"
            value={text}
            placeholder={rows?.[0]?.descriptionClean}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-ring"
          />
          {imported && (
            <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Ge nya importer samma namn
              </label>
              {makeRule && (
                <div className="mt-2 space-y-1.5 pl-6">
                  <label className="block">
                    <span className="text-xs text-muted">När bankens text innehåller</span>
                    <input
                      aria-label="Mönster"
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          save();
                        }
                      }}
                      className="mt-0.5 w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-[13px] outline-none focus:border-ring"
                    />
                  </label>
                  <p className="text-xs text-muted" aria-live="polite">
                    {!text.trim()
                      ? "Skriv ett namn först."
                      : preview && preview.matches > 0
                        ? `Döper också om ${preview.matches} ${preview.matches === 1 ? "annan rad" : "andra rader"} utan namn: ${preview.examples.slice(0, 3).join(", ")}${preview.examples.length > 3 ? " …" : ""}`
                        : "Inga andra rader utan namn träffas nu. Gäller kommande importer."}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary">
              {rule ? "Spara namn och regel" : `Spara på ${n === 1 ? "raden" : `${n} rader`}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline text input: saves on blur/Enter, Escape cancels. */
export function TextEdit({
  value,
  onDone,
  placeholder,
  className = "",
}: {
  value: string;
  onDone: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      autoFocus
      placeholder={placeholder}
      className={`w-full rounded-md border border-border bg-surface px-1.5 py-0.5 outline-none focus:border-ring ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(value);
      }}
    />
  );
}

/**
 * 'Returnerad': pick the refunds that belong to the purchase (suggested:
 * same account and merchant, adding up to the amount). Together they leave
 * every sum. Can be marked before the money is back.
 */
export function ReturnPanel({ purchase, onClose, onDone }: { purchase: Transaction; onClose: () => void; onDone: () => void }) {
  type Candidates = {
    candidates: { id: number; bookingDate: string; amount: number; description: string }[];
    suggested: number[];
  };
  const [data, setData] = useState<Candidates | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<Candidates>(`/transactions/${purchase.id}/refunds`).then(
      (d) => {
        setData(d);
        setPicked(new Set(d.suggested));
      },
      (e) => setError(String(e)),
    );
  }, [purchase.id]);

  const back = data ? data.candidates.filter((c) => picked.has(c.id)).reduce((s, c) => s + c.amount, 0) : 0;
  const save = async () => {
    try {
      await sendJson("POST", `/transactions/${purchase.id}/return`, { refundIds: [...picked] });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">
        Returnerad: {purchase.label ?? purchase.descriptionClean} {formatSek(purchase.amount)}
      </p>
      {!data ? null : data.candidates.length === 0 ? (
        <p className="text-muted">
          Ingen återbetalning från samma handlare på samma konto inom 120 dagar än. Du kan markera köpet ändå. När pengarna kommer: ångra och
          markera igen för att koppla dem.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-muted">Återbetalningar som hör till köpet:</p>
          {data.candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={(e) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(c.id);
                    else n.delete(c.id);
                    return n;
                  })
                }
              />
              <span className="tabular-nums text-muted">{c.bookingDate}</span>
              <span className="flex-1">{c.description}</span>
              <span className="tabular-nums text-income">{formatSek(c.amount)}</span>
            </label>
          ))}
          <p className={`text-xs ${back === -purchase.amount ? "text-income" : "text-warning"}`}>
            Tillbaka {formatSek(back)} av {formatSek(-purchase.amount)}
            {back !== -purchase.amount && " (resten räknas inte heller: köpet blev inte av)"}
          </p>
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={save} disabled={!data}>
          Markera som returnerad
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
      </div>
      <p className="text-xs text-subtle">Köpet och återbetalningarna ligger kvar i listan men räknas inte i några summor, i statistiken eller i avstämningen.</p>
    </div>
  );
}
