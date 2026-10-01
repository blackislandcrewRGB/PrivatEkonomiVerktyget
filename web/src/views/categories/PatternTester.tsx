import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { sendJson, type Rule, type RulePreview } from "../../api";
import { Amount } from "../../components/Amount";
import { CategoryChip } from "../../components/CategoryChip";
import { CategoryPicker } from "../../components/CategoryPicker";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { useShowPrivate } from "../../privacy";
import { dm } from "../overview/format";

export interface TesterHandle {
  /** Fills the tester (from a rule's menu) and focuses the pattern. */
  load: (r: Pick<Rule, "pattern" | "matchType" | "direction" | "categoryId">) => void;
  focus: () => void;
}

export const MATCH_LABEL: Record<Rule["matchType"], string> = { contains: "innehåller", exact: "exakt", regex: "regex" };
export const DIRECTION_LABEL: Record<Rule["direction"], string> = { any: "alla", out: "pengar ut", in: "pengar in" };

/**
 * 'Testa mönster': type a pattern and see at once which rows it would match
 * (all rows, newest first) and how many have no category yet, before saving
 * it as a rule.
 */
export const PatternTester = forwardRef<
  TesterHandle,
  { onSaved: (result: { rule: Rule; applied: number; previousCategoryId: number | null; before: unknown }) => void }
>(function PatternTester({ onSaved }, ref) {
  // 'Testa' asks at once instead of a moment after typing stops.
  const [now, setNow] = useState(0);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<Rule["matchType"]>("contains");
  const [direction, setDirection] = useState<Rule["direction"]>("any");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [all, setAll] = useState(false);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const showPrivate = useShowPrivate();

  useImperativeHandle(ref, () => ({
    load: (r) => {
      setPattern(r.pattern);
      setMatchType(r.matchType);
      setDirection(r.direction);
      setCategoryId(r.categoryId);
      setTimeout(() => input.current?.focus(), 0);
    },
    focus: () => {
      setTimeout(() => input.current?.focus(), 0);
    },
  }));

  // Live, a moment after typing stops.
  useEffect(() => {
    setError(null);
    if (!pattern.trim()) return setPreview(null);
    let live = true;
    const t = setTimeout(() => {
      sendJson<RulePreview>("POST", "/rules/preview", { pattern, matchType, direction, examples: true }).then(
        (p) => live && setPreview(p),
        () => live && setPreview(null),
      );
    }, now ? 0 : 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pattern, matchType, direction, now]);

  const save = async () => {
    if (!pattern.trim() || categoryId === null) return setError("Välj en kategori för regeln.");
    try {
      const result = await sendJson<{ rule: Rule; applied: number; previousCategoryId: number | null; before: unknown }>("POST", "/rules", {
        pattern: pattern.trim(),
        matchType,
        direction,
        categoryId,
      });
      onSaved(result);
      setPattern("");
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = preview ? (all ? preview.rows : preview.rows.slice(0, 8)) : [];
  const open = pattern.trim() !== "";
  return (
    <section aria-labelledby="tester-title" className="min-w-0 rounded-card bg-card text-ink shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent" aria-hidden>
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="tester-title" className="text-[13px] font-semibold">
            Testa mönster
          </h2>
          <p className="text-[11px] text-ink-3">se vilka rader en regel skulle träffa innan du sparar den</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <input
            ref={input}
            aria-label="Mönster att testa"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") return categoryId !== null ? save() : setNow((n) => n + 1);
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder="t.ex. ANTHROPIC eller \bICA\b"
            className="h-8 min-w-0 flex-1 rounded-[9px] border border-neutral-bar/70 bg-card px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20 sm:w-72"
          />
          <button
            type="button"
            onClick={() => {
              setNow((n) => n + 1);
              input.current?.focus();
            }}
            className="h-8 shrink-0 rounded-[9px] bg-card-inset px-3.5 text-[13px] font-semibold text-ink hover:bg-segment"
          >
            Testa
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-hairline px-4 py-3 text-[13px] sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<Rule["matchType"]>
              label="Typ"
              size="sm"
              appearance="v2"
              options={(["contains", "exact", "regex"] as const).map((v) => ({ value: v, label: MATCH_LABEL[v] }))}
              value={matchType}
              onChange={setMatchType}
            />
            <SegmentedControl<Rule["direction"]>
              label="Riktning"
              size="sm"
              appearance="v2"
              options={[
                { value: "any", label: "alla" },
                { value: "out", label: "ut" },
                { value: "in", label: "in" },
              ]}
              value={direction}
              onChange={setDirection}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-2">Kategori</span>
            <CategoryChip categoryId={categoryId} onClick={(e) => setPicker(e.currentTarget)} className="bg-card-inset" aria-label="Regelns kategori" />
            <CategoryPicker
              open={!!picker}
              onOpenChange={(o) => !o && setPicker(null)}
              anchor={picker}
              value={categoryId}
              rowIds={preview?.rows.slice(0, 20).map((r) => r.id) ?? []}
              onPick={(c) => setCategoryId(c.id)}
              title="Kategori för regeln"
            />
            <span className="flex-1" />
            {preview && (
              <span className="text-ink-2" aria-live="polite">
                {preview.total === 0 ? "Inga rader matchar." : `${preview.total} rader matchar · ${preview.matches} utan kategori får den direkt`}
              </span>
            )}
            <Button
              size="sm"
              disabled={!pattern.trim() || categoryId === null}
              onClick={save}
              className="h-8 rounded-[9px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover"
            >
              Spara som regel
            </Button>
          </div>
          {error && <p className="text-danger">{error}</p>}
          {rows.length > 0 && (
            <ul className="overflow-hidden rounded-inset bg-card-inset">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-t border-hairline px-3 py-1.5 text-[13px] first:border-t-0">
                  <span className="w-20 shrink-0 text-ink-3 tabular-nums">
                    {dm(r.bookingDate)} {r.bookingDate.slice(0, 4)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.private && !showPrivate ? "Privat" : r.descriptionClean}</span>
                  {r.isTransfer ? <span className="text-xs text-transfer">överföring</span> : <CategoryChip categoryId={r.categoryId} short />}
                  <span className="w-24 shrink-0 text-right">
                    <Amount ore={r.amount} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview && preview.rows.length > 8 && (
            <button type="button" onClick={() => setAll((a) => !a)} className="text-xs text-ink-2 hover:text-ink">
              {all ? "Visa färre" : `Visa ${preview.rows.length === preview.total ? "alla" : "de senaste"} ${preview.rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
});
