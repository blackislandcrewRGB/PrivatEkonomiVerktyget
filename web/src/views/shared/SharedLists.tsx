import { useEffect, useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { parseKr, sendJson, shortDate, type SharedGroup, type SharedMonth, type SharedRow, type SwishCandidate } from "../../api";
import { Amount } from "../../components/Amount";
import { CategoryChip } from "../../components/CategoryChip";
import { EmptyState } from "../../components/EmptyState";
import { CategoryPicker } from "../../components/CategoryPicker";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SidePanel } from "../../components/SidePanel";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { monthLabel } from "./summary";

export type Act = (fn: () => Promise<unknown>) => Promise<boolean>;

/** A row in the lists: date, what, its pills, the category's dot and name (not on a phone), the amount; actions after. */
const ROW = "grid items-center gap-x-3 border-t border-hairline px-5 py-2 text-[13px] sm:px-6";
const rowColumns = (category: boolean, actions: boolean) =>
  cn(
    actions ? "grid-cols-[44px_minmax(0,1fr)_auto_auto]" : "grid-cols-[44px_minmax(0,1fr)_auto]",
    category && (actions ? "sm:grid-cols-[44px_minmax(0,1fr)_minmax(0,150px)_auto_auto]" : "sm:grid-cols-[44px_minmax(0,1fr)_minmax(0,150px)_auto]"),
  );

/** A pill after a row's text: grey (förväntat), blue (betalas …), purple (bara mitt). */
export function Pill({ tone = "grey", title, children }: { tone?: "grey" | "blue" | "purple"; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      data-pill={tone}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium leading-4",
        tone === "blue" ? "bg-accent-soft text-accent" : tone === "purple" ? "bg-purple-soft text-purple-text" : "bg-card-inset text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

/** A card's heading row: the title and the total. */
export function ListHeader({ title, total, id }: { title: React.ReactNode; total: number; id: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 py-4 sm:px-6">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <span className="text-[15px] font-bold tabular-nums">{formatKr(total)}</span>
    </div>
  );
}

/**
 * A group inside a list card: a light grey band (a chevron, the title with
 * its count and a note, the total) that folds its rows open; the rows with
 * date, text, pills, category and amount.
 */
export function Group({
  title,
  total,
  rows,
  defaultOpen = false,
  sign = -1,
  note,
  dot,
  categories = true,
  children,
}: {
  title: React.ReactNode;
  /** After the count, muted. */
  note?: React.ReactNode;
  total: number;
  rows: SharedRow[];
  defaultOpen?: boolean;
  /** Costs are shown as money out (−), money in (Swish from her) as +. */
  sign?: 1 | -1;
  /** A coloured dot before the title (the Swish directions). */
  dot?: string;
  /** The rows' category (the Swish rows' is always the partner's, so they leave it out). */
  categories?: boolean;
  children?: (r: SharedRow) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // One pay day for the whole group (a card invoice): said once in the title, not on every row.
  const onePayDay = rows.length > 1 && rows.every((r) => r.payDate === rows[0].payDate);
  return (
    <div data-group-band>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-t border-hairline bg-band px-5 py-3 text-left text-[13px] hover:bg-card-inset sm:px-6"
      >
        {dot && <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />}
        <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1">
          <b className="font-semibold">{title}</b> <span className="text-ink-2">({rows.length})</span>
          {note}
        </span>
        <span className="shrink-0 font-bold tabular-nums">{formatKr(sign * total)}</span>
      </button>
      {open && (
        <ul>
          {rows.map((r, i) => (
            <li key={`${r.id ?? "x"}-${i}`} className={cn(ROW, rowColumns(categories, !!children))}>
              <span className="tabular-nums text-ink-3">{shortDate(r.date)}</span>
              {/* The name, and its pills after it (on a line of their own when there is no room). */}
              <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5", !r.paid && "text-ink-2")}>
                <span className="min-w-0 truncate">{r.description}</span>
                {r.status === "forvantat" && <Pill title="Ingen dragning kopplad för månaden: det förväntade beloppet räknas">förväntat</Pill>}
                {!r.paid && !onePayDay && <Pill tone="blue">betalas {shortDate(r.payDate)}</Pill>}
              </span>
              {categories && <span className="hidden min-w-0 sm:block">{r.categoryId !== undefined && <CategoryChip categoryId={r.categoryId ?? null} short className="-ml-2 max-w-full" />}</span>}
              <span className="text-right font-semibold tabular-nums">{formatKr(sign * r.amount)}</span>
              {children?.(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function groupTitle(g: SharedGroup) {
  if ((g.kind !== "norwegian" && g.kind !== "mastercard") || !g.payDate) return g.label;
  const paid = g.rows.every((r) => r.paid);
  return (
    <>
      {g.label}
      <span className="font-normal text-ink-2">
        {" "}
        · faktura {paid ? "betald" : "betalas"} {shortDate(g.payDate)}
        {g.periodEnd ? `, köp t.o.m. ${shortDate(g.periodEnd)}` : ""}
      </span>
    </>
  );
}

/** What the partner paid (shared, or only mine), with delete per row; empty, a purple M and the way to add. */
export function PartnerPaidList({ data, act, onAdd }: { data: SharedMonth; act: Act; onAdd?: () => void }) {
  const p = data.partnerName;
  const rows = [...data.partnerPaid.rows.map((r) => ({ ...r, mine: false })), ...data.forMe.rows.map((r) => ({ ...r, mine: true }))].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 border-t border-hairline px-6 pb-7 pt-6 text-center" data-empty>
        <span aria-hidden className="mb-1.5 grid size-11 place-items-center rounded-full bg-purple-soft text-lg font-bold text-purple-text">
          {p.trim()[0]?.toLocaleUpperCase("sv") ?? "P"}
        </span>
        <h3 className="text-[15px] font-semibold">Inget inlagt för {monthLabel(data.month).toLowerCase()}</h3>
        <p className="max-w-sm text-[13px] text-ink-2">Det {p} betalat från sitt eget konto lägger du in här, så räknas det med i avstämningen.</p>
        {onAdd && (
          <Button size="sm" onClick={onAdd} className="mt-2 h-9 rounded-lg border-0 bg-card-inset px-3.5 text-[13px] font-medium text-ink hover:bg-segment">
            {p} har betalat…
          </Button>
        )}
      </div>
    );
  }
  const remove = (r: SharedRow) =>
    act(async () => {
      await sendJson("DELETE", `/transactions/${r.id}`, {});
      notify({
        text: `${r.description} är borttagen.`,
        action: { label: "Ångra", run: () => act(() => sendJson("POST", `/transactions/${r.id}/restore`, {})) },
      });
    });
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id} className={cn(ROW, "group", rowColumns(true, true))}>
          <span className="tabular-nums text-ink-3">{shortDate(r.date)}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="min-w-0 truncate">{r.description}</span>
            {r.mine && <Pill tone="purple">bara mitt</Pill>}
          </span>
          <span className="hidden min-w-0 sm:block">
            <CategoryChip categoryId={r.categoryId ?? null} short className="-ml-2 max-w-full" />
          </span>
          <span className="text-right font-semibold tabular-nums">{formatKr(-r.amount)}</span>
          <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" aria-label={`Ta bort ${r.description}`} onClick={() => remove(r)}>
            <Trash2 />
          </Button>
        </li>
      ))}
      <li className="border-t border-hairline px-5 py-3 text-[11px] text-ink-3 sm:px-6">Köp {p} gjort från sina egna konton. De räknas aldrig i dina saldon eller din prognos.</li>
    </ul>
  );
}

/**
 * Swish between us, one direction. Each row can be left out of the
 * settlement ('räkna inte'). A Swish from the partner also has 'vad gällde
 * den?': my purchases around it of about its amount (hers) or twice it
 * (shared), one click to mark.
 */
export function SwishList({ data, act, direction }: { data: SharedMonth; act: Act; direction: "from" | "to" }) {
  const p = data.partnerName;
  const [asking, setAsking] = useState<number | null>(null);
  const t = direction === "from" ? data.transfers.fromPartner : data.transfers.toPartner;
  const title = direction === "from" ? `Från ${p}` : `Till ${p}`;
  const dot = direction === "from" ? "bg-positive" : "bg-partner";
  if (t.rows.length === 0 && t.excluded.length === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-hairline px-5 py-3 text-[13px] sm:px-6" data-group-band>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
        <b className="font-semibold">{title}</b>
        <span className="min-w-0 flex-1 text-ink-2">inget i {monthLabel(data.month).toLowerCase()}</span>
        <span className="font-bold tabular-nums text-ink-3">0 kr</span>
      </div>
    );
  }
  const mark = (c: SwishCandidate, owner: "shared" | "partner") => act(() => sendJson("PATCH", `/transactions/${c.id}`, owner === "shared" ? { shared: true } : { forOther: true }));
  const exclude = (r: SharedRow, excluded: boolean) => act(() => sendJson("PATCH", `/transactions/${r.id}`, { settlementExcluded: excluded }));

  return (
    <Group
      title={title}
      dot={dot}
      categories={false}
      note={t.excluded.length > 0 && <span className="text-ink-2"> · varav {t.excluded.length} räknas inte</span>}
      total={t.total}
      sign={direction === "from" ? 1 : -1}
      rows={[...t.rows, ...t.excluded.map((r) => ({ ...r, description: `${r.description} · räknas inte`, excludedRow: true }))]}
    >
      {(r) => {
        const excluded = (r as SharedRow & { excludedRow?: boolean }).excludedRow;
        const candidates = direction === "from" && r.id !== null && !excluded ? (data.swishCandidates[r.id] ?? []) : [];
        return (
          <span className="flex shrink-0 items-center gap-1">
            {candidates.length > 0 && (
              <Popover asking={asking === r.id} onToggle={() => setAsking(asking === r.id ? null : r.id)} count={candidates.length}>
                <p className="mb-2 text-xs text-muted">Dina köp runt Swishen. Ungefär samma belopp: troligen {p}s. Ungefär dubbla: troligen delat.</p>
                <ul className="space-y-1">
                  {candidates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="w-10 tabular-nums text-muted">{shortDate(c.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {c.description} <span className="text-xs text-muted">{c.account}</span>
                        {c.current === "shared" && <span className="ml-1 rounded bg-shared-soft px-1 text-[11px] text-shared">delat nu</span>}
                      </span>
                      <Amount ore={-Math.abs(c.amount)} size="sm" />
                      {c.current !== "shared" && (
                        <Button size="sm" variant={c.suggest === "shared" ? "primary" : "secondary"} onClick={() => mark(c, "shared")}>
                          Delat
                        </Button>
                      )}
                      <Button size="sm" variant={c.suggest === "partner" ? "primary" : "secondary"} onClick={() => mark(c, "partner")}>
                        {p}s
                      </Button>
                    </li>
                  ))}
                </ul>
              </Popover>
            )}
            <button
              type="button"
              onClick={() => exclude(r, !excluded)}
              className="rounded px-1 text-[11px] text-ink-2 hover:bg-card-inset hover:text-ink"
              title={
                excluded
                  ? "Räkna med Swishen i avstämningen igen"
                  : `Swishen reglerade något för sig, t.ex. din halva av ett delat köp som ${p} betalade. Den ligger kvar men räknas inte i avstämningen.`
              }
            >
              {excluded ? "räkna med" : "räkna inte"}
            </button>
          </span>
        );
      }}
    </Group>
  );
}

function Popover({ asking, onToggle, count, children }: { asking: boolean; onToggle: () => void; count: number; children: React.ReactNode }) {
  return (
    <span className="relative">
      <button type="button" onClick={onToggle} aria-expanded={asking} className="rounded px-1 text-[11px] font-medium text-accent hover:underline">
        vad gällde den? ({count})
      </button>
      {asking && <div className="absolute right-0 top-6 z-20 w-[min(460px,80vw)] rounded-lg border border-border bg-surface p-3 shadow-panel">{children}</div>}
    </span>
  );
}

/** 'Mio har betalat' as a side panel: a purchase she made from her own accounts, shared or only mine. */
export function PartnerPaidPanel({ data, open, onOpenChange, onSaved }: { data: SharedMonth; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const p = data.partnerName;
  const lastDay = `${data.month}-${String(new Date(Number(data.month.slice(0, 4)), Number(data.month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const defaultDate = data.monthNotOver ? data.today : lastDay;
  const [form, setForm] = useState({ label: "", amount: "", date: defaultDate, categoryId: null as number | null, forMe: false });
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, label: "", amount: "", date: defaultDate, forMe: false }));
      setError(null);
    }
  }, [open, defaultDate]);

  const save = async () => {
    const ore = parseKr(form.amount);
    if (!form.label.trim() || !ore) return setError("Fyll i beskrivning och belopp.");
    if (!form.date.startsWith(data.month)) return setError(`Datumet ska ligga i ${monthLabel(data.month).toLowerCase()}.`);
    setError(null);
    try {
      await sendJson("POST", "/transactions", { label: form.label.trim(), amount: -ore, bookingDate: form.date, categoryId: form.categoryId, paidBy: "partner", forOther: form.forMe });
      notify({ text: `${form.label.trim()} är tillagd under ${p} har betalat.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const field = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={`${p} har betalat`}
      description={`Ett köp ${p} gjort från sina egna konton i ${monthLabel(data.month).toLowerCase()}.`}
      footer={
        <>
          <Button variant="primary" size="sm" onClick={save}>
            Lägg till
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </>
      }
    >
      <form
        className="grid gap-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs text-muted">Beskrivning</span>
          <input autoFocus className={field} value={form.label} placeholder="t.ex. Apotek" onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-muted">Belopp (kr)</span>
            <input className={`${field} text-right tabular-nums`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Datum</span>
            <input type="date" className={field} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted">Kategori</span>
          <CategoryChip categoryId={form.categoryId} onClick={(e) => setPicker(e.currentTarget)} className="justify-self-start border-border" aria-label="Kategori" />
          <CategoryPicker open={!!picker} onOpenChange={(o) => !o && setPicker(null)} anchor={picker} value={form.categoryId} includeTransfers={false} onPick={(c) => setForm((f) => ({ ...f, categoryId: c.id }))} />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted">Vems</span>
          <SegmentedControl
            label="Vems"
            options={[
              { value: "shared", label: "Delat (hälften var)" },
              { value: "mine", label: "Bara mitt (jag betalar hela)" },
            ]}
            value={form.forMe ? "mine" : "shared"}
            onChange={(v) => setForm({ ...form, forMe: v === "mine" })}
            className="justify-self-start"
          />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </SidePanel>
  );
}
