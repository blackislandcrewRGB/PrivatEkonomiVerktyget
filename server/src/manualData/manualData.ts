import { desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  accounts,
  bankAccounts,
  bankConnections,
  cashBalances,
  fuelFills,
  fuelPrices,
  odometerReadings,
  payslips,
  pensionStatements,
  referenceBudgetYears,
  salaryMonths,
  savingsHoldings,
  savingsValues,
  settlements,
  statements,
  trades,
} from "../db/schema.js";
import { addDays, addMonths, daysBetween, monthOf, todayLocal } from "../overview/dates.js";
import { buildOverview, INVOICE_REMINDER_DAY, missingInvoices, STALE_BALANCE_DAYS } from "../overview/overview.js";
import { listPrices, shiftsByMonth } from "../fuel/fuel.js";
import { getDeductionSettings } from "../fuel/deduction.js";
import { getSalarySettings, payDateFor } from "../salary/salary.js";
import { storedTaxYears } from "../salary/tax.js";
import { getPensionSettings, listPensions, monthsBetween, pensionForecastsView, STALE_MONTHS } from "../networth/pension.js";
import { currentBalances } from "../networth/manualBalances.js";
import { CONSENT_WARN_DAYS } from "../enableBanking/sync.js";
import { getSetting } from "../settings.js";
import { getHousehold } from "../referenceBudget/household.js";
import { referenceYearDue } from "../referenceBudget/due.js";
import { taxReturnDue } from "../tax/taxReturnDue.js";

/**
 * Att fylla i: everything the tool cannot fetch and has to be told, one row
 * each — where the figure is found, what kind of input it is, when it was
 * last given and how old it is by now.
 *
 * Only a view. Nothing here reminds anyone of anything (the tasks on
 * Översikt and the watch do that); it answers "what is typed in by hand, and
 * how fresh is it" in one place. A row appears once its part of the tool is
 * in use, so a module never touched does not nag.
 */

export type ManualDataStatus = "overdue" | "never" | "soon" | "ok" | "info";
export type ManualDataInput = "upload" | "amount" | "form" | "fetch" | "login" | "click" | "file";
export type ManualDataGroup = "Konton och kort" | "Lön" | "Pendling" | "Sparande" | "Förmögenhet och pension" | "Skatt" | "Delad ekonomi" | "Analys";

/** Where the form is: a view, its tab, a card on the page, or an action to open. */
export interface ManualDataLink {
  view: "overview" | "imports" | "commute" | "salary" | "shared" | "analysis" | "settings";
  search?: string;
  /** The id of the section to scroll to. */
  anchor?: string;
  editBalance?: number;
}

export interface ManualDataItem {
  key: string;
  group: ManualDataGroup;
  title: string;
  /** Where the figure is found in real life. */
  source: string;
  input: ManualDataInput;
  /** How often it needs doing, in words. */
  cadence: string;
  /** The day the figure is true for; a year ('2026') for the yearly ones. */
  asOf: string | null;
  /** Days since `asOf`, when it is a day. */
  ageDays: number | null;
  /** The day it was typed or uploaded (local); null when not recorded. */
  enteredOn: string | null;
  status: ManualDataStatus;
  /** Why the status, said plainly. */
  note: string;
  link: ManualDataLink;
}

/** The order the list is read in: what is late first, what has no clock last. */
export const STATUS_ORDER: ManualDataStatus[] = ["overdue", "never", "soon", "ok", "info"];

/** A stored UTC timestamp as the local day it happened on. */
const localDay = (ts: string | null | undefined) => (ts ? todayLocal(new Date(ts)) : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** 'YYYY-MM' as 'augusti'. */
const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];

/** Status by age: soon from `soon` days, overdue from `overdue`. */
function byAge(ageDays: number | null, soon: number, overdue: number): ManualDataStatus {
  if (ageDays === null) return "never";
  if (ageDays >= overdue) return "overdue";
  if (ageDays >= soon) return "soon";
  return "ok";
}

export function manualData(db: Db, today: string): ManualDataItem[] {
  const out: ManualDataItem[] = [];
  const month = monthOf(today);
  const year = Number(today.slice(0, 4));
  const monthNo = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const age = (d: string | null) => (d ? daysBetween(d.slice(0, 10), today) : null);
  /** '2027-03-18' as '18/3 2027', without the year when it is this one. */
  const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}${Number(iso.slice(0, 4)) === year ? "" : ` ${iso.slice(0, 4)}`}`;

  // ---------- Konton och kort ----------

  // Balances typed in: accounts that keep a balance and no bank sync feeds.
  // A card whose debt is worked out from its invoice needs nothing typed.
  const synced = new Set(db.select({ id: bankAccounts.accountId }).from(bankAccounts).where(isNotNull(bankAccounts.accountId)).all().map((r) => r.id));
  const manualAccounts = db.select().from(accounts).all().filter((a) => a.trackBalance && !synced.has(a.id) && (a.kind === "bank" || a.kind === "credit_card"));
  if (manualAccounts.length) {
    const balances = buildOverview(db, today).balances;
    for (const a of manualAccounts) {
      const b = balances.find((x) => x.id === a.id);
      const worked = !!b?.debt;
      const ageDays = worked ? 0 : age(a.balanceUpdatedAt);
      out.push({
        key: `balance:${a.id}`,
        group: "Konton och kort",
        title: `${a.name}: saldo`,
        source: "Internetbanken",
        input: "amount",
        cadence: `Varje vecka, om det inte räknas fram`,
        asOf: worked ? today : (a.balanceUpdatedAt?.slice(0, 10) ?? null),
        ageDays,
        enteredOn: localDay(a.manuallyEditedAt),
        status: worked ? "ok" : byAge(ageDays, STALE_BALANCE_DAYS - 2, STALE_BALANCE_DAYS + 1),
        note: worked ? "Räknas fram ur fakturan och köpen sedan dess — behöver inte skrivas in." : `Räknas som gammalt efter ${STALE_BALANCE_DAYS} dagar.`,
        link: { view: "overview", editBalance: a.id },
      });
    }
  }

  // The Mastercard invoice: no bank sync reaches it, so the PDF is the source.
  const missing = new Set(missingInvoices(db, today).map((m) => m.accountId));
  for (const a of db.select().from(accounts).where(eq(accounts.source, "mastercard")).all()) {
    const latest = db.select().from(statements).where(eq(statements.accountId, a.id)).orderBy(desc(statements.periodTo)).all().find((s) => s.source === "pdf");
    const asOf = latest?.periodTo ?? null;
    const thisMonth = !!asOf && asOf >= `${month}-01`;
    out.push({
      key: `invoice:${a.id}`,
      group: "Konton och kort",
      title: `${a.name}: fakturan`,
      source: "Swedbank, fakturan som PDF",
      input: "upload",
      cadence: "Varje månad, när perioden stängt (runt den 4:e–8:e)",
      asOf,
      ageDays: age(asOf),
      enteredOn: localDay(latest?.createdAt),
      status: !latest ? "never" : thisMonth ? "ok" : missing.has(a.id) ? "overdue" : "soon",
      note: !latest
        ? "Ingen faktura inläst."
        : thisMonth
          ? "Månadens faktura är inläst."
          : `Månadens faktura saknas${missing.has(a.id) ? "" : ` — påminnelse från den ${INVOICE_REMINDER_DAY}:e`}.`,
      link: { view: "imports" },
    });
  }

  // The bank consents: the one thing the sync cannot renew by itself.
  for (const c of db.select().from(bankConnections).all()) {
    if (c.status === "pending") continue;
    const until = c.validUntil?.slice(0, 10) ?? null;
    const left = until ? daysBetween(today, until) : null;
    const expired = c.status === "expired" || (left !== null && left < 0);
    out.push({
      key: `consent:${c.id}`,
      group: "Konton och kort",
      title: `${c.aspspName}: bankkopplingen`,
      source: "BankID hos banken, via Enable Banking",
      input: "login",
      cadence: "Ungefär var sjätte månad",
      asOf: localDay(c.authorizedAt),
      ageDays: age(localDay(c.authorizedAt)),
      enteredOn: localDay(c.authorizedAt),
      status: expired || c.lastError ? "overdue" : left !== null && left < CONSENT_WARN_DAYS ? "soon" : "ok",
      note: expired
        ? "Samtycket har gått ut — förnya det så hämtas raderna igen."
        : c.lastError
          ? `Senaste synken misslyckades: ${c.lastError}`
          : until
            ? `Gäller till ${dm(until)} (${plural(left!, "dag", "dagar")} kvar).`
            : "Inget slutdatum angivet.",
      link: { view: "settings", anchor: "banks" },
    });
  }

  // ---------- Lön ----------

  const salary = getSalarySettings(db);
  const latestSlip = db.select().from(payslips).orderBy(desc(payslips.payDate)).get();
  if (latestSlip) {
    // This month's pay day, and the payslip that goes with it.
    const payDate = payDateFor(addMonths(month, -salary.lagMonths), salary);
    const has = latestSlip.payDate >= `${month}-01`;
    const status: ManualDataStatus = has ? "ok" : today > addDays(payDate, 3) ? "overdue" : today >= addDays(payDate, -7) ? "soon" : "ok";
    out.push({
      key: "payslip",
      group: "Lön",
      title: "Lönespecen",
      source: "Lönespecen (htm eller PDF)",
      input: "upload",
      cadence: "Varje månad, runt löningen",
      asOf: latestSlip.payDate,
      ageDays: age(latestSlip.payDate),
      enteredOn: localDay(latestSlip.importedAt),
      status,
      note: has ? `Specen för löningen ${dm(payDate)} är inläst.` : `Specen för löningen ${dm(payDate)} saknas.`,
      link: { view: "settings", anchor: "salary" },
    });
  }

  const latestHours = db.select().from(salaryMonths).orderBy(desc(salaryMonths.month)).get();
  if (latestHours) {
    const has = (m: string) => !!db.select({ m: salaryMonths.month }).from(salaryMonths).where(eq(salaryMonths.month, m)).get();
    const current = has(month);
    const previous = has(addMonths(month, -1));
    out.push({
      key: "salary_hours",
      group: "Lön",
      title: "Timmar och tillägg per arbetsmånad",
      source: "Schemat eller tidrapporten",
      input: "form",
      cadence: "Varje månad",
      asOf: latestHours.month,
      ageDays: null,
      enteredOn: localDay(latestHours.updatedAt),
      status: current ? "ok" : previous ? "soon" : "overdue",
      note: current ? "Månadens timmar är ifyllda." : previous ? "Månadens timmar är inte ifyllda än." : "Förra och denna månadens timmar saknas.",
      link: { view: "salary" },
    });
  }

  const taxYears = storedTaxYears(db, salary.taxTable);
  if (latestSlip || taxYears.length) {
    const has = taxYears.includes(year);
    const nextSoon = monthNo === 12 && !taxYears.includes(year + 1);
    out.push({
      key: "tax_table",
      group: "Lön",
      title: `Skattetabell ${salary.taxTable}`,
      source: "Skatteverket (hämtas med en knapp)",
      input: "fetch",
      cadence: "En gång om året, i december",
      asOf: taxYears[0] ? String(taxYears[0]) : null,
      ageDays: null,
      enteredOn: null,
      status: !taxYears.length ? "never" : !has ? "overdue" : nextSoon ? "soon" : "ok",
      note: !taxYears.length
        ? "Ingen tabell hämtad — skatten räknas på lönespecarna."
        : !has
          ? `Tabellen för ${year} saknas — ${taxYears[0]} års används.`
          : nextSoon
            ? `Tabellen för ${year + 1} brukar komma i december.`
            : `Tabellen för ${year} finns.`,
      link: { view: "settings", anchor: "salary" },
    });
  }

  // ---------- Pendling ----------

  const shifts = shiftsByMonth(db);
  const prices = listPrices(db);
  if (shifts.size > 0 || prices.length > 0) {
    const next = addMonths(month, 1);
    const latestShiftMonth = [...shifts.keys()].sort().at(-1) ?? null;
    out.push({
      key: "shifts",
      group: "Pendling",
      title: "Arbetspass per månad",
      source: "Arbetsschemat",
      input: "form",
      cadence: "Varje månad, gärna i förväg",
      asOf: latestShiftMonth,
      ageDays: null,
      enteredOn: null,
      status: !shifts.has(month) ? "overdue" : day >= 20 && !shifts.has(next) ? "soon" : "ok",
      note: !shifts.has(month)
        ? "Den här månadens pass saknas — bränslet räknas inte in."
        : day >= 20 && !shifts.has(next)
          ? "Nästa månads pass är inte ifyllda än."
          : "Månadens pass är ifyllda.",
      link: { view: "commute" },
    });

    const price = db.select().from(fuelPrices).orderBy(desc(fuelPrices.date)).get();
    const lastPrice = price?.date ?? null;
    const priceAge = age(lastPrice);
    out.push({
      key: "fuel_price",
      group: "Pendling",
      title: "Dieselpriset",
      source: "Macken eller tankkvittot",
      input: "amount",
      cadence: "När du tankar",
      asOf: lastPrice,
      ageDays: priceAge,
      enteredOn: localDay(price?.createdAt),
      status: byAge(priceAge, 21, 30),
      note: "Räknas som gammalt efter 30 dagar.",
      link: { view: "settings", anchor: "bil" },
    });

    const lastFill = db.select().from(fuelFills).orderBy(desc(fuelFills.date)).get();
    const fillAge = age(lastFill?.date ?? null);
    out.push({
      key: "fuel_fills",
      group: "Pendling",
      title: "Tankkvitton",
      source: "Kvittot från macken",
      input: "form",
      cadence: "Varje tankning",
      asOf: lastFill?.date ?? null,
      ageDays: fillAge,
      enteredOn: localDay(lastFill?.createdAt),
      status: byAge(fillAge, 14, 30),
      note: "Efter 14 dagar utan tankning räknar prognosen med riksgenomsnittet.",
      link: { view: "commute" },
    });

    const lastOdo = db.select().from(odometerReadings).orderBy(desc(odometerReadings.date)).get();
    const odoAge = age(lastOdo?.date ?? null);
    out.push({
      key: "odometer",
      group: "Pendling",
      title: "Mätarställningen",
      source: "Bilens mätare",
      input: "amount",
      cadence: "Varannan månad eller så",
      asOf: lastOdo?.date ?? null,
      ageDays: odoAge,
      enteredOn: localDay(lastOdo?.createdAt),
      status: byAge(odoAge, 60, 90),
      note: "Stämmer av körsträckan mot modellen.",
      link: { view: "commute" },
    });

    const thresholds = Object.keys(getDeductionSettings(db).thresholds).sort();
    const hasYear = thresholds.includes(String(year));
    out.push({
      key: "deduction",
      group: "Pendling",
      title: "Reseavdragets gräns",
      source: "Skatteverket",
      input: "form",
      cadence: "En gång om året",
      asOf: thresholds.at(-1) ?? null,
      ageDays: null,
      enteredOn: null,
      status: hasYear ? "ok" : "overdue",
      note: hasYear ? `Gränsen för ${year} finns.` : `Gränsen för ${year} saknas — ${thresholds.at(-1)} års används.`,
      link: { view: "commute" },
    });
  }

  // ---------- Sparande ----------

  const cashAccounts = [...new Set(db.select({ a: cashBalances.account }).from(cashBalances).all().map((r) => r.a))];
  for (const account of cashAccounts) {
    const latest = db.select().from(cashBalances).where(eq(cashBalances.account, account)).orderBy(desc(cashBalances.date)).get()!;
    const ageDays = age(latest.date);
    out.push({
      key: `cash:${account}`,
      group: "Sparande",
      title: `Likvider på Avanza (${account === "isk" ? "ISK" : "Depå"})`,
      source: "Avanza-appen",
      input: "amount",
      cadence: "Efter en affär, och någon gång i månaden",
      asOf: latest.date,
      ageDays,
      enteredOn: localDay(latest.createdAt),
      status: byAge(ageDays, 30, 60),
      note: "Överföringar till Avanza räknas in efter datumet; köp och uttag gör det inte.",
      link: { view: "analysis", search: "?flik=sparande" },
    });
  }

  for (const h of db.select().from(savingsHoldings).all()) {
    const latest = db.select().from(savingsValues).where(eq(savingsValues.holdingId, h.id)).orderBy(desc(savingsValues.date)).get();
    const ageDays = age(latest?.date ?? null);
    out.push({
      key: `holding:${h.id}`,
      group: "Sparande",
      title: `${h.name}: värdet`,
      source: "Avanza-appen",
      input: "amount",
      cadence: "Varje månad",
      asOf: latest?.date ?? null,
      ageDays,
      enteredOn: localDay(latest?.createdAt),
      status: byAge(ageDays, 30, 45),
      note: "Stäms av mot det verktyget räknar fram ur innehaven.",
      link: { view: "analysis", search: "?flik=sparande" },
    });
  }

  const lastTrade = db.select().from(trades).where(isNull(trades.deletedAt)).orderBy(desc(trades.date)).get();
  if (lastTrade) {
    out.push({
      key: "trades",
      group: "Sparande",
      title: "Affärer (köp och sälj)",
      source: "Avräkningsnotan från Avanza",
      input: "form",
      cadence: "Vid varje affär",
      asOf: lastTrade.date,
      ageDays: age(lastTrade.date),
      enteredOn: localDay(lastTrade.createdAt),
      status: "info",
      note: "Ingen klocka: det är du som vet när du handlat.",
      link: { view: "analysis", search: "?flik=sparande" },
    });
  }

  // ---------- Förmögenhet och pension ----------

  for (const b of currentBalances(db, today)) {
    const ageDays = age(b.row.valueDate);
    const countsDown = b.row.recurringExpenseId !== null;
    out.push({
      key: `manual:${b.row.id}`,
      group: "Förmögenhet och pension",
      title: b.row.name,
      source: b.row.source ?? (b.row.kind === "debt" ? "Långivarens sidor" : "En uppskattning"),
      input: "amount",
      cadence: "En gång om året",
      asOf: b.row.valueDate,
      ageDays,
      enteredOn: localDay(b.row.updatedAt),
      status: byAge(ageDays, 330, 365),
      note: countsDown ? "Räknas ned av dragningarna efter datumet." : "Räknas som gammalt efter ett år.",
      link: { view: "overview", search: "?flik=situation" },
    });
  }

  const pensions = listPensions(db);
  for (const e of pensions) {
    const months = monthsBetween(e.valueDate, today);
    out.push({
      key: `pension:${e.id}`,
      group: "Förmögenhet och pension",
      title: `Pension: ${e.provider} – ${e.name}`,
      source: "minpension.se",
      input: "form",
      cadence: "En gång om året",
      asOf: e.valueDate,
      ageDays: age(e.valueDate),
      enteredOn: localDay(e.updatedAt),
      status: months >= STALE_MONTHS ? "overdue" : months >= STALE_MONTHS - 1 ? "soon" : "ok",
      note: `Räknas som gammalt efter ${STALE_MONTHS} månader.`,
      link: { view: "overview", search: "?flik=pension" },
    });
  }

  if (pensions.length) {
    const forecasts = pensionForecastsView(db, today);
    const newest = forecasts.latest.map((f) => f.madeOn).sort().at(-1) ?? null;
    const months = newest ? monthsBetween(newest, today) : null;
    const entered = forecasts.latest.map((f) => f.createdAt).sort().at(-1);
    out.push({
      key: "pension_forecast",
      group: "Förmögenhet och pension",
      title: "Pensionsprognosen",
      source: "minpension.se",
      input: "form",
      cadence: "En gång om året",
      asOf: newest,
      ageDays: age(newest),
      enteredOn: localDay(entered),
      status: months === null ? "never" : months >= STALE_MONTHS ? "overdue" : months >= STALE_MONTHS - 1 ? "soon" : "ok",
      note: months === null ? "Ingen prognos inlagd." : `Räknas som gammal efter ${STALE_MONTHS} månader.`,
      link: { view: "overview", search: "?flik=pension" },
    });

    // The envelope comes in the spring and speaks of the year two back.
    const expected = monthNo >= 4 ? year - 2 : year - 3;
    const latest = db.select().from(pensionStatements).orderBy(desc(pensionStatements.year)).get();
    out.push({
      key: "pension_statement",
      group: "Förmögenhet och pension",
      title: "Årsbeskedet (orange kuvertet)",
      source: "Pensionsmyndigheten, på våren",
      input: "form",
      cadence: "En gång om året",
      asOf: latest ? String(latest.year) : null,
      ageDays: null,
      enteredOn: localDay(latest?.enteredAt),
      status: !latest ? "never" : latest.year >= expected ? "ok" : "overdue",
      note: !latest ? "Inget årsbesked inlagt." : latest.year >= expected ? `Inkomståret ${latest.year} är inlagt.` : `Kuvertet för inkomståret ${expected} borde ha kommit.`,
      link: { view: "overview", search: "?flik=pension" },
    });
  }

  if (latestSlip || pensions.length) {
    const years = getPensionSettings(db).incomeBaseAmounts.map((a) => a.year);
    const has = years.includes(year);
    const nextSoon = monthNo >= 11 && !years.includes(year + 1);
    out.push({
      key: "ibb",
      group: "Förmögenhet och pension",
      title: "Inkomstbasbeloppet",
      source: "Regeringens beslut i november",
      input: "form",
      cadence: "En gång om året, i november",
      asOf: years.length ? String(Math.max(...years)) : null,
      ageDays: null,
      enteredOn: null,
      status: !has ? "overdue" : nextSoon ? "soon" : "ok",
      note: !has ? `Beloppet för ${year} saknas — ett äldre år används.` : nextSoon ? `Beloppet för ${year + 1} beslutas i november.` : `Beloppet för ${year} finns.`,
      link: { view: "settings", anchor: "pension" },
    });
  }

  // ---------- Skatt ----------

  // The receipt for last year's return, read in from Skatteverket's Mina sidor each spring.
  const due = taxReturnDue(db, today);
  if (due.inUse) {
    const sent = due.latest?.submittedAt;
    out.push({
      key: "tax_return",
      group: "Skatt",
      title: "Deklarationskvittens",
      source: "Skatteverket, Mina sidor",
      input: "upload",
      cadence: "En gång om året, mars–maj",
      asOf: due.latest ? String(due.latest.incomeYear) : null,
      ageDays: null,
      enteredOn: localDay(due.latest?.updatedAt),
      status: due.state === "done" ? "ok" : due.state === "soon" ? "soon" : due.state === "late" ? "overdue" : "never",
      note:
        due.state === "done"
          ? `Inkomståret ${due.incomeYear} är inläst${sent ? ` (skickad ${Number(sent.slice(8, 10))}/${Number(sent.slice(5, 7))} ${sent.slice(0, 4)})` : ""}.`
          : due.state === "soon"
            ? `Deklarera inkomståret ${due.incomeYear} senast 2 maj och läs in kvittensen.`
            : due.state === "late"
              ? `Kvittensen för inkomståret ${due.incomeYear} saknas.`
              : "Ingen deklaration inläst.",
      link: { view: "imports" },
    });
  }

  // ---------- Delad ekonomi ----------

  const start = getSetting<string | null>(db, "settlement_start_month", null);
  if (start) {
    const previous = addMonths(month, -1);
    const latest = db.select().from(settlements).orderBy(desc(settlements.month)).get();
    const due = previous >= start && !db.select({ m: settlements.month }).from(settlements).where(eq(settlements.month, previous)).get();
    out.push({
      key: "settlement",
      group: "Delad ekonomi",
      title: "Månadens avstämning",
      source: "Er egen genomgång",
      input: "click",
      cadence: "Varje månad, efter månadsskiftet",
      asOf: latest?.month ?? null,
      ageDays: null,
      enteredOn: localDay(latest?.settledAt),
      status: !due ? "ok" : day >= 15 ? "overdue" : "soon",
      note: due ? `${monthName(previous)[0].toUpperCase()}${monthName(previous).slice(1)} är inte avstämd.` : "Förra månaden är avstämd.",
      link: { view: "shared" },
    });
  }

  // ---------- Analys ----------

  // Konsumentverkets referensbudget: a file a year, once the comparison is in use.
  if (getHousehold(db)) {
    const loaded = db.select().from(referenceBudgetYears).orderBy(desc(referenceBudgetYears.year)).all();
    if (loaded.length) {
      const due = referenceYearDue(db, today);
      out.push({
        key: "reference_budget",
        group: "Analys",
        title: "Konsumentverkets referensbudget",
        source: "Konsumentverket, i mitten av november",
        input: "file",
        cadence: "En gång om året, i november",
        asOf: String(loaded[0].year),
        ageDays: null,
        enteredOn: localDay(loaded[0].loadedAt),
        status: !due ? "ok" : due.year > year ? "soon" : "overdue",
        note: !due ? `Året ${loaded[0].year} finns.` : due.year > year ? `${due.year} års siffror publiceras i mitten av november.` : `${due.year} saknas — ${due.latest} års används.`,
        link: { view: "analysis", search: "?flik=konsumentverket" },
      });
    }
  }

  return out.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}
