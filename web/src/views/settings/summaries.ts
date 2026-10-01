import type {
  Account,
  Category,
  Contact,
  Digest,
  FuelOverview,
  IncomeSuggestion,
  ItemWatchSettings,
  NetworthSettings,
  RecurringIncome,
  ReferenceHouseholdResponse,
  SalaryOverview,
  TaxReturn,
} from "../../api";
import { formatKr } from "../../lib/format";

/**
 * The compact sections' sentences: what each is set to now (13 px) and what
 * it is for (11 px). Plain text, so the search can read them too.
 */
export interface Summary {
  summary: string;
  hint: string;
}

const kr = (ore: number) => formatKr(ore, { whole: true });
const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec = (v: number, digits = 1) => v.toLocaleString("sv-SE", { maximumFractionDigits: digits });
const percent = (share: number) => `${dec(share * 100)} %`;
/** 'a, b och c'. */
export const listSv = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} och ${xs.at(-1)}`);
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const dayMonth = (iso: string) => new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");

export const categoryPath = (categories: Category[], id: number | null) => {
  const c = categories.find((x) => x.id === id);
  if (!c) return "–";
  const p = c.parentId !== null ? categories.find((x) => x.id === c.parentId) : undefined;
  return p ? `${p.name} › ${c.name}` : c.name;
};

export function itemsSummary(s: ItemWatchSettings, categories: Category[]): Summary {
  const hint = "ett köp som inte hör till någon pryl blir en fråga i Att göra";
  if (s.categoryIds.length === 0) return { summary: "Ingen kategori vald: inga köp föreslås", hint };
  const [first, ...rest] = s.categoryIds.map((id) => categoryPath(categories, id));
  return { summary: `Fråga vid köp från ${kr(s.minAmount)} i ${first}${rest.length ? ` och ${rest.length} till` : ""}`, hint };
}

export function cashflowSummary(buffer: number, redBelowMonths: number | null): Summary {
  return {
    summary: `Buffert ${kr(buffer)}${redBelowMonths === null ? "" : ` · rött under ${dec(redBelowMonths)} månader med sparandet`}`,
    hint: "Safe to spend = lägsta punkten de kommande 90 dagarna minus bufferten",
  };
}

export function enduranceSummary(n: NetworthSettings): Summary {
  const a = n.akassa;
  const tax = a.taxRate ?? n.payslipTaxRate;
  return {
    summary: [
      `Buffertkonto ${n.bufferAccount?.name ?? "inget valt"}`,
      `tak ${kr(a.incomeCapOre)}/mån`,
      `${a.steps.map((x) => Math.round(x.rate * 100)).join("/")} %`,
      `skatt ${tax === null ? "–" : percent(tax)}`,
    ].join(" · "),
    hint: `a-kassan räknas på snittet av lönespecarna · skatten ${a.taxRate === null ? "enligt specarna" : "satt för hand"} · ${dec(a.daysPerMonth)} dagar/mån`,
  };
}

export function pensionSummary(n: NetworthSettings): Summary {
  const latest = [...n.pension.incomeBaseAmounts].sort((x, y) => y.year - x.year)[0];
  if (!latest) return { summary: "Inget inkomstbasbelopp inlagt", hint: "sätter taket för pensionsgrundande inkomst · nytt varje november" };
  return { summary: `Inkomstbasbelopp ${latest.year}: ${kr(latest.amountOre)}`, hint: `${latest.source ? `${latest.source} · ` : ""}nytt varje november` };
}

export function referenceSummary(r: ReferenceHouseholdResponse): Summary {
  const h = r.household;
  if (!h || !r.options) return { summary: "Inte inställt än", hint: "ange vilka som bor i hushållet, så jämför Analys era utgifter med Konsumentverkets" };
  const name = (key: string) => r.options!.items.find((i) => i.key === key)?.name ?? key;
  const excluded = h.excluded.map((k) => name(k).toLocaleLowerCase("sv"));
  return {
    summary: `Konsumentverket ${r.options.year} · ${h.persons.length} ${h.persons.length === 1 ? "person" : "personer"}`,
    hint: excluded.length ? `räknas inte: ${excluded.join(", ")}` : "alla poster räknas",
  };
}

export function pricesSummary(baseMonth: string | null, today: string): Summary {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const back = `${y - 1}-${String(m).padStart(2, "0")}`;
  return {
    summary: baseMonth ? `Startmånad ${baseMonth}` : `Startmånad ${back} (12 månader bakåt)`,
    hint: "indexeringen i Analys › Priser: matkostnad och KPI står i 100 där",
  };
}

export function digestSummary(d: Pick<Digest, "canSend" | "sentAt">): Summary {
  return {
    summary: `Söndagar 19:00 via ntfy · ${d.sentAt ? `senast skickad ${dayMonth(d.sentAt)}` : "inte skickad än"}`,
    hint: d.canSend ? "veckan som gick, samma text som i Översikten" : "ingen ntfy-topic satt – NTFY_TOPIC i .env",
  };
}

export function incomeSummary(incomes: RecurringIncome[], suggestions: IncomeSuggestion[], accounts: Account[]): Summary {
  const waiting = suggestions.length ? ` · ${suggestions.length} ${suggestions.length === 1 ? "förslag väntar" : "förslag väntar"}` : "";
  const first = incomes.find((i) => i.active) ?? incomes[0];
  const account = first && accounts.find((a) => a.id === first.accountId)?.name;
  const summary = first
    ? `${first.name} ${kr(first.amount)} den ${first.dayOfMonth}:e${account ? ` på ${account}` : ""}${incomes.length > 1 ? ` och ${incomes.length - 1} till` : ""}${waiting}`
    : `Inga återkommande inkomster${waiting}`;
  const s = suggestions[0];
  return {
    summary,
    hint: s ? `förslag: ${s.name} ${kr(s.amount)} den ${s.dayOfMonth}:e (${s.matchPattern}) · Lägg till` : first ? "importerade rader kopplas hit inom ±5 dagar" : "de föreslås efter en import med lön",
  };
}

export function carSummary(f: FuelOverview, categories: Category[]): Summary {
  const s = f.settings;
  const l100 = f.calibration && s.useCalibrated ? f.calibration.l100 : s.baseConsumption;
  const price = f.latestPrice ? `diesel ${kronor(f.latestPrice.price)} kr/l (${Number(f.latestPrice.date.slice(8))}/${Number(f.latestPrice.date.slice(5, 7))})` : "inget dieselpris";
  return {
    summary: `${dec(s.kmPerShift)} km/pass · ${dec(s.otherKmPerMonth)} km/mån · ${dec(l100)} l/100 km · ${price}`,
    hint: `${f.prices.length} ${f.prices.length === 1 ? "sparat pris" : "sparade priser"} · trängselskatt: ${s.congestionPerShift ? `${kronor(s.congestionPerShift)} kr/pass` : "ingen"} · tankning: ${categoryPath(categories, s.fuelCategoryId)}`,
  };
}

export function salarySummary(o: SalaryOverview): Summary {
  if (o.constants.length === 0) return { summary: "Inga lönespecar inlästa", hint: "läs in specarna, så räknas månadslön, tillägg och à-priser fram ur dem" };
  const months = o.constants.map((c) => c.validFrom);
  const sameYear = months.every((m) => m.slice(0, 4) === months[0].slice(0, 4));
  const monthText = sameYear
    ? `${listSv(months.map((m) => MONTHS[Number(m.slice(5)) - 1]))} ${months[0].slice(0, 4)}`
    : listSv(months.map((m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`));
  const c = o.constants.at(-1)!;
  const monthly = o.backtest.filter((b) => b.diff !== null);
  const exact = monthly.filter((b) => b.diff === 0).length;
  return {
    summary: `Konstanter från ${o.payslips.length} ${o.payslips.length === 1 ? "spec" : "specar"} · ${monthText} · tabell ${o.settings.taxTable}`,
    hint: [
      `månadslön ${kr(c.monthlySalary).replace(/\s*kr$/, "")}`,
      `mertid ${kronor(c.mertidRate)}`,
      c.vacationHourlyRate !== null && `semestertimlön ${kronor(c.vacationHourlyRate)}`,
      monthly.length > 0 && `modellen stämmer på öret för ${exact} av ${monthly.length} månadsspecar`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function partnerSummary(numbers: string[], contacts: Contact[], partnerName: string, ownName: string | null): Summary {
  return {
    summary: numbers.length ? numbers.map((n) => `${n} · ${contacts.find((c) => c.counterparty === n)?.name ?? partnerName}`).join(", ") : "Inget nummer inlagt",
    hint: `Swish från numret blir Inkomst › Från partner · ditt namn: ${ownName ?? "inte angivet"}`,
  };
}

export function contactsSummary(contacts: Contact[]): Summary {
  const names = contacts.map((c) => c.name);
  return {
    summary: names.length === 0 ? "Inga kontakter än" : names.length > 4 ? `${names.slice(0, 4).join(" · ")} … och ${names.length - 4} till` : names.join(" · "),
    hint: "namn som visas i stället för Swish-numret",
  };
}

/** Deklaration: which income years are there, and when the latest was sent. */
export function taxReturnsSummary(list: TaxReturn[]): Summary {
  const hint = "läs in Skatteverkets kvittens i Importer, eller mata in raderna här · används i Lön, Pension, Pendling och Kassaflöde";
  if (list.length === 0) return { summary: "Inga deklarationer inlästa", hint };
  const years = list.map((r) => r.incomeYear).sort((a, b) => a - b);
  const latest = list.reduce((a, b) => (b.incomeYear > a.incomeYear ? b : a));
  const span = years.length === 1 ? `${years[0]}` : years.at(-1)! - years[0] === years.length - 1 ? `${years[0]}–${years.at(-1)}` : listSv(years.map(String));
  const sent = latest.submittedAt ? ` · ${latest.incomeYear} skickad ${Number(latest.submittedAt.slice(8, 10))}/${Number(latest.submittedAt.slice(5, 7))} ${latest.submittedAt.slice(0, 4)}` : "";
  return { summary: `${years.length} inkomstår, ${span}${sent}`, hint };
}
