import { formatSek, type ImportResult, type MastercardInvoiceImportResult, type MastercardListImportResult, type NorwegianImportResult, type RentNoticeImportResult, type TaxReturnImportResult } from "../../api";
import { dayMonthYear, TAX_BOXES } from "../../lib/taxReturns";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";

/** 'oktober 2026'. */
export const monthYear = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });

export function StatementBox({ result }: { result: NorwegianImportResult | MastercardInvoiceImportResult }) {
  const s = result.statement;
  return (
    <div className="rounded-inset bg-card p-3 text-sm">
      <h3 className="mb-2 font-medium">Faktura → {result.account.name}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-2">Period</dt>
          <dd className="tabular-nums">
            {s.periodFrom} – {s.periodTo}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">Förfallodatum</dt>
          <dd className="tabular-nums">{s.dueDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">Total skuld</dt>
          <dd className="tabular-nums">{formatSek(s.totalDebt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">Lägsta belopp</dt>
          <dd className="tabular-nums">{s.minPayment === null ? "–" : formatSek(s.minPayment)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-ink-2">
        {s.alreadyImported ? "Fakturan är redan registrerad. " : ""}
        {"replacesManual" in s && s.replacesManual ? "Ersätter fakturan du lade in för hand. " : ""}
        {"nextPeriodTo" in s && s.nextPeriodTo ? `Nästa faktura tar med köp t.o.m. ${s.nextPeriodTo}. ` : ""}
        {s.updatesBalance
          ? `Kontots saldo sätts till ${formatSek(-s.totalDebt)}.`
          : "Kontots saldo ändras inte, eftersom det redan är uppdaterat per fakturadatumet eller senare."}
      </p>
    </div>
  );
}

export function PossibleDuplicates({ result }: { result: ImportResult }) {
  if (result.possibleDuplicates.length === 0) return null;
  return (
    <div className="rounded-lg border border-caution/40 bg-caution-soft p-3 text-sm">
      <h3 className="font-medium text-caution-text">Möjliga dubbletter ({result.possibleDuplicates.length})</h3>
      <p className="mb-2 text-xs text-caution-text">
        Samma transaktionsdag, belopp och beskrivning som en befintlig rad men annan bokföringsdag. Banken kan ha ändrat
        raden. De importeras ändå, så ta bort den överflödiga för hand om det behövs.
      </p>
      <table className="w-full">
        <thead className="text-left text-xs text-caution-text">
          <tr>
            <th className="pr-3 font-medium">Transaktionsdag</th>
            <th className="pr-3 font-medium">Beskrivning</th>
            <th className="pr-3 font-medium">Bokförd (ny / befintlig)</th>
            <th className="text-right font-medium">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {result.possibleDuplicates.map((d, i) => (
            <tr key={i} className="border-t border-caution/40">
              <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{d.transactionDate}</td>
              <td className="py-1 pr-3">{d.descriptionClean}</td>
              <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                {d.newBookingDate} / {d.existing.bookingDate}
              </td>
              <td className="whitespace-nowrap py-1 text-right tabular-nums">{formatSek(d.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Reserved rows (not imported), unmapped merchant categories and unusual row types. */
export function ExtraNotes({ result }: { result: ImportResult }) {
  const reserved = result.source === "norwegian" && result.format === "xlsx" ? result.reserved : null;
  const otherTypes = result.source === "norwegian" && result.format === "xlsx" ? result.otherTypes : [];
  const unmapped = result.unmappedMerchantCategories;
  const posted = result.source === "norwegian" && result.format === "xlsx" ? result.postedDatesAdded : 0;
  if (!reserved?.count && unmapped.length === 0 && otherTypes.length === 0 && !posted) return null;
  return (
    <div className="space-y-1 rounded-inset bg-card p-3 text-sm">
      {reserved && reserved.count > 0 && (
        <p>
          <span className="font-medium">{reserved.count} reserverade köp</span> ({formatSek(reserved.amount)})
          importeras inte. De kommer med när du exporterar månaden igen efter att de har bokförts.
        </p>
      )}
      {unmapped.length > 0 && (
        <p>
          <span className="font-medium">Okända handlarkategorier</span> (sparas så att de kan kopplas till en kategori
          senare): {unmapped.map((u) => `${u.label} (${u.rows})`).join(", ")}
        </p>
      )}
      {otherTypes.length > 0 && <p>Ovanliga radtyper, importerade som vanliga rader: {otherTypes.join(", ")}</p>}
      {posted > 0 && (
        <p>
          <span className="font-medium">{posted} befintliga köp</span> får bokföringsdag från filen, så att de hamnar på rätt
          faktura. Inget annat ändras.
        </p>
      )}
    </div>
  );
}

export function NewRowsPreview({ result }: { result: ImportResult }) {
  if (result.newRowsPreview.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium text-ink-2">
        Nya rader{" "}
        {result.rowsNew > result.newRowsPreview.length &&
          `(första ${result.newRowsPreview.length} av ${result.rowsNew})`}
      </h4>
      <table className="w-full text-sm">
        <tbody>
          {result.newRowsPreview.map((r, i) => (
            <tr key={i} className="border-t border-hairline">
              <td className="whitespace-nowrap py-1 pr-3 text-ink-2 tabular-nums">{r.bookingDate}</td>
              <td className="py-1 pr-3">{r.descriptionClean}</td>
              <td className="py-1 pr-3 text-ink-2">
                {r.category ?? <span className="text-caution-text">saknar kategori</span>}
                {r.isTransfer && <span className="ml-1 text-xs text-transfer">(överföring)</span>}
                {r.shared && <span className="ml-1 text-xs text-shared">delad</span>}
              </td>
              <td className="whitespace-nowrap py-1 text-right tabular-nums">{formatSek(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Mastercard transaction list: the debt check, rows found in the invoice, and rows that were cut off. */
export function MastercardListBox({ result: r }: { result: MastercardListImportResult }) {
  const d = r.debtCheck;
  return (
    <div className="space-y-2 rounded-inset bg-card p-3 text-sm">
      <h3 className="font-medium">Utskrift → {r.account.name}</h3>
      <p className="text-positive-text">
        Stämmer: fakturan t.o.m. {d.invoicePeriodTo} {formatSek(d.invoiceDebt)} + köpen efter {formatSek(d.after)} = utnyttjad kredit{" "}
        {formatSek(d.usedCredit)}.
      </p>
      {(r.matchedNearby > 0 || r.enriched > 0) && (
        <p className="text-ink-2">
          {r.matchedNearby > 0 && `${r.matchedNearby} rader fanns redan från fakturan (inom ±3 dagar). `}
          {r.enriched > 0 && `${r.enriched} befintliga rader kompletterades.`}
        </p>
      )}
      {r.incomplete.length > 0 && (
        <div className="text-caution-text">
          <p>Hoppade över {r.incomplete.length === 1 ? "en ofullständig rad" : `${r.incomplete.length} ofullständiga rader`}:</p>
          <ul className="ml-4 list-disc">
            {r.incomplete.map((x) => (
              <li key={`${x.date}${x.description}`}>
                {x.date} {x.description} – {x.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-2">
        {r.updatesBalance ? `Kontots saldo sätts till ${formatSek(-d.usedCredit)} (per ${r.printedAt}).` : "Kontots saldo ändras inte."}
      </p>
    </div>
  );
}

/** Existing rows that got details from a Mastercard invoice (posting day, city, currency). */
export function MastercardNotes({ result: r }: { result: MastercardInvoiceImportResult }) {
  if (r.matchedNearby === 0 && r.enriched === 0) return null;
  return (
    <p className="text-sm text-ink-2">
      {r.matchedNearby > 0 && `${r.matchedNearby} rader fanns redan från utskriften (inom ±3 dagar). `}
      {r.enriched > 0 && `${r.enriched} befintliga rader fick bokföringsdag, ort eller valuta från fakturan.`}
    </p>
  );
}

/** A rent notice: its rows, what to pay and when, and what it does to the rent's amount for the month it is paid in. */
export function RentNoticeBox({ result }: { result: RentNoticeImportResult }) {
  const n = result.notice;
  const e = result.expense;
  const changed = n.amount !== e.before;
  return (
    <div className="rounded-inset bg-card p-3 text-sm" data-testid="rent-notice">
      <h3 className="mb-2 font-medium">
        Hyresavi {n.number} från {n.issuer} → {e.name}
      </h3>
      <table className="mb-2 w-full max-w-md text-[13px]">
        <tbody>
          {n.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-4">{l.text}</td>
              <td className="py-0.5 text-right tabular-nums">{formatSek(l.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-hairline font-medium">
            <td className="py-0.5 pr-4">Att betala</td>
            <td className="py-0.5 text-right tabular-nums">{formatSek(n.amount)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-ink-2">
        Förfaller {n.dueDate}
        {n.bankgiro && ` · bankgiro ${n.bankgiro}`}. {n.alreadyImported ? "Avin finns redan. " : ""}
        {changed ? (
          <span className="text-caution-text">
            {e.name} i {monthYear(n.period)} blir {formatSek(n.amount)} (var {formatSek(e.before)}).
          </span>
        ) : (
          `${e.name} i ${monthYear(n.period)} är ${formatSek(n.amount)} som väntat.`
        )}
      </p>
    </div>
  );
}

/**
 * A tax return receipt: the boxes read by their numbers. When the year is
 * there already, what it had beside what it gets; importing is the
 * confirmation that it is replaced.
 */
export function TaxReturnBox({ result }: { result: TaxReturnImportResult }) {
  const t = result.taxReturn;
  const before = t.replaces;
  const value = (v: number | null) => (v === null ? "–" : formatKr(v, { whole: true }));
  return (
    <div className="rounded-inset bg-card p-3 text-sm" data-testid="tax-return">
      <h3 className="mb-2 font-medium">
        Deklarationskvittens · inkomståret {t.incomeYear}
        {t.submittedAt && <span className="font-normal text-ink-2"> · skickad {dayMonthYear(t.submittedAt)}</span>}
      </h3>
      <table className="mb-2 w-full max-w-lg text-[13px]">
        {before && (
          <thead>
            <tr className="text-[11px] text-ink-3">
              <th />
              <th className="pb-1 text-right font-medium">Nu</th>
              <th className="pb-1 text-right font-medium">Från kvittensen</th>
            </tr>
          </thead>
        )}
        <tbody>
          {TAX_BOXES.map((b) => {
            const changed = before && before.boxes[b.key] !== t.boxes[b.key];
            return (
              <tr key={b.key} data-box={b.number}>
                <td className="py-0.5 pr-4">
                  <span className="mr-2 inline-block w-7 text-ink-3 tabular-nums">{b.number}</span>
                  {b.label}
                </td>
                {before && <td className="py-0.5 pl-3 text-right text-ink-2 tabular-nums">{value(before.boxes[b.key])}</td>}
                <td className={cn("py-0.5 pl-3 text-right tabular-nums", t.boxes[b.key] === null && "text-ink-3", changed && "font-semibold text-caution-text")}>{value(t.boxes[b.key])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-ink-2">
        {t.alreadyImported
          ? "Kvittensen är redan inläst."
          : before
            ? `Inkomståret ${t.incomeYear} finns redan (${before.source === "manual" ? "inmatat för hand" : "från en kvittens"}${before.submittedAt ? `, skickad ${dayMonthYear(before.submittedAt)}` : ""}). Importera för att ersätta det; Ångra i historiken tar tillbaka det.`
            : "Rader som saknas i kvittensen sparas tomma."}{" "}
        Namn, personnummer, kvittensnummer och filen sparas inte.
      </p>
    </div>
  );
}
