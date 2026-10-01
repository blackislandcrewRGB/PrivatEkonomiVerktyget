import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import {
  ApiError,
  formatSek,
  getJson,
  sendJson,
  uploadImports,
  type Account,
  type BatchFileResult,
  type BatchResult,
  type ImportCoverage,
  type ImportLog,
  type ImportResult,
  type IncomeSuggestion,
} from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { useIntent } from "../../shell/intents";
import { ExtraNotes, MastercardListBox, MastercardNotes, monthYear, NewRowsPreview, PossibleDuplicates, RentNoticeBox, StatementBox, TaxReturnBox } from "./importParts";
import { dayMonthYear } from "../../lib/taxReturns";
import { dm } from "../overview/format";
import { ImportsHeader } from "./Header";
import { DropZone } from "./DropZone";
import { AccountCards } from "./AccountCards";
import { History } from "./history/History";
import { Card } from "../../components/Card";
import { CsvImport } from "./CsvImport";
import { NewAccount } from "../settings/NewAccount";

type Choice = number | "new" | "";

function sourceLabel(r: ImportResult): string {
  if (r.source === "rent_notice") return "Hyresavi";
  if (r.source === "tax_return") return "Deklarationskvittens";
  if (r.source === "swedbank") return "Swedbank";
  if (r.source === "mastercard") return r.format === "invoice" ? "Mastercard (faktura)" : "Mastercard (utskrift)";
  return r.format === "xlsx" ? "Norwegian (XLSX)" : "Norwegian (faktura)";
}

/**
 * Importer (Design v2): the next bank sync in the header, the drop zone, a
 * card per account with how far it is imported, the preview as a table per
 * file with one 'Importera N filer', and the history by day with 'Ångra'
 * where it is possible.
 */
export function ImportsView({ onImported }: { onImported: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Bumped after an import or an undo: the history starts over from the top.
  const [version, setVersion] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<BatchResult | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [done, setDone] = useState<BatchResult | null>(null);
  const [suggestions, setSuggestions] = useState<IncomeSuggestion[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState<ImportLog | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [newAccount, setNewAccount] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useIntent("imports.pickFile", () => inputRef.current?.click());

  const [coverage, setCoverage] = useState<ImportCoverage[]>([]);
  const reload = useCallback(() => {
    getJson<Account[]>("/accounts").then(setAccounts);
    setVersion((v) => v + 1);
    getJson<ImportCoverage[]>("/imports/coverage").then(setCoverage, () => setCoverage([]));
  }, []);
  useEffect(reload, [reload]);

  const accountMap = (c: Record<string, Choice>) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "")) as Record<string, number | "new">;

  const runPreview = async (fs: File[], c: Record<string, Choice>) => {
    setBusy(true);
    setError(null);
    try {
      const p = await uploadImports(fs, { dryRun: true, accountMap: accountMap(c) });
      setPreview(p);
      setChoices(Object.fromEntries(p.accounts.map((a) => [a.ref, c[a.ref] ?? a.accountId ?? ""])));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = (list: FileList | File[]) => {
    const fs = [...list];
    if (fs.length === 0) return;
    setFiles(fs);
    setPreview(null);
    setDone(null);
    runPreview(fs, {});
  };

  // Only files that parsed and have something new are sent for real.
  const toImport = useMemo(() => {
    if (!preview) return [];
    const wanted = new Set(preview.files.filter((f) => f.ok && !f.alreadyImported).map((f) => f.index));
    return files.filter((_, i) => wanted.has(i));
  }, [preview, files]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await uploadImports(toImport, { dryRun: false, accountMap: accountMap(choices) });
      setDone(r);
      setPreview(null);
      setFiles([]);
      reload();
      onImported();
      getJson<IncomeSuggestion[]>("/recurring-income/suggestions").then(setSuggestions);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setFiles([]);
    setPreview(null);
    setError(null);
  };

  const undo = async (h: ImportLog) => {
    setUndoing(null);
    try {
      const r = await sendJson<{ removed: number }>("DELETE", `/imports/${h.id}`, {});
      notify({
        text:
          h.source === "rent_notice"
            ? `Hyresavin ${h.filename} är borttagen.`
            : h.source === "tax_return"
              ? `${h.filename.replace(/\.pdf$/i, "")} är borttagen.`
              : `Importen av ${h.filename} är ångrad: ${r.removed} rader borttagna.`,
      });
      reload();
      onImported();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const unchosen = preview?.accounts.filter((a) => choices[a.ref] === "") ?? [];
  const covered = coverage.filter((c) => c.source);

  return (
    <div className="space-y-6">
      <ImportsHeader />
      <DropZone ref={inputRef} busy={busy} fileCount={files.length} onFiles={pickFiles} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-ink-2">
        <span>Står din bank inte i listan?</span>
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => setCsvOpen(true)}>
          Läs in en CSV från en annan bank
        </button>
        {accounts.length === 0 && (
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setNewAccount(true)}>
            Du har inga konton än: skapa ett
          </button>
        )}
      </p>

      {covered.length > 0 && <AccountCards coverage={covered} />}

      {error && <ErrorBox error={error} />}

      {preview && (
        <Card className="space-y-4" aria-labelledby="preview-title">
          <h2 id="preview-title" className="text-base font-semibold">
            Förhandsgranskning
          </h2>

          {preview.accounts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">Swedbank-konton i filerna</h3>
              {preview.accounts.map((a) => (
                <div key={a.ref} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    {a.product || "Okänd produkt"} <span className="font-mono text-xs">{a.ref}</span> <span className="text-ink-2">({a.rows} rader)</span> →
                  </span>
                  <select
                    aria-label={`Konto för ${a.ref}`}
                    value={String(choices[a.ref] ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...choices, [a.ref]: v === "" || v === "new" ? (v as Choice) : Number(v) };
                      setChoices(next);
                      runPreview(files, next);
                    }}
                    className={cn("h-8 rounded-md border bg-card px-2", choices[a.ref] === "" ? "border-caution/40 bg-caution-soft" : "border-hairline")}
                  >
                    <option value="">Välj konto…</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id} disabled={!!acc.accountRef && acc.accountRef !== a.ref}>
                        {acc.name}
                        {acc.accountRef ? ` (${acc.accountRef})` : ""}
                      </option>
                    ))}
                    <option value="new">+ Nytt konto</option>
                  </select>
                  {a.resolvedBy === "bound" && <span className="text-xs text-ink-2">känt kontonummer</span>}
                  {a.resolvedBy === "hint" && <span className="text-xs text-ink-2">förslag utifrån produkt</span>}
                </div>
              ))}
            </div>
          )}

          <FileTable batch={preview} accounts={accounts} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={confirm} disabled={busy || toImport.length === 0 || unchosen.length > 0} className="h-9 rounded-[10px] border-0 bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-hover">
              {toImport.length === 0 ? "Inget nytt att importera" : `Importera ${toImport.length} ${toImport.length === 1 ? "fil" : "filer"}`}
            </Button>
            <Button onClick={cancel} className="h-9 rounded-[10px] border-0 bg-card-inset px-4 text-[13px] font-medium text-ink hover:bg-segment">
              Avbryt
            </Button>
            {unchosen.length > 0 && <span className="text-sm text-caution-text">Välj konto ovan först.</span>}
          </div>
        </Card>
      )}

      {done && (
        <Card className="space-y-3" aria-labelledby="done-title">
          <h2 id="done-title" className="flex items-center gap-2 text-base font-semibold text-positive-text">
            <CircleCheck className="size-4" /> Importerat
          </h2>
          <FileTable batch={done} accounts={accounts} />
          {suggestions.length > 0 && (
            <p className="rounded-lg border border-hairline bg-card p-3 text-sm">
              Förslag på återkommande inkomst: {suggestions.map((s) => `${s.name} ${formatSek(s.amount)} den ${s.dayOfMonth}:e på ${s.accountName}`).join(", ")}. Bekräfta
              under <span className="font-medium">Inställningar</span>.
            </p>
          )}
        </Card>
      )}

      <History version={version} onUndo={setUndoing} />

      <CsvImport
        open={csvOpen}
        onOpenChange={setCsvOpen}
        accounts={accounts}
        preferAccountId={createdId}
        onNewAccount={() => setNewAccount(true)}
        onImported={() => {
          reload();
          onImported();
        }}
      />
      <NewAccount
        open={newAccount}
        onOpenChange={setNewAccount}
        onCreated={(a) => {
          setCreatedId(a.id);
          reload();
        }}
      />

      <Dialog open={!!undoing} onOpenChange={(o) => !o && setUndoing(null)}>
        <DialogContent aria-describedby="undo-import-desc">
          <DialogTitle>Ångra importen?</DialogTitle>
          {undoing?.undo?.ok && (
            <DialogDescription id="undo-import-desc" className="mt-2 space-y-2">
              {undoing.source === "tax_return" ? (
                <span className="block">
                  <b className="text-ink">{undoing.filename}</b>: inkomståret går tillbaka till det det var innan kvittensen lästes in, eller tas bort om det
                  var nytt. Du kan läsa in kvittensen igen efteråt.
                </span>
              ) : undoing.source === "rent_notice" ? (
                <span className="block">
                  <b className="text-ink">{undoing.filename}</b>: hyresavin tas bort, och hyrans belopp för månaden går tillbaka till det den var. Du kan importera
                  avin igen efteråt.
                </span>
              ) : (
                <span className="block">
                  <b className="text-ink">{undoing.filename}</b>: {undoing.undo.rows} rader tas bort helt, och importen försvinner ur historiken. Du kan importera filen
                  igen efteråt.
                </span>
              )}
              {undoing.undo.statement && <span className="block">Fakturan som importen lade in tas också bort. Kontots saldo ändras inte tillbaka.</span>}
            </DialogDescription>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUndoing(null)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => undoing && undo(undoing)}>
              <RotateCcw /> Ångra importen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErrorBox({ error }: { error: { message: string; details: string[] } }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" /> {error.message}
      </p>
      {error.details.length > 0 && (
        <ul className="mt-1 list-disc pl-10">
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One row per file in import order (källa, konto, period, nya, dubbletter, fel); click a row for details. */
function FileTable({ batch, accounts }: { batch: BatchResult; accounts: Account[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const accountName = (id: number | "new" | null) => (id === "new" ? "Nytt konto" : id === null ? "–" : (accounts.find((a) => a.id === id)?.name ?? "–"));
  const okFiles = batch.files.filter((f): f is Extract<BatchFileResult, { ok: true }> => f.ok);
  const totals = {
    rowsNew: okFiles.reduce((s, f) => s + f.result.rowsNew, 0),
    pairs: okFiles.reduce((s, f) => s + f.result.transferPairs, 0),
    uncategorized: okFiles.reduce((s, f) => s + f.result.rowsUncategorized, 0),
    recategorized: okFiles.reduce((s, f) => s + f.result.recategorized, 0),
    notices: okFiles.filter((f) => f.result.source === "rent_notice" && !f.alreadyImported).length,
    receipts: okFiles.filter((f) => f.result.source === "tax_return" && !f.alreadyImported).length,
    errors: batch.files.length - okFiles.length,
  };
  const th = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-2";
  const td = "px-3 py-2";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b border-hairline bg-band">
            <tr>
              <th className={th}>Fil</th>
              <th className={th}>Källa</th>
              <th className={th}>Konto</th>
              <th className={th}>Period</th>
              <th className={`${th} text-right`}>Nya</th>
              <th className={`${th} text-right`}>Dubbletter</th>
              <th className={`${th} text-right`}>Utan kategori</th>
              <th className={th}>Fel och notiser</th>
            </tr>
          </thead>
          <tbody>
            {batch.files.map((f) => {
              const isOpen = open === f.filename;
              if (!f.ok) {
                return (
                  <Fragment key={f.filename}>
                    <tr className="cursor-pointer border-b border-hairline bg-danger-soft/60" onClick={() => setOpen(isOpen ? null : f.filename)}>
                      <td className={td}>{f.filename}</td>
                      <td colSpan={6} className={`${td} text-danger`}>
                        {f.error}
                      </td>
                      <td className={`${td} font-medium text-danger`}>Fel</td>
                    </tr>
                    {isOpen && f.details.length > 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-2">
                          <ErrorBox error={{ message: "Detaljer", details: f.details }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }
              const r = f.result;
              const receipt = r.source === "tax_return" ? r : null;
              const account =
                r.source === "tax_return"
                  ? "–"
                  : r.source === "swedbank"
                  ? r.accounts.map((a) => accountName(a.accountId)).join(", ")
                  : r.source === "rent_notice"
                    ? `${r.expense.name}${r.account ? ` · ${r.account.name}` : ""}`
                    : r.account.name;
              const notice = r.source === "rent_notice" ? r : null;
              const noRows = notice || receipt;
              return (
                <Fragment key={f.filename}>
                  <tr
                    className={cn("cursor-pointer border-b border-hairline last:border-b-0 hover:bg-band", f.alreadyImported && "text-ink-2")}
                    onClick={() => setOpen(isOpen ? null : f.filename)}
                    aria-expanded={isOpen}
                  >
                    <td className={td}>
                      <ChevronDown className={cn("mr-1 inline size-4 text-ink-2 transition-transform", !isOpen && "-rotate-90")} />
                      {f.filename}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{sourceLabel(r)}</td>
                    <td className={td}>{account}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {receipt ? `inkomståret ${receipt.taxReturn.incomeYear}` : notice ? `hyra ${monthYear(notice.notice.rentMonth)}` : r.period ? `${r.period.from} – ${r.period.to}` : "–"}
                    </td>
                    <td className={`${td} text-right tabular-nums font-medium`}>{noRows ? "–" : r.rowsNew}</td>
                    <td className={`${td} text-right tabular-nums`}>{noRows ? "–" : r.rowsSkipped}</td>
                    <td className={`${td} text-right tabular-nums`}>{noRows ? "–" : r.rowsUncategorized}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {f.alreadyImported ? (
                        <span className="rounded-full bg-card-inset px-2 py-0.5 text-xs font-medium text-ink-2">Redan importerad</span>
                      ) : receipt ? (
                        receipt.taxReturn.replaces ? (
                          <span className="text-xs text-caution-text">
                            ersätter {receipt.taxReturn.replaces.source === "manual" ? "inmatat" : "inläst"} {receipt.taxReturn.incomeYear}
                            {receipt.taxReturn.replaces.submittedAt && ` (${dayMonthYear(receipt.taxReturn.replaces.submittedAt)})`}
                          </span>
                        ) : (
                          <span className="text-xs text-positive-text">
                            OK{receipt.taxReturn.submittedAt && ` · skickad ${dayMonthYear(receipt.taxReturn.submittedAt)}`}
                          </span>
                        )
                      ) : notice ? (
                        <span className={cn("text-xs", notice.notice.amount !== notice.expense.before ? "text-caution-text" : "text-positive-text")}>
                          {formatSek(notice.notice.amount)} · förfaller {dm(notice.notice.dueDate)}
                          {notice.notice.amount !== notice.expense.before && " · nytt belopp"}
                        </span>
                      ) : r.rowsNew === 0 && r.source === "norwegian" && r.format === "xlsx" && r.postedDatesAdded > 0 ? (
                        <span className="text-xs text-transfer" title="Raderna finns redan; bokföringsdagen fylls i så att köpen hamnar på rätt faktura">
                          {r.postedDatesAdded} bokföringsdagar fylls i
                        </span>
                      ) : r.source === "mastercard" && r.format === "list" && r.incomplete.length > 0 ? (
                        <span className="text-xs text-caution-text">{r.incomplete.length} ofullständig rad hoppas över</span>
                      ) : r.possibleDuplicates.length > 0 ? (
                        <span className="text-xs text-caution-text">{r.possibleDuplicates.length} möjliga dubbletter</span>
                      ) : (
                        <span className="text-xs text-positive-text">OK</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-hairline">
                      <td colSpan={8} className="space-y-3 bg-band px-3 py-3">
                        {notice && <RentNoticeBox result={notice} />}
                        {receipt && <TaxReturnBox result={receipt} />}
                        {((r.source === "norwegian" && r.format === "pdf") || (r.source === "mastercard" && r.format === "invoice")) && <StatementBox result={r} />}
                        {r.source === "mastercard" && r.format === "invoice" && <MastercardNotes result={r} />}
                        {r.source === "mastercard" && r.format === "list" && <MastercardListBox result={r} />}
                        <ExtraNotes result={r} />
                        <PossibleDuplicates result={r} />
                        {r.internalTransfers > 0 && (
                          <p className="text-sm text-ink-2">
                            {r.internalTransfers} överföringar mellan egna konton, {r.transferPairs} nya par.
                          </p>
                        )}
                        <NewRowsPreview result={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-2">
        Totalt {totals.rowsNew} nya rader, {totals.uncategorized} utan kategori, {totals.pairs} överföringar parade
        {totals.recategorized > 0 && `, ${totals.recategorized} tidigare rader fick kategori`}
        {totals.notices > 0 && `, ${totals.notices} ${totals.notices === 1 ? "hyresavi" : "hyresavier"}`}
        {totals.receipts > 0 && `, ${totals.receipts} ${totals.receipts === 1 ? "deklarationskvittens" : "deklarationskvittenser"}`}
        {totals.errors > 0 && <span className="text-danger">, {totals.errors} fil(er) med fel</span>}.
      </p>
    </div>
  );
}
