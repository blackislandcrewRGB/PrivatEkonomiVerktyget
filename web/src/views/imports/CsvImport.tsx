import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { ApiError, formatSek, importCsv, previewCsv, type Account, type CsvMapping, type CsvPreview } from "../../api";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { FIELD } from "../settings/ui";

const DELIMITERS: { value: CsvMapping["delimiter"]; label: string }[] = [
  { value: ";", label: "Semikolon ;" },
  { value: ",", label: "Komma ," },
  { value: "\t", label: "Tabb" },
];
const DATE_FORMATS: { value: CsvMapping["dateFormat"]; label: string }[] = [
  { value: "iso", label: "2026-09-03" },
  { value: "ymd", label: "20260903" },
  { value: "dmy-slash", label: "3/9/2026" },
  { value: "dmy-dot", label: "03.09.2026" },
  { value: "dmy-dash", label: "03-09-2026" },
  { value: "mdy-slash", label: "9/3/2026 (månad först)" },
];

/** A column by its name, or its number when the file has no names. */
const columnName = (preview: CsvPreview, i: number) => preview.table.header?.[i]?.trim() || `Kolumn ${i + 1}`;

/**
 * A CSV from any bank, read with a column mapping (Importer's 'CSV från en annan bank'). The first
 * file is guessed (the delimiter, the lines above the table, the columns and how dates and amounts
 * are written) and every change shows what the file then makes of it, and what importing would do on
 * the account. The mapping is kept with the account, so the next file from the same bank is read
 * without asking.
 */
export function CsvImport({
  open,
  onOpenChange,
  accounts,
  onNewAccount,
  onImported,
  preferAccountId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  onNewAccount: () => void;
  onImported: () => void;
  /** An account just made here: it is the one to pick. */
  preferAccountId?: number | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  // Where the columns came from: the account's kept ones, a guess, or the household's own changes.
  const [origin, setOrigin] = useState<CsvPreview["origin"]>("guessed");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const candidates = accounts.filter((a) => a.source === "csv" || a.source === null);

  // An account just made is the one to use.
  useEffect(() => {
    if (preferAccountId !== null && candidates.some((a) => a.id === preferAccountId)) {
      setAccountId(preferAccountId);
      setMapping(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferAccountId, candidates.length]);

  // The one account to pick when there is one.
  useEffect(() => {
    if (open && accountId === null && candidates.length === 1) setAccountId(candidates[0].id);
  }, [open, accountId, candidates]);

  // What the file looks like and what the mapping makes of it: asked again a moment after every change.
  useEffect(() => {
    if (!file) return;
    let live = true;
    const t = setTimeout(() => {
      previewCsv(file, { accountId, mapping })
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setError(null);
          if (mapping === null) {
            setOrigin(p.origin);
            setMapping(p.mapping);
          }
        })
        .catch((e) => live && setError(e instanceof ApiError ? e : new ApiError(String(e))));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [file, accountId, mapping]);

  const reset = () => {
    setFile(null);
    setMapping(null);
    setPreview(null);
    setError(null);
    setAccountId(null);
  };
  const set = (patch: Partial<CsvMapping>) => {
    setOrigin("sent");
    setMapping((m) => (m ? { ...m, ...patch } : m));
  };
  const run = async () => {
    if (!file || !mapping || accountId === null) return;
    setBusy(true);
    try {
      const r = await importCsv(file, { accountId, mapping });
      notify({ text: `${r.rowsNew} nya rader inlästa från ${file.name}${r.rowsSkipped ? ` (${r.rowsSkipped} fanns redan)` : ""}.` });
      reset();
      onOpenChange(false);
      onImported();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const cols = preview ? Array.from({ length: preview.table.columns }, (_, i) => i) : [];
  const role = (i: number) => {
    if (!mapping) return null;
    const names: string[] = [];
    if (i === mapping.dateColumn) names.push("Datum");
    if (i === mapping.textColumn || i === mapping.extraTextColumn) names.push("Text");
    if (mapping.amountMode === "signed" && i === mapping.amountColumn) names.push("Belopp");
    if (mapping.amountMode === "split" && i === mapping.outColumn) names.push("Uttag");
    if (mapping.amountMode === "split" && i === mapping.inColumn) names.push("Insättning");
    return names.join(" + ") || null;
  };
  const columnSelect = (label: string, value: number | null, onChange: (v: number | null) => void, opts: { optional?: boolean } = {}) => (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      <select className={FIELD} aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {opts.optional && <option value="">Ingen</option>}
        {!opts.optional && value === null && <option value="">Välj kolumn</option>}
        {cols.map((i) => (
          <option key={i} value={i}>
            {columnName(preview!, i)}
          </option>
        ))}
      </select>
    </label>
  );

  const read = preview?.read;
  const readError = read && "error" in read ? read : null;
  const ok = read && !("error" in read) ? read : null;
  const dry = preview?.dryRun;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && reset(), onOpenChange(o))}>
      <DialogContent aria-describedby="csv-desc" className="top-[6vh] max-h-[88vh] max-w-3xl overflow-y-auto rounded-card">
        <DialogTitle>CSV från en annan bank</DialogTitle>
        <DialogDescription id="csv-desc" className="mt-1">
          Välj filen och kontot, och kontrollera att kolumnerna stämmer. Det är bara första gången: inställningarna sparas för kontot.
        </DialogDescription>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Fil</span>
            <button type="button" className={cn(FIELD, "flex items-center gap-2 text-left")} onClick={() => input.current?.click()}>
              <FileUp className="size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="truncate">{file ? file.name : "Välj en CSV-fil"}</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              aria-label="CSV-fil"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setMapping(null);
                  setPreview(null);
                  setError(null);
                }
                e.target.value = "";
              }}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Konto</span>
            <select
              className={FIELD}
              aria-label="Konto"
              value={accountId ?? ""}
              onChange={(e) => {
                if (e.target.value === "new") return onNewAccount();
                setAccountId(e.target.value ? Number(e.target.value) : null);
                setMapping(null);
              }}
            >
              <option value="">Välj konto</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="new">Nytt konto…</option>
            </select>
            {candidates.length === 0 && <span className="block text-[11px] text-ink-3">Det finns inget konto för CSV-filer än: skapa ett.</span>}
          </div>
        </div>

        {file && !preview && !error && <p className="mt-4 text-[13px] text-ink-3">Läser filen…</p>}
        {error && !preview && <p className="mt-4 text-[13px] text-alarm">{error.message}</p>}

        {preview && mapping && (
          <>
            <p className="mt-3 text-[11px] text-ink-3">
              {origin === "saved" ? "Kolumnerna är de som sparats för kontot." : origin === "guessed" ? "Kolumnerna är en gissning: kontrollera dem." : "Dina ändringar."} Filen är i {preview.encoding === "utf-8" ? "UTF-8" : "Windows-1252"}.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink-2">Skiljetecken</span>
                <select className={FIELD} aria-label="Skiljetecken" value={mapping.delimiter} onChange={(e) => set({ delimiter: e.target.value as CsvMapping["delimiter"] })}>
                  {DELIMITERS.map((d) => (
                    <option key={d.label} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink-2">Rader att hoppa över överst</span>
                <input className={FIELD} type="number" min={0} max={50} aria-label="Rader att hoppa över överst" value={mapping.skipLines} onChange={(e) => set({ skipLines: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <div className="flex items-end pb-1.5">
                <Switch checked={mapping.hasHeader} onCheckedChange={(on) => set({ hasHeader: on })} label="Första raden är rubriker">
                  <span className="text-[13px]">Första raden är rubriker</span>
                </Switch>
              </div>
              {columnSelect("Datum", mapping.dateColumn, (v) => v !== null && set({ dateColumn: v }))}
              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink-2">Så skrivs datumet</span>
                <select className={FIELD} aria-label="Så skrivs datumet" value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as CsvMapping["dateFormat"] })}>
                  {DATE_FORMATS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              {columnSelect("Text", mapping.textColumn, (v) => v !== null && set({ textColumn: v }))}
              {columnSelect("Mer text (valfritt)", mapping.extraTextColumn, (v) => set({ extraTextColumn: v }), { optional: true })}
              <div className="space-y-1 sm:col-span-2">
                <span className="text-[12px] font-medium text-ink-2">Beloppet</span>
                <div>
                  <SegmentedControl<CsvMapping["amountMode"]>
                    appearance="v2"
                    size="sm"
                    label="Beloppet"
                    value={mapping.amountMode}
                    onChange={(amountMode) => set({ amountMode })}
                    options={[
                      { value: "signed", label: "En kolumn" },
                      { value: "split", label: "Uttag och insättning" },
                    ]}
                  />
                </div>
              </div>
              {mapping.amountMode === "signed" ? (
                <>
                  {columnSelect("Belopp", mapping.amountColumn, (v) => set({ amountColumn: v }))}
                  <div className="flex items-end pb-1.5 sm:col-span-2">
                    <Switch checked={mapping.outIsNegative} onCheckedChange={(on) => set({ outIsNegative: on })} label="Utgifter har minustecken">
                      <span className="text-[13px]">Utgifter har minustecken</span>
                    </Switch>
                  </div>
                </>
              ) : (
                <>
                  {columnSelect("Uttag", mapping.outColumn, (v) => set({ outColumn: v }))}
                  {columnSelect("Insättning", mapping.inColumn, (v) => set({ inColumn: v }))}
                </>
              )}
              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink-2">Decimaltecken</span>
                <select className={FIELD} aria-label="Decimaltecken" value={mapping.decimal} onChange={(e) => set({ decimal: e.target.value as CsvMapping["decimal"] })}>
                  <option value=",">Komma (12,50)</option>
                  <option value=".">Punkt (12.50)</option>
                </select>
              </label>
            </div>

            <div className="mt-4 overflow-x-auto rounded-inset border border-hairline">
              <table className="w-full text-[12px]" aria-label="Filens första rader">
                <thead>
                  <tr className="bg-card-inset text-left text-ink-3">
                    {cols.map((i) => (
                      <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-normal">
                        <span className="block text-ink-2">{preview.table.header ? columnName(preview, i) : `Kolumn ${i + 1}`}</span>
                        <span className={cn("block text-[10px]", role(i) ? "font-semibold text-accent" : "text-transparent")}>{role(i) ?? "–"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.table.sample.map((r, n) => (
                    <tr key={n} className="border-t border-hairline">
                      {cols.map((i) => (
                        <td key={i} className="max-w-48 truncate whitespace-nowrap px-2.5 py-1.5">
                          {r[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 space-y-1.5 text-[13px]" aria-live="polite">
              {readError ? (
                <div className="text-alarm">
                  <p>{readError.error}</p>
                  {readError.details.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-[12px]">
                      {readError.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : ok ? (
                <>
                  <p>
                    <b>{ok.count}</b> transaktioner {ok.period ? `${ok.period.from} till ${ok.period.to}` : ""}
                    {dry && (
                      <>
                        {" "}
                        · <b>{dry.rowsNew}</b> nya{dry.rowsSkipped > 0 && `, ${dry.rowsSkipped} finns redan`}
                        {dry.rowsUncategorized > 0 && `, ${dry.rowsUncategorized} utan kategori`}
                      </>
                    )}
                  </p>
                  <ul className="text-[12px] text-ink-2" aria-label="Så här läses de första raderna">
                    {ok.sample.slice(0, 4).map((r, n) => (
                      <li key={n} className="flex justify-between gap-4">
                        <span className="truncate">
                          {r.date} · {r.text}
                        </span>
                        <span className={cn("shrink-0 tabular-nums", r.amountOre < 0 ? "text-ink" : "text-positive-text")}>{formatSek(r.amountOre)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {error && <p className="text-alarm">{error.message}</p>}
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={run} disabled={busy || !ok || accountId === null || !dry || dry.rowsNew === 0}>
            {dry && dry.rowsNew > 0 ? `Importera ${dry.rowsNew} nya` : "Importera"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
