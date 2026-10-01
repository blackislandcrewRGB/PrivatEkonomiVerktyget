import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { getJson, type ImportHistoryPage, type ImportLog } from "../../../api";
import { Card } from "../../../components/Card";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { setSearch, useSearch } from "../../../shell/routes";
import { monthYear } from "../importParts";
import { bandLabel, groupHistory, periodText, swedishTime, totalsText, type HistoryBand, type HistoryFilter, type HistoryRow } from "./group";

const FILTERS: { value: HistoryFilter; label: string; param: string | null; via: string | null }[] = [
  { value: "all", label: "Alla", param: null, via: null },
  { value: "files", label: "Filer", param: "filer", via: "file" },
  { value: "syncs", label: "Banksynkar", param: "banksynkar", via: "enable_banking" },
];

/** The filter lives in the URL: ?visa=filer or ?visa=banksynkar. */
export function useHistoryFilter(): [HistoryFilter, (f: HistoryFilter) => void] {
  const params = new URLSearchParams(useSearch());
  const filter = FILTERS.find((f) => f.param && f.param === params.get("visa"))?.value ?? "all";
  const set = (f: HistoryFilter) => {
    const next = new URLSearchParams(window.location.search);
    const param = FILTERS.find((x) => x.value === f)!.param;
    if (param) next.set("visa", param);
    else next.delete("visa");
    const q = next.toString();
    setSearch(q ? `?${q}` : "");
  };
  return [filter, set];
}

const dayMonth = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("sv-SE", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Importer's history in a card: filtered to files or bank syncs, grouped by
 * day with each day's totals, a page at a time ('Visa äldre'). `version`
 * changes after an import or an undo: the history starts over from the top.
 */
export function History({ version, onUndo }: { version: number; onUndo: (h: ImportLog) => void }) {
  const [filter, setFilter] = useHistoryFilter();
  const via = FILTERS.find((f) => f.value === filter)!.via;
  const [list, setList] = useState<ImportLog[] | null>(null);
  const [older, setOlder] = useState<ImportHistoryPage["older"]>(null);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback((before: string | null) => {
    const q = new URLSearchParams();
    if (before) q.set("before", before);
    if (via) q.set("via", via);
    const s = q.toString();
    return getJson<ImportHistoryPage>(`/imports${s ? `?${s}` : ""}`);
  }, [via]);

  useEffect(() => {
    let live = true;
    fetchPage(null).then((p) => {
      if (!live) return;
      setList(p.imports);
      setOlder(p.older);
    });
    return () => {
      live = false;
    };
  }, [fetchPage, version]);

  const more = async () => {
    if (!older) return;
    setLoading(true);
    try {
      const p = await fetchPage(older.before);
      setList((l) => [...(l ?? []), ...p.imports]);
      setOlder(p.older);
    } finally {
      setLoading(false);
    }
  };

  const today = todayIso();
  const bands = list ? groupHistory(list, today) : [];
  return (
    <div className="space-y-2">
      <Card aria-labelledby="history-title" className="@container overflow-hidden p-0 sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <h2 id="history-title" className="text-base font-semibold">
            Historik
          </h2>
          <SegmentedControl label="Visa" size="sm" appearance="v2" options={FILTERS} value={filter} onChange={setFilter} />
        </div>
        {list && list.length === 0 && (
          <p className="border-t border-hairline px-5 py-6 text-[13px] text-ink-2 sm:px-6">
            {filter === "all" ? "Inga importer ännu." : filter === "files" ? "Inga filimporter ännu." : "Inga banksynkar ännu."}
          </p>
        )}
        {bands.map((b) => (
          <Band key={b.key} band={b} thisYear={today.slice(0, 4)} onUndo={onUndo} />
        ))}
        {older && (
          <button
            type="button"
            onClick={more}
            disabled={loading}
            className="block w-full border-t border-hairline px-5 py-3.5 text-center text-[13px] font-semibold text-accent hover:bg-band disabled:opacity-60"
          >
            Visa äldre · {dayMonth(older.from)} och tidigare ({older.count.toLocaleString("sv-SE")} {older.count === 1 ? "import" : "importer"})
          </button>
        )}
      </Card>
      <p className="px-1 text-[11px] text-ink-3">
        Filer visas alltid en och en. Banksynkar visas en och en i dag och i går; äldre dagar samlas på en rad som fälls ut med ett klick. Ångra finns bara för
        filimporter som ingen senare import från samma bank har rört och vars rader inte har ändrats för hand. Fel rader från banken tar du bort i Transaktioner.
      </p>
    </div>
  );
}

function Band({ band, thisYear, onUndo }: { band: HistoryBand; thisYear: string; onUndo: (h: ImportLog) => void }) {
  const id = `band-${band.key}`;
  return (
    <div role="group" aria-labelledby={id} data-band={band.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-hairline bg-band px-5 py-2 text-[12px] sm:px-6">
        <h3 id={id} className="font-semibold text-ink-2">
          {bandLabel(band.days, thisYear)}
        </h3>
        <p className="tabular-nums text-ink-3" data-totals>
          {totalsText(band.totals)}
        </p>
      </div>
      <ul>
        {band.rows.map((r) =>
          r.kind === "syncs" ? (
            <SyncGroup key={r.key} row={r} thisYear={thisYear} onUndo={onUndo} />
          ) : (
            <Row key={r.imp.id} imp={r.imp} thisYear={thisYear} onUndo={onUndo} />
          ),
        )}
      </ul>
    </div>
  );
}

/**
 * Time, badge, name over its source and period, the pills and 'Ångra'. Narrow:
 * the pills under the name.
 */
const ROW = "grid grid-cols-[2.75rem_2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-hairline px-5 py-2.5 sm:px-6 @[40rem]:grid-cols-[3rem_2rem_minmax(0,1fr)_auto_4.5rem]";
const PILLS = "col-start-3 row-start-2 flex flex-wrap gap-1.5 @[40rem]:col-start-4 @[40rem]:row-start-1 @[40rem]:justify-end";
const ACTION = "col-start-4 row-span-2 row-start-1 text-right @[40rem]:col-start-5 @[40rem]:row-span-1";

function Row({ imp, thisYear, onUndo, withDay }: { imp: ImportLog; thisYear: string; onUndo: (h: ImportLog) => void; withDay?: boolean }) {
  const sync = imp.via === "enable_banking";
  const notice = imp.source === "rent_notice";
  const receipt = imp.source === "tax_return";
  return (
    <li data-import={imp.id} data-kind={sync ? "sync" : "file"} className={ROW}>
      <span className="text-[12px] leading-tight text-ink-2 tabular-nums">
        {withDay && <span className="block text-ink-3">{dm(imp.importedAt)}</span>}
        {swedishTime(imp.importedAt)}
      </span>
      {sync ? <SyncBadge /> : <FileBadge filename={imp.filename} />}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{imp.filename}</span>
        <span className="block truncate text-[11px] text-ink-3">{subtitle(imp, thisYear)}</span>
      </span>
      <span className={PILLS}>
        {notice ? (
          <Pill tone="blue">hyresavi</Pill>
        ) : receipt ? (
          <Pill tone="blue">deklaration</Pill>
        ) : (
          <>
            <Pill tone={imp.rowsNew > 0 ? "green" : "grey"}>{imp.rowsNew.toLocaleString("sv-SE")} nya</Pill>
            <Pill tone="grey">
              {imp.rowsSkipped.toLocaleString("sv-SE")} {imp.rowsSkipped === 1 ? "dubblett" : "dubbletter"}
            </Pill>
          </>
        )}
      </span>
      <span className={ACTION}>
        {imp.undo?.ok ? (
          <button type="button" onClick={() => onUndo(imp)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            <RotateCcw className="size-3.5" aria-hidden /> Ångra
          </button>
        ) : (
          <span className="text-neutral-bar" title={imp.undo ? `Kan inte ångras: ${imp.undo.reason}` : "Kan inte ångras"} aria-label="kan inte ångras">
            —
          </span>
        )}
      </span>
    </li>
  );
}

/** An older day's bank syncs (or a run of days'): one row, a click folds it out to them. */
function SyncGroup({ row, thisYear, onUndo }: { row: Extract<HistoryRow, { kind: "syncs" }>; thisYear: string; onUndo: (h: ImportLog) => void }) {
  const [open, setOpen] = useState(false);
  const one = row.days.length === 1;
  const times = row.imps.map((i) => swedishTime(i.importedAt));
  const accounts = [...new Set(row.imps.map((i) => i.filename.replace(/^Enable Banking · /, "")))];
  const t = row.totals;
  return (
    <Fragment>
      <li data-syncs={row.key} className="border-t border-hairline">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cn(ROW, "w-full border-t-0 text-left hover:bg-band/60")}
        >
          <span className="text-[12px] leading-tight text-ink-2 tabular-nums">{one && (times.length > 1 ? `${times[0]} · ${times[times.length - 1]}` : times[0])}</span>
          <SyncBadge />
          <span className="col-span-2 min-w-0 @[40rem]:col-span-3">
            <span className="line-clamp-2 text-[13px] font-medium text-ink @[40rem]:line-clamp-1">
              {t.syncs} {t.syncs === 1 ? "banksynk" : "banksynkar"} · {accounts.join(", ")}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-ink-3">
              {t.rowsNew.toLocaleString("sv-SE")} nya · {t.rowsSkipped.toLocaleString("sv-SE")} {t.rowsSkipped === 1 ? "dubblett" : "dubbletter"} ·{" "}
              {open ? "klicka för att dölja" : "klicka för att visa"}
              <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden />
            </span>
          </span>
        </button>
      </li>
      {open && row.imps.map((imp) => <Row key={imp.id} imp={imp} thisYear={thisYear} onUndo={onUndo} withDay={!one} />)}
    </Fragment>
  );
}

const dm = (ts: string) => {
  const d = new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  return `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
};

/** 'Mastercard · 22/9 2025 – 18/9 2026', 'Hyresavi · december 2026'; a bank sync only its period. */
function subtitle(imp: ImportLog, thisYear: string): string {
  const period = imp.periodFrom && imp.periodTo ? periodText(imp.periodFrom, imp.periodTo, thisYear) : null;
  if (imp.via === "enable_banking") return period ?? "Enable Banking";
  if (imp.source === "tax_return") return ["Deklarationskvittens", imp.periodFrom && `inkomståret ${imp.periodFrom.slice(0, 4)}`].filter(Boolean).join(" · ");
  if (imp.source === "rent_notice") return ["Hyresavi", imp.periodFrom && monthYear(imp.periodFrom.slice(0, 7))].filter(Boolean).join(" · ");
  const source =
    imp.source === "swedbank"
      ? "Swedbank"
      : imp.source === "mastercard"
        ? "Mastercard"
        : imp.filename.toLowerCase().endsWith(".xlsx")
          ? "Bank Norwegian (XLSX)"
          : "Bank Norwegian (faktura)";
  return [source, period].filter(Boolean).join(" · ");
}

const BADGE: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-file-pdf" },
  xlsx: { label: "XLS", className: "bg-file-xlsx" },
  xls: { label: "XLS", className: "bg-file-xlsx" },
  csv: { label: "CSV", className: "bg-file-csv" },
  htm: { label: "HTML", className: "bg-file-html" },
  html: { label: "HTML", className: "bg-file-html" },
};

export function FileBadge({ filename }: { filename: string }) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const b = BADGE[ext] ?? { label: "FIL", className: "bg-ink-3" };
  return (
    <span aria-hidden data-badge={b.label} className={cn("grid size-8 place-items-center rounded-[8px] text-[10px] font-bold tracking-[0.02em] text-white", b.className, b.label === "HTML" && "text-[8.5px]")}>
      {b.label}
    </span>
  );
}

function SyncBadge() {
  return (
    <span aria-hidden data-badge="sync" className="grid size-8 place-items-center rounded-[8px] bg-card-inset text-ink-3">
      <RefreshCw className="size-3.5" />
    </span>
  );
}

const PILL = {
  green: "bg-positive-soft text-positive-text",
  grey: "bg-card-inset text-ink-2",
  blue: "bg-accent-soft text-accent",
};

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span data-pill={tone} className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", PILL[tone])}>
      {children}
    </span>
  );
}
