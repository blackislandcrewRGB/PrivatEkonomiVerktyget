import { formatKr } from "./lib/format";
export interface Health {
  ok: boolean;
  databasePath: string;
  counts: { categories: number; rules: number; accounts: number; transactions: number };
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  color: string | null;
  isTransfer: boolean;
  isSettlement: boolean;
  systemKey: CategoryKey | null;
}

export type CategoryKey =
  | "income"
  | "salary"
  | "from_partner"
  | "to_partner"
  | "transfers"
  | "own_transfer"
  | "card_payment"
  | "unknown"
  | "groceries"
  | "restaurants"
  | "takeaway"
  | "savings";

/** A name rule: new imports whose text matches get the name (label). */
export interface LabelRule {
  id: number;
  pattern: string;
  matchType: "exact" | "contains" | "regex";
  label: string;
  createdAt: string;
  /** Rows that have the name and match the pattern. */
  rows: number;
}

export interface LabelRulePreview {
  matches: number;
  examples: string[];
}

export interface LabelRuleSaved {
  rule: LabelRule;
  previousLabel: string | null;
  renamed: number;
  applied: number;
  before: unknown[];
}

export interface Rule {
  id: number;
  pattern: string;
  matchType: "exact" | "contains" | "regex";
  direction: "any" | "in" | "out";
  categoryId: number;
  sharedDefault: boolean | null;
  isTransfer: boolean;
  createdFrom: "manual" | "llm" | "seed";
  /** Times it has categorised a row, ever. */
  hits: number;
  /** Rows of the last 12 months it decides (0: 'Oanvända'). */
  matches12: number;
  /** simple-icons slug, and an uploaded picture that wins over it. */
  brandSlug: string | null;
  iconPath: string | null;
  icon?: IconRef;
}

/** 'Testa mönster': every row a pattern would match. */
export interface RulePreview {
  /** Uncategorised rows it would categorise now. */
  matches: number;
  total: number;
  uncategorized: number;
  rows: { id: number; bookingDate: string; descriptionClean: string; amount: number; accountId: number | null; categoryId: number | null; isTransfer: boolean; private: boolean }[];
}

/** Per category (not rolled up): rows, rules, and rows and their signed sum in the last 12 months. */
/** Per category: rows, rules, and rows and their sum over the last 12 months and this year. */
export type CategoryUsage = Record<number, { transactions: number; rules: number; count12: number; sum12: number; countYtd: number; sumYtd: number }>;

export interface Account {
  id: number;
  name: string;
  balance: number;
  balanceUpdatedAt: string | null;
  note: string | null;
  kind: "bank" | "credit_card";
  source: "swedbank" | "norwegian" | "mastercard" | "csv" | null;
  /** Off: no balance to follow (not shown, not asked for, not in the forecast). */
  trackBalance: boolean;
  accountRef: string | null;
  clearing: string | null;
}

export interface ImportLog {
  id: number;
  source: "swedbank" | "norwegian" | "mastercard" | "csv" | "rent_notice" | "tax_return";
  filename: string;
  periodFrom: string | null;
  periodTo: string | null;
  importedAt: string;
  rowsTotal: number;
  rowsNew: number;
  rowsSkipped: number;
  /** A file brought in by hand, or a bank sync (Enable Banking). */
  via: "file" | "enable_banking";
  /** 'Ångra': possible (how many rows go, whether an invoice goes too) or why not. */
  undo?: { ok: true; rows: number; statement: boolean } | { ok: false; reason: string };
}

/** A page of Importer's history: whole days, newest first; `older` is what is left (from which day, how many). */
export interface ImportHistoryPage {
  imports: ImportLog[];
  older: { before: string; from: string; count: number } | null;
}

export interface FileAccount {
  ref: string;
  clearing: string;
  product: string;
  rows: number;
  accountId: number | "new" | null;
  resolvedBy: "choice" | "bound" | "hint" | null;
}

export interface PreviewRow {
  bookingDate: string;
  descriptionClean: string;
  amount: number;
  category: string | null;
  isTransfer: boolean;
  shared: boolean;
}

export interface PossibleDuplicate {
  transactionDate: string;
  descriptionClean: string;
  amount: number;
  newBookingDate: string;
  existing: { id: number; bookingDate: string };
}

interface ImportResultBase {
  dryRun: boolean;
  filename: string;
  rowsTotal: number;
  rowsNew: number;
  rowsSkipped: number;
  rowsUncategorized: number;
  newRowsPreview: PreviewRow[];
  possibleDuplicates: PossibleDuplicate[];
  unmappedMerchantCategories: { label: string; rows: number }[];
  internalTransfers: number;
  transferPairs: number;
  recurringLinked: number;
  recategorized: number;
  importId: number | null;
}

export interface SwedbankImportResult extends ImportResultBase {
  source: "swedbank";
  period: { from: string; to: string } | null;
  accounts: FileAccount[];
}

export interface NorwegianXlsxImportResult extends ImportResultBase {
  source: "norwegian";
  format: "xlsx";
  period: { from: string; to: string } | null;
  account: { id: number; name: string };
  reserved: { count: number; amount: number };
  /** Existing rows that get their posting day (BookDate) from this file. */
  postedDatesAdded: number;
  otherTypes: string[];
}

export interface NorwegianImportResult extends ImportResultBase {
  source: "norwegian";
  format: "pdf";
  period: { from: string; to: string };
  account: { id: number; name: string };
  statement: {
    invoiceDate: string | null;
    dueDate: string;
    periodFrom: string;
    periodTo: string;
    totalDebt: number;
    minPayment: number | null;
    alreadyImported: boolean;
    updatesBalance: boolean;
  };
}

interface MastercardResultBase extends ImportResultBase {
  source: "mastercard";
  period: { from: string; to: string };
  account: { id: number; name: string };
  /** Rows already imported from the other Mastercard file (±3 days) that were not added again. */
  matchedNearby: number;
  /** Existing rows that got details from this file (posting day, city, currency, card). */
  enriched: number;
}

export interface MastercardInvoiceImportResult extends MastercardResultBase {
  format: "invoice";
  statement: NorwegianImportResult["statement"] & {
    openingDebt: number | null;
    paymentsTotal: number | null;
    purchasesTotal: number | null;
    nextPeriodTo: string | null;
    replacesManual: boolean;
  };
}

export interface MastercardListImportResult extends MastercardResultBase {
  format: "list";
  printedAt: string;
  debtCheck: { usedCredit: number; invoiceDebt: number; invoicePeriodTo: string; after: number; ok: true };
  incomplete: { date: string; description: string; reason: string }[];
  updatesBalance: boolean;
}

export interface RentNoticeLine {
  text: string;
  amount: number;
}

/** A rent notice (hyresavi): no rows of its own; it sets the rent's amount for the period it is paid in. */
export interface RentNoticeImportResult extends ImportResultBase {
  source: "rent_notice";
  period: { from: string; to: string };
  account: { id: number; name: string } | null;
  notice: {
    issuer: string;
    number: string;
    noticeDate: string | null;
    dueDate: string;
    /** The month the rent is for. */
    rentMonth: string;
    /** The fixed expense's period it is paid in (the due date's month). */
    period: string;
    amount: number;
    lines: RentNoticeLine[];
    bankgiro: string | null;
    alreadyImported: boolean;
  };
  /** The fixed expense it belongs to, and what was expected for the period before. */
  expense: { id: number; name: string; usualAmount: number; before: number };
}

/** The boxes kept from a tax return (öre; null when the return doesn't have it). */
export interface TaxReturnBoxes {
  /** 1.1 Lön, förmåner, sjukpenning m.m. */
  employmentIncome: number | null;
  /** 2.1 Resor till och från arbetet. */
  commuteDeduction: number | null;
  /** 7.1 Schablonintäkter. */
  iskStandardIncome: number | null;
  /** 7.2 Ränteinkomster, utdelningar m.m. */
  capitalIncome: number | null;
  /** 8.1 Ränteutgifter m.m. */
  capitalExpenses: number | null;
}

/** An income year's tax return, read from Skatteverket's receipt or entered by hand. */
export interface TaxReturn {
  incomeYear: number;
  submittedAt: string | null;
  source: "pdf" | "manual";
  boxes: TaxReturnBoxes;
  updatedAt: string;
}

/** A tax return receipt: no rows of its own; it becomes its income year's return, replacing one that is there. */
export interface TaxReturnImportResult extends ImportResultBase {
  source: "tax_return";
  period: { from: string; to: string };
  taxReturn: {
    incomeYear: number;
    submittedAt: string | null;
    boxes: TaxReturnBoxes;
    alreadyImported: boolean;
    replaces: { submittedAt: string | null; source: "pdf" | "manual"; boxes: TaxReturnBoxes } | null;
  };
}

/** A fixed expense's rent notice, with the charge that paid it (by the period). */
export interface RentNotice {
  id: number;
  issuer: string;
  number: string;
  noticeDate: string | null;
  dueDate: string;
  rentMonth: string;
  period: string;
  amount: number;
  lines: RentNoticeLine[];
  bankgiro: string | null;
  paid: { date: string; amount: number } | null;
}

export type ImportResult =
  | SwedbankImportResult
  | NorwegianImportResult
  | NorwegianXlsxImportResult
  | MastercardInvoiceImportResult
  | MastercardListImportResult
  | RentNoticeImportResult
  | TaxReturnImportResult;

export interface ImportCoverage {
  accountId: number;
  name: string;
  kind: "bank" | "credit_card";
  source: "swedbank" | "norwegian" | "mastercard" | "csv" | null;
  importedTo: string | null;
  importedAt: string | null;
  /** How the account gets its rows: fetched from the bank, or files by hand. */
  via: "enable_banking" | "file";
  /** The last successful bank fetch: up to date then even when nothing new came. */
  syncedAt: string | null;
  /** The latest invoice's period end (credit cards), and where it says the next ends. */
  lastInvoiceTo: string | null;
  nextInvoiceTo: string | null;
}

export interface UpcomingInvoice {
  accountId: number;
  accountName: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  soFar: number;
  expectedFixed: number;
  estimate: number;
}

/** `index`: the file's place in the upload (a tax return receipt is renamed after its year, so the name doesn't find it). */
export type BatchFileResult =
  | { filename: string; index: number; ok: true; alreadyImported: boolean; result: ImportResult }
  | { filename: string; index: number; ok: false; error: string; details: string[] };

export interface BatchResult {
  dryRun: boolean;
  files: BatchFileResult[];
  accounts: FileAccount[];
}

export interface RecurringIncome {
  id: number;
  name: string;
  amount: number;
  dayOfMonth: number;
  accountId: number | null;
  active: boolean;
  matchPattern: string | null;
  lastReceived: string | null;
  recent: { id: number; bookingDate: string; amount: number }[];
  recentMin: number | null;
  recentAvg: number | null;
  overrides: { month: string; amount: number }[];
}

export interface IncomeSuggestion {
  name: string;
  accountId: number;
  accountName: string;
  amount: number;
  dayOfMonth: number;
  matchPattern: string;
  basedOn: { bookingDate: string; amount: number }[];
}

export type PaymentMethod = "card" | "credit_card" | "autogiro" | "transfer";

export type ScheduleType = "day_of_month" | "last_day";
export type BankDayRule = "none" | "next" | "previous";
export type DateBasis = "transaction" | "booking";

export interface ExpenseSchedule {
  scheduleType: ScheduleType;
  anchorDay: number | null;
  /** Yearly ones: the month (1–12) of the draw or renewal. */
  anchorMonth?: number | null;
  /** Days before the draw to ask in Att göra (null = 14 for a yearly renewal, 3 for a watched charge; 0 = never). */
  remindDays?: number | null;
  bankDayRule: BankDayRule;
}

/** The household's usual spending (last three whole months): up to the same day of the month, and a whole month. */
export interface UsualSpending {
  toDate: number;
  perMonth: number;
  day: number;
  from: string;
  to: string;
}

export interface ForeignPrice {
  currency: string;
  price: number;
  vatPercent: number;
  withVat: number;
  rate: number;
  rateDate: string;
  markup: number;
  amount: number;
}

export interface RecurringExpense extends ExpenseSchedule {
  id: number;
  name: string;
  amount: number;
  dateBasis: DateBasis;
  /** 'fast dag 28, flyttas till nästa bankdag'. */
  scheduleText: string;
  /** The next predicted draw. */
  nextDate: string | null;
  /** Linked charges more than ±2 days from the predicted draw. */
  offSchedule: number;
  /** A schedule that predicts more of the linked charges (never applied by itself). */
  suggestion: (ExpenseSchedule & { matches: number; total: number; currentMatches: number; text: string }) | null;
  paymentMethod: PaymentMethod;
  accountId: number | null;
  /** Moved to another card: the one before, drawn from up to the month before accountFrom (YYYY-MM). */
  previousAccountId: number | null;
  accountFrom: string | null;
  matchPattern: string | null;
  shared: boolean;
  categoryId: number | null;
  link: string | null;
  note: string | null;
  paused: boolean;
  /** Paused after this draw (YYYY-MM): counted and shared up to it. Null on a paused one: not counted at all. */
  lastPeriod: string | null;
  /** Months it wasn't drawn (paused for a while), YYYY-MM: nothing expected, missed or shared. */
  skippedPeriods: string[];
  /** A subscription to be cancelled before it draws again: Vakt asks in time, every period. */
  remindBeforeCharge: boolean;
  billingCycle: "monthly" | "yearly";
  yearlyAvailable: boolean;
  boundUntil: string | null;
  /** Drawn together with this expense (no charge of its own; follows its day and account). */
  partOfId: number | null;
  partOfName: string | null;
  /** The expenses drawn together with this one. */
  partNames: string[];
  linkedCount: number;
  latestCharge: { bookingDate: string; amount: number } | null;
  amountChanged: boolean;
  /** What was expected for the month of the latest charge. */
  latestExpected: number;
  /** Priced in a currency: the price with VAT against the latest charge's foreign amount (hundredths). */
  latestForeign?: { currency: string; expected: number; charged: number } | null;
  /** Priced in a currency (EUR, USD): the price before VAT in hundredths and the VAT on top. Null: kronor. */
  currency?: "EUR" | "USD" | null;
  foreignAmount?: number | null;
  vatPercent?: number | null;
  /** What the price comes to in kronor today: the rate (Riksbanken's) and the bank's markup. */
  foreignPrice?: ForeignPrice | null;
  /** A new price from a period on (YYYY-MM): the kronor then, and priced in a currency its new price before VAT. */
  nextFrom?: string | null;
  nextAmount?: number | null;
  nextForeignAmount?: number | null;
  /** The month of the next draw's period: where a new price starts by default. */
  nextPeriod?: string | null;
  /** The name of the plan it is on (Plus, Pro), and of the one a coming change goes to. */
  planName?: string | null;
  nextPlanName?: string | null;
  /** The plans it has been on in order, the one it is on now last; empty until it has changed plan. */
  plans?: PlanSpan[];
  /** Has its own amount for one or more months (e.g. CSN). */
  variesByMonth: boolean;
  thisMonthAmount: number;
  /** This month's draw and its status (null when paused or yearly). */
  thisMonth: {
    period: string;
    dueDate: string;
    status: ExpenseStatus;
    amount: number;
    transaction: { id: number; bookingDate: string; amount: number } | null;
  } | null;
  /** Its own uploaded image, else what its latest charge resolves to. */
  icon?: IconRef;
  /** The uploaded image of its own (data/icons), if any. */
  iconPath?: string | null;
  /** Yearly ones: this year's draw and its status (thisMonth only in the month it falls in). */
  thisYear?: {
    period: string;
    dueDate: string;
    status: ExpenseStatus;
    amount: number;
    transaction: { id: number; bookingDate: string; amount: number } | null;
  } | null;
  /** The rule its charges match: an uploaded picture can go there instead ('alla köp hos …'). */
  iconRule?: { id: number; pattern: string; hasImage: boolean } | null;
}

/** The panel's history: the last 12 months and the linked charges, newest first. */
export interface ExpenseHistory {
  months: ExpenseMonth[];
  charges: { id: number; bookingDate: string; transactionDate: string | null; amount: number; descriptionClean: string; accountId: number | null }[];
}

/** One plan of a fixed expense: the months it held for (the first has no known start; the current one no end). */
export interface PlanSpan {
  from: string | null;
  until: string | null;
  plan: { amount: number; foreignAmount: number | null; anchorDay: number | null; scheduleType: "day_of_month" | "last_day"; name: string | null };
}

export interface ExpenseMonth {
  month: string;
  /** The plan the month is on, and whether a new plan began in it (then it often has two charges). */
  plan?: string | null;
  planChange?: boolean;
  /** How many charges the month has. */
  charges?: number;
  /** The month's own amount, if set. */
  amount: number | null;
  /** What the month costs without an amount of its own: its plan's price. */
  usual?: number;
  expected: number;
  charged: number | null;
}

export interface Contact {
  id: number;
  counterparty: string;
  name: string;
  note: string | null;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Betalkort",
  credit_card: "Kreditkort",
  autogiro: "Autogiro",
  transfer: "Inbetalning",
};

/** '140', '140,50', '1 234.5' -> öre; null if not an amount. */
export function parseKr(input: string): number | null {
  const s = input.replace(/[\s\u00a0\u202f]|kr/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [kr, ore = ""] = s.split(".");
  return Number(kr) * 100 + Number(ore.padEnd(2, "0"));
}

export interface Settings {
  partnerSwishNumbers: string[];
  partnerName: string;
  /** My own name, for my initial in Delad ekonomi; null when not given. */
  ownName: string | null;
  /** Which of the optional parts (Lön, Pendling & bränsle) are switched on. */
  modules: { salary: boolean; commute: boolean };
}

export interface SharedRow {
  id: number | null;
  date: string;
  payDate: string;
  paid: boolean;
  description: string;
  amount: number;
  status?: "dragen" | "forvantat";
  recurringExpenseId?: number;
  categoryId?: number | null;
}

export interface SharedFigures {
  iPaid: number;
  partnerPaid: number;
  iPaidForPartner: number;
  partnerPaidForMe: number;
  fromPartner: number;
  toPartner: number;
  carryIn: number;
  half: number;
  result: number;
}

export interface SharedGroup {
  key: string;
  kind: "norwegian" | "mastercard" | "recurring" | "swedbank" | "manual";
  label: string;
  payDate?: string;
  periodEnd?: string;
  total: number;
  paidTotal: number;
  rows: SharedRow[];
}

export interface SwishCandidate {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string | null;
  current: "own" | "shared";
  suggest: "shared" | "partner";
}

export interface SharedMonth {
  month: string;
  today: string;
  partnerName: string;
  /** My own name (Inställningar), for my initial; null when not given. */
  ownName: string | null;
  startMonth: string;
  beforeStart: boolean;
  carryFrom: { month: string; reconciled: boolean; settledEven: boolean } | null;
  iPaid: { total: number; groups: SharedGroup[] };
  partnerPaid: { total: number; rows: SharedRow[] };
  forPartner: { total: number; rows: SharedRow[] };
  forMe: { total: number; rows: SharedRow[] };
  swishCandidates: Record<number, SwishCandidate[]>;
  transfers: {
    fromPartner: { total: number; rows: SharedRow[]; excluded: SharedRow[] };
    toPartner: { total: number; rows: SharedRow[]; excluded: SharedRow[] };
  };
  live: SharedFigures;
  sofar: SharedFigures;
  nextPayDate: string | null;
  /** The month's bill day (card invoice paid, usually the 25th). */
  payDay: string;
  settlement: (SharedFigures & { note: string | null; settledAt: string; carryForward: boolean }) | null;
  deviates: boolean;
  monthNotOver: boolean;
  incompleteImports: { source: "swedbank" | "norwegian" | "mastercard" | "csv"; importedTo: string | null }[];
  warnings: string[];
  /** The last six months up to this one (from the start month). Positive result: the partner pays me. */
  history: { month: string; result: number; status: "even" | "carried" | "open"; note: string | null; deviates: boolean }[];
}

/** A merchant's icon, resolved by the server once per list: an uploaded image or a brand (simple-icons slug). Absent: the monogram. */
export interface IconRef {
  brand?: string;
  image?: string;
}

/** One part of a purchase split across categories. The parts always sum to the row's amount. */
export interface SplitPart {
  categoryId: number;
  amount: number;
}

export interface Transaction {
  id: number;
  source: "swedbank" | "norwegian" | "mastercard" | "manual";
  accountId: number | null;
  bookingDate: string;
  transactionDate: string | null;
  descriptionClean: string;
  label: string | null;
  counterparty: string | null;
  counterpartyName: string | null;
  merchantArea: string | null;
  cardMasked: string | null;
  amount: number;
  currency: string;
  categoryId: number | null;
  categorySource: "rule" | "merchant_category" | "llm" | "manual" | "none";
  shared: boolean;
  private: boolean;
  paidBy: "me" | "partner";
  /** Wholly the other person's (not the payer's). */
  forOther: boolean;
  /** A Swish between us left out of the settlement. */
  settlementExcluded: boolean;
  /** A returned purchase and its refunds share this id; they count nowhere. */
  returnGroupId: number | null;
  isTransfer: boolean;
  isSettlement: boolean;
  occurrenceIndex: number;
  importId: number | null;
  counterAccountId: number | null;
  transferPairId: number | null;
  recurringIncomeId: number | null;
  recurringExpenseId: number | null;
  recurringExpenseName: string | null;
  note: string | null;
  manuallyEditedAt: string | null;
  deletedAt: string | null;
  icon?: IconRef;
  /** The categories the purchase is split across, or null when it isn't split. */
  splits?: SplitPart[] | null;
  /** The prylar this row paid for, or null when it isn't the payment for any. */
  items?: ItemLink[] | null;
  /** The receipt of this purchase and how many rows it holds, or null. */
  receipt?: { id: number; lines: number } | null;
}

export interface TransactionList {
  rows: Transaction[];
  truncated: boolean;
  /** outByDay: Ut per booking day (öre, negative), from the same amounts as out. */
  totals: { count: number; in: number; out: number; partial?: number; outByDay?: Record<string, number> };
}

export type RuleDirection = "any" | "in" | "out";

/** After renaming one row: a name rule for its text, so new imports get the name. */
export interface LabelRuleSuggestion {
  pattern: string;
  matchType: "exact" | "contains" | "regex";
  label: string;
  matches: number;
  examples: string[];
  existingRuleId: number | null;
}

export interface RuleSuggestion {
  pattern: string;
  matchType: "exact" | "contains" | "regex";
  direction: RuleDirection;
  categoryId: number;
  label: string;
  matches: number;
  existingRuleId: number | null;
}

export interface ReviewGroup {
  key: string;
  merchant: string;
  name: string | null;
  direction: "in" | "out";
  isSwish: boolean;
  count: number;
  sum: number;
  first: string;
  last: string;
  accountIds: number[];
  ids: number[];
  examples: string[];
  icon?: IconRef;
}

export interface ReviewGroups {
  groups: ReviewGroup[];
  /** Uncategorised private rows left out while private rows are hidden. */
  privateHidden: number;
}

export interface MonthCategory {
  categoryId: number | null;
  name: string;
  color: string;
  current: number;
  average: number;
}

export interface DuplicatePair {
  older: Transaction;
  newer: Transaction;
}

export interface ReviewCounts {
  uncategorized: number;
  duplicates: number;
  deleted: number;
}

/** Uploads a merchant icon (POST) to /rules/:id/icon or /recurring-expenses/:id/icon. */
export async function uploadIcon(url: string, file: File): Promise<{ iconPath: string; icon?: IconRef | null }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api${url}`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

// --- Prylar -------------------------------------------------------------
// Things I bought and chose to write down. A pryl is metadata, never money:
// nothing here is counted in a sum, a category or the settlement.

export type ItemOwner = "me" | "partner" | "shared";
export type ItemStatus = "owned" | "sold" | "returned" | "broken";
export type AttachmentKind = "image" | "receipt" | "other";

/** A pryl as a transaction row knows it: enough for the marker and its tooltip. */
export interface ItemLink {
  id: number;
  name: string;
}

export interface Item {
  id: number;
  name: string;
  category: string | null;
  purchaseDate: string;
  /** Öre, positive: what the thing cost. */
  priceOre: number;
  merchant: string | null;
  purchaseUrl: string | null;
  note: string | null;
  owner: ItemOwner;
  status: ItemStatus;
  warrantyMonths: number | null;
  returnDeadline: string | null;
  soldPriceOre: number | null;
  soldDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** The last day of the warranty, counted from the purchase date. */
  warrantyEndsOn: string | null;
  /** The picture the gallery shows, if there is one. */
  cover: string | null;
  attachmentCount: number;
  transactionIds: number[];
  icon: IconRef | null;
  /** The merchant as a person would say it ('Amazon' for 'AMAZON.SE* KP6TV'): the Handlare filter's name. */
  merchantName: string | null;
}

export interface ItemList {
  items: Item[];
  totals: { count: number; priceOre: number; soldOre: number };
  years: string[];
  categories: string[];
  /** The merchants by name, with how many prylar each, most first (over everything, not the filtered set). */
  merchants: { name: string; count: number }[];
  /** The subcategories under 'Prylar & hem', offered as choices. */
  categoryOptions: string[];
}

export interface ItemAttachment {
  id: number;
  itemId: number;
  kind: AttachmentKind;
  filePath: string;
  originalFilename: string | null;
  thumbnailPath: string | null;
  createdAt: string;
  deletedAt: string | null;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface ItemDetail extends Item {
  attachments: ItemAttachment[];
  transactions: { id: number; bookingDate: string; transactionDate: string | null; descriptionClean: string; label: string | null; amount: number; accountId: number | null; categoryId: number | null; deletedAt: string | null; icon: IconRef | null }[];
  categoryOptions: string[];
}

/** What 'Skapa pryl' is filled with when it opens from a transaction. */
export interface ItemSuggestion {
  transactionId: number;
  name: string;
  merchant: string;
  priceOre: number;
  /** When it was bought (the transaction's own date). */
  purchaseDate: string;
  /** When the bank booked it: what every list in the app shows. */
  bookedDate: string;
  category: string | null;
  icon: IconRef | null;
  categoryOptions: string[];
}

/** What Vakt asks about when a purchase might be a thing (Inställningar › Prylar). */
export interface ItemWatchSettings {
  categoryIds: number[];
  /** Öre, positive. */
  minAmount: number;
  defaultMinAmount: number;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** Why a file can't be an attachment, or null. The server reads the bytes again. */
export function attachmentFileError(file: File): string | null {
  const heic = /\.(heic|heif)$/i.test(file.name);
  // Safari and Finder don't always put a type on a HEIC, so the name decides then.
  if (!ATTACHMENT_TYPES.includes(file.type) && !(file.type === "" && heic)) return "Bara JPG, PNG, WebP, HEIC eller PDF går att lägga in.";
  const pdf = file.type === "application/pdf";
  const limit = pdf ? MAX_RECEIPT_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) return `Filen är ${Math.round(file.size / (1024 * 1024))} MB, högst ${Math.round(limit / (1024 * 1024))} MB går för ${pdf ? "PDF" : "bilder"}.`;
  return null;
}

/** Uploads a picture or a receipt to a pryl. */
export async function uploadAttachment(itemId: number, file: File, kind?: AttachmentKind): Promise<ItemAttachment> {
  const form = new FormData();
  form.append("file", file);
  if (kind) form.append("kind", kind);
  const res = await fetch(`/api/items/${itemId}/attachments`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`);
  return body as ItemAttachment;
}

/** Kvitton: what a purchase bought. Metadata, never money. */
export type ReceiptStore = "lidl" | "ica" | "willys" | "rusta";
export type ReceiptLineKind = "item" | "discount" | "deposit" | "bag";

export interface ReceiptLine {
  kind: ReceiptLineKind;
  name: string;
  /** Thousandths: 2 pieces is 2000, 0,124 kg is 124. */
  quantityMilli: number | null;
  unit: "st" | "kg" | null;
  unitPriceOre: number | null;
  /** Signed the way the receipt writes it: negative for a discount. */
  totalOre: number;
}

export interface StoredReceiptLine extends ReceiptLine {
  id: number;
  receiptId: number;
  position: number;
  nameKey: string;
}

export interface Receipt {
  id: number;
  transactionId: number | null;
  store: ReceiptStore;
  storeArea: string | null;
  purchaseDate: string;
  purchaseTime: string | null;
  totalOre: number;
  statedItemCount: number | null;
  source: "text" | "pdf";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lines: StoredReceiptLine[];
}

/** What POST /receipts/parse answers: read, but not stored. */
export interface ParsedReceipt {
  store: ReceiptStore;
  storeArea: string | null;
  /** The receipt's own date, null when it doesn't state one. */
  receiptDate: string | null;
  /** That date, or the purchase's own day when the receipt has none. */
  purchaseDate: string | null;
  purchaseTime: string | null;
  totalOre: number | null;
  sumOre: number;
  /** The rows add up to the stated total: nothing was missed or read twice. */
  balances: boolean;
  statedItemCount: number | null;
  source: "text" | "pdf";
  rawText: string;
  lines: ReceiptLine[];
  transaction: {
    id: number;
    bookingDate: string;
    transactionDate: string | null;
    descriptionClean: string;
    /** Positive: what was paid. */
    amountOre: number;
    matchesTotal: boolean;
    hasReceipt: boolean;
  } | null;
}

export const RECEIPT_STORE_NAMES: Record<ReceiptStore, string> = { lidl: "Lidl", ica: "ICA", willys: "Willys", rusta: "Rusta" };

// ---------- Innehav (Sparande) ----------

export type InstrumentZone = "base" | "bet";
export type InstrumentKind = "etf" | "stock";
export type InstrumentCurrency = "SEK" | "USD" | "EUR";
export type TradeAccount = "isk" | "depot";
export type TradeSide = "buy" | "sell" | "opening";

export const ACCOUNT_NAMES: Record<TradeAccount, string> = { isk: "ISK", depot: "Depå" };
export const ZONE_NAMES: Record<InstrumentZone, string> = { base: "Basen", bet: "Bet-zonen" };
export const SIDE_NAMES: Record<TradeSide, string> = { buy: "Köp", sell: "Sälj", opening: "Startinnehav" };

/** What a price source is called in Swedish. An unknown one is shown as it is stored. */
const SOURCE_NAMES: Record<string, string> = { yahoo: "Yahoo", avanza: "Avanza", riksbank: "Riksbanken" };
export const sourceName = (source: string) => SOURCE_NAMES[source] ?? source;

export interface Instrument {
  id: number;
  name: string;
  isin: string | null;
  currency: InstrumentCurrency;
  kind: InstrumentKind;
  zone: InstrumentZone;
  tickerYahoo: string | null;
  tickerAvanza: string | null;
  createdAt: string;
  deletedAt: string | null;
}

/** One holding, valued. A missing price or rate leaves `valueOre` null on purpose. */
export interface ValuedHolding {
  instrumentId: number;
  name: string;
  isin: string | null;
  currency: InstrumentCurrency;
  kind: InstrumentKind;
  zone: InstrumentZone;
  account: TradeAccount;
  quantityE4: number;
  priceE4: number | null;
  priceDate: string | null;
  priceSource: string | null;
  rateE6: number | null;
  rateDate: string | null;
  rateSource: string | null;
  valueOre: number | null;
  missing: "price" | "rate" | null;
  /** The price is older than three bank days: valued, but not at a current price. */
  stale: boolean;
}

export interface PortfolioValue {
  on: string;
  holdings: ValuedHolding[];
  instruments: { instrumentId: number; name: string; zone: InstrumentZone; currency: InstrumentCurrency; quantityE4: number; valueOre: number | null; investedOre: number | null; investedUnknown: boolean }[];
  accounts: { account: TradeAccount; securitiesOre: number; cashOre: number | null; cashDate: string | null; totalOre: number }[];
  zones: Record<InstrumentZone, { zone: InstrumentZone; valueOre: number; share: number | null; targetShare: number }>;
  policy: { betShare: number | null; state: "over" | "under" | "within" | "unknown"; trimOre: number | null; toBaseOre: number | null; roomOre: number | null; text: string };
  totalOre: number;
  investedOre: number | null;
  priceDate: string | null;
  missing: ValuedHolding[];
  /** Holdings valued at an old price. */
  stale: ValuedHolding[];
  reconciliation: {
    on: string;
    securitiesOre: number;
    cashOre: number | null;
    cashDate: string | null;
    computedOre: number;
    enteredOre: number | null;
    enteredDate: string | null;
    differenceOre: number | null;
    text: string;
  };
}

export interface InstrumentDetail {
  instrument: Instrument;
  quantityE4: number;
  valueOre: number | null;
  investedOre: number | null;
  investedUnknown: boolean;
  priceE4: number | null;
  priceDate: string | null;
  priceSource: string | null;
  trades: {
    id: number;
    account: TradeAccount;
    side: TradeSide;
    date: string;
    quantityE4: number;
    priceE4: number;
    feeOre: number;
    fxRateE6: number | null;
    amountOre: number | null;
    transactionId: number | null;
    note: string | null;
  }[];
  history: { date: string; priceE4: number; source: string }[];
}

/** A transfer to the broker a trade can be tied to. */
export interface SavingsTransfer {
  id: number;
  date: string;
  amountOre: number;
  text: string;
  linked: boolean;
}

export interface PriceSyncResult {
  at: string;
  ok: boolean;
  prices: { instrumentId: number; name: string; ticker: string; ok: boolean; date?: string; priceE4?: number; error?: string }[];
  rates: { pair: string; ok: boolean; date?: string; rateE6?: number; source?: string; error?: string }[];
}

/** Ten-thousandths of a share or a price: '167,14' → 1671400. */
export function parseScaled(input: string, decimals: number): number | null {
  const text = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  return Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || 0);
}

/** '167,14' from 1671400, without trailing zeroes beyond what it needs. */
export const formatScaled = (value: number, decimals: number, max = decimals) =>
  (value / 10 ** decimals).toLocaleString("sv-SE", { maximumFractionDigits: max });

// ---------- Varor ----------

/** A shelf groceries are sorted onto. Its own list, not the budget's categories. */
export interface ProductGroup {
  id: number;
  name: string;
  color: string | null;
  position: number;
}

/** One grocery, as it is followed over time, with what the period says about it. */
export interface Product {
  id: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  /** Every name a shop has printed for it, folded. */
  aliases: string[];
  times: number;
  totalOre: number;
  lastPurchase: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the receipts in a period add up to, and how much of the food they cover. */
export interface GrocerySummary {
  coverage: { purchases: number; withReceipt: number; spentOre: number; receiptOre: number };
  groups: { id: number | null; name: string; color: string | null; totalOre: number; times: number }[];
  /** `receipts`: how many receipts the month has; a month without is not drawn. */
  months: { month: string; totalOre: number; receipts: number; groups: Record<string, number> }[];
  /** `bags`: how many, when every bag row says; null otherwise. */
  extras: { discountOre: number; depositOre: number; bagOre: number; bags: number | null };
  stores: { store: ReceiptStore; receipts: number; totalOre: number }[];
}

/** Every time one grocery was bought, and what that says about it. */
export interface ProductHistory {
  rows: {
    receiptId: number;
    date: string;
    store: ReceiptStore;
    name: string;
    quantityMilli: number | null;
    /** The receipt only ever writes pieces or kilos. */
    unit: "st" | "kg" | null;
    unitPriceOre: number | null;
    totalOre: number;
  }[];
  everyDays: number | null;
  perMonthOre: number | null;
  cheapestStore: ReceiptStore | null;
}

/** Reads a pasted receipt. Nothing is stored until the rows have been looked over. */
export const parseReceiptText = (text: string, transactionId: number | null) =>
  sendJson<ParsedReceipt>("POST", "/receipts/parse", { text, transactionId });

/** The same, for a receipt that came as a PDF (Kivra). */
export async function parseReceiptPdf(file: File, transactionId: number | null): Promise<ParsedReceipt> {
  const form = new FormData();
  form.append("file", file);
  if (transactionId !== null) form.append("transactionId", String(transactionId));
  const res = await fetch("/api/receipts/parse", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`);
  return body as ParsedReceipt;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export async function uploadImports(
  files: File[],
  opts: { dryRun: boolean; accountMap?: Record<string, number | "new"> },
): Promise<BatchResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (opts.dryRun) form.append("dryRun", "1");
  if (opts.accountMap) form.append("accountMap", JSON.stringify(opts.accountMap));
  const res = await fetch("/api/imports", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, body.details ?? []);
  return body as BatchResult;
}

// ---------- A bank's CSV, with a column mapping (server/src/import/csvImport.ts) ----------

export interface CsvMapping {
  delimiter: "," | ";" | "\t";
  skipLines: number;
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: "iso" | "ymd" | "dmy-slash" | "dmy-dot" | "dmy-dash" | "mdy-slash";
  textColumn: number;
  extraTextColumn: number | null;
  amountMode: "signed" | "split";
  amountColumn: number | null;
  outColumn: number | null;
  inColumn: number | null;
  decimal: "," | ".";
  outIsNegative: boolean;
}

export interface CsvImportResult {
  dryRun: boolean;
  source: "csv";
  filename: string;
  period: { from: string; to: string } | null;
  accountId: number;
  rowsTotal: number;
  rowsNew: number;
  rowsSkipped: number;
  rowsLinked: number;
  rowsUncategorized: number;
  internalTransfers: number;
}

export interface CsvPreview {
  filename: string;
  encoding: "utf-8" | "windows-1252";
  mapping: CsvMapping;
  origin: "sent" | "saved" | "guessed";
  table: { columns: number; header: string[] | null; sample: string[][]; lines: number };
  read: { count: number; period: { from: string; to: string } | null; sample: { date: string; text: string; amountOre: number }[] } | { error: string; details: string[] };
  dryRun: CsvImportResult | null;
}

async function csvRequest<T>(path: string, file: File, fields: Record<string, string | undefined>): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  const res = await fetch(`/api${path}`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, body.details ?? []);
  return body as T;
}

/** What a CSV looks like and what a mapping makes of it; the mapping is the account's kept one or a guess when none is sent. */
export const previewCsv = (file: File, opts: { accountId: number | null; mapping?: Partial<CsvMapping> | null }) =>
  csvRequest<CsvPreview>("/imports/csv/preview", file, { accountId: opts.accountId ? String(opts.accountId) : undefined, mapping: opts.mapping ? JSON.stringify(opts.mapping) : undefined });

/** Imports a CSV onto an account with a mapping (which is then kept for the account). */
export const importCsv = (file: File, opts: { accountId: number; mapping: CsvMapping }) =>
  csvRequest<CsvImportResult>("/imports/csv", file, { accountId: String(opts.accountId), mapping: JSON.stringify(opts.mapping) });

export interface MerchantCategoryMapping {
  id: number;
  key: string;
  label: string;
  categoryId: number | null;
  timesSeen: number;
  lastSeenAt: string | null;
  /** Its rows still without a category (not deleted, not transfers). */
  uncategorized: number;
}

export async function sendJson<T>(
  method: "PUT" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Amounts are stored in öre. '−1 234,56 kr' (see formatKr). */
export function formatSek(ore: number): string {
  return formatKr(ore);
}

export type ExpenseStatus = "kommande" | "dragen" | "forfallen" | "markerad_betald" | "passerad";

export interface Occurrence {
  expenseId: number;
  name: string;
  accountId: number | null;
  paymentMethod: PaymentMethod;
  amount: number;
  dueDate: string;
  period: string;
  status: ExpenseStatus;
  transaction: { id: number; bookingDate: string; amount: number } | null;
  inForecast: boolean;
}

export interface InvoiceStatus {
  statementId: number;
  accountId: number;
  accountName: string;
  dueDate: string;
  amountDue: number;
  minPayment: number | null;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
  paidBy: "payment" | "manual" | null;
  daysUntilDue: number;
}

export interface Overview {
  today: string;
  /** Kvar vid månadsskiftet: the cash flow's balance when this month's bills are paid (the 1st of next month). */
  monthStart?: {
    date: string;
    balance: number;
    cashOre: number;
    month: string;
    foodOnly: boolean;
    partner: boolean;
    /** Where it starts: the bank accounts and the cash on ISK, as in Pengar nu. start + the terms = balance. */
    start?: number;
    terms?: MonthStartTerm[];
  } | null;
  payday: {
    incomeId: number;
    name: string;
    accountId: number | null;
    date: string;
    month: string;
    daysUntil: number;
    expected: number;
    expectedSource: "forecast" | "override" | "estimate";
    override: number | null;
    estimate: number;
    /** Löneprognos for the month (hours entered under Lön). */
    forecast: { workMonth: string; payDate: string; gross: number; net: number; hours: number; vacationHours: number; vacationPayout?: number; assumed?: boolean; fromSpec?: boolean } | null;
    late: boolean;
    received: { month: string; bookingDate: string; availableDate?: string; amount: number; forecast: number | null; diff: number | null } | null;
    /** Booked but not yet in the balance (Swedbank books the salary the day before): the next salary until availableDate. */
    pending?: { bookingDate: string; availableDate: string; amount: number } | null;
  } | null;
  forecast: {
    start: number;
    startAccounts: { id: number; name: string; balance: number }[];
    otherIncome: { name: string; date: string; amount: number }[];
    fixed: number;
    fixedCount: number;
    invoices: { accountName: string; dueDate: string; amount: number }[];
    /** Pendling & bränsle: fuel still to buy this month, and next month's up to payday. */
    fuel: { month: string; thisMonth: number; next: { month: string; amount: number; estimated: boolean } | null; amount: number } | null;
    left: number;
    days: number;
    perDay: number;
    partner: { amount: number; partnerName: string; month: string; latestSettled: string | null };
  } | null;
  /** Pengar nu: the bank accounts whose balance is followed and the cash on ISK. */
  money: { bankOre: number; iskOre: number; totalOre: number; accounts: { id: number; name: string; balance: number }[] };
  /** Dagar utan köp this month: the food shop and fuel don't count. */
  noSpend: {
    month: string;
    days: { date: string; status: "free" | "spent" | "today" | "future"; items: { name: string; amount: number }[] }[];
    /** Days before today with nothing bought, and days before today. */
    free: number;
    past: number;
    /** What was bought this month (the same things the dots count), and the usual for the same days. */
    amount?: number;
    usual?: UsualSpending;
  };
  /** Restaurang och hämtmat this month: the days the household ate out, how many and what it cost. */
  eatingOut: {
    month: string;
    days: { date: string; status: "out" | "home" | "today" | "future"; items: { name: string; amount: number }[] }[];
    count: number;
    amount: number;
    usual: UsualSpending;
  };
  /** Livsmedel this month week by week (Monday–Sunday, cut at the month's ends), the household's; and the usual week (the last three whole months). */
  groceryWeeks: {
    month: string;
    weeks: { week: number; from: string; to: string; amount: number; status: "past" | "current" | "future" }[];
    total: number;
    averagePerWeek: number;
    averageFrom: string;
    averageTo: string;
    usual: UsualSpending;
  };
  /** perDay: all of it; bankPerDay: what leaves the bank before payday; cardPerDay: on the cards, paid with the next salary. */
  pace: { days: number; from: string; to: string; total: number; perDay: number; bankPerDay: number; cardPerDay: number };
  paceHousehold: { days: number; from: string; to: string; total: number; perDay: number; bankPerDay: number; cardPerDay: number };
  balances: {
    id: number;
    name: string;
    kind: "bank" | "credit_card";
    source: "swedbank" | "norwegian" | "mastercard" | null;
    trackBalance: boolean;
    balance: number;
    updatedAt: string | null;
    ageDays: number | null;
    stale: boolean;
    /** A card's debt worked out from its invoice (null: the balance as stored). */
    debt: { amountOre: number; unpaid: number; since: number; settledTo: string; dueDate: string; invoicePaid: boolean; lastPurchase: string | null } | null;
    invoice: InvoiceStatus | null;
    /** The latest invoice was imported (PDF): no need to enter it by hand. */
    invoiceImported: boolean;
    nextInvoice: UpcomingInvoice | null;
  }[];
  recurring: {
    accountId: number | null;
    accountName: string;
    kind: "bank" | "credit_card" | null;
    items: Occurrence[];
    total: number;
    remaining: number;
    nextDraws: { paymentMethod: PaymentMethod; date: string; count: number; amount: number }[];
  }[];
  month: {
    day: number;
    categories: MonthCategory[];
    household: MonthCategory[];
  };
  /** Sparandet: value, the day its prices are from, and the two zones. No change, no colour. */
  portfolio: {
    totalOre: number;
    priceDate: string | null;
    zones: { base: number | null; bet: number | null };
    betState: "over" | "under" | "within" | "unknown";
    missing: number;
    /** Holdings valued at an old price (older than three bank days). */
    stale: number;
  } | null;
  /** Ekonomisk situation: two figures and nothing else. */
  situation: {
    /** Pengar totalt: the bank, the securities and cash on ISK. */
    moneyOre: number;
    netExCsnOre: number;
    netIncCsnOre: number;
    /** Null when there is no monthly cost to divide by, or no buffer account. */
    bufferMonths: number | null;
    bufferAccount: string | null;
  } | null;
  warnings: {
    kind: "overdue_expense" | "invoice_due" | "invoice_missing" | "stale_balance" | "amount_changed" | "review" | "salary_late";
    text: string;
  }[];
  upcomingInvoices: UpcomingInvoice[];
  timeline: Timeline;
  tasks: OverviewTask[];
}

/** Kommande 14 dagar on the overview. */
export interface TimelineEvent {
  date: string;
  /** 'work': Jobb, the day a month's work schedule is due (amount 0). */
  kind: "income" | "expense" | "invoice" | "work";
  name: string;
  /** Öre, positive. */
  amount: number;
  accountId: number | null;
  /** A fixed expense drawn on a credit card. */
  onCard: boolean;
  status: ExpenseStatus | "expected" | "unpaid" | "partial" | "estimate" | "received";
  expenseId?: number;
  period?: string;
  statementId?: number;
  /** Work: the month the schedule covers. */
  month?: string;
}

/** Schemadeadline: the day a month's work schedule is due at the latest (the notice is a setting). */
export interface ScheduleDeadline {
  date: string;
  /** The month the schedule covers (YYYY-MM). */
  month: string;
  name: string;
  received: boolean;
}

/** A term on the way to the 1st (the cash flow's own, summing to Kvar vid månadsskiftet). */
export interface MonthStartTerm {
  key: "income" | "partner" | "bills";
  label: string;
  /** Öre, signed. */
  amount: number;
  from: string;
  to: string;
  estimate: boolean;
  items: { date: string; name: string; amount: number; estimate: boolean }[];
}

export interface Timeline {
  from: string;
  to: string;
  payday: string | null;
  events: TimelineEvent[];
  /** The last day the account rows cover: the day before payday, or the 14 days' end if later. */
  accountsTo?: string;
  /** Everything in the account rows (öre, positive). */
  accountsTotal?: number;
  /** Per account: fixed expenses still to be drawn, before payday (total/count) and up to accountsTo. */
  accounts: {
    accountId: number;
    accountName: string;
    kind: "bank" | "credit_card";
    before: string;
    beforePayday: boolean;
    total: number;
    count: number;
    windowTotal: number;
    windowCount: number;
    items: { expenseId: number; period: string; name: string; amount: number; dueDate: string; beforePayday: boolean }[];
  }[];
}

/** Konsumentverkets referensbudget: the household it is counted for. */
export type ReferencePersonRole = "me" | "partner" | "other";
export interface ReferencePerson {
  role: ReferencePersonRole;
  name?: string;
  ageGroup: string;
  food: string;
  age?: number | null;
}
export interface ReferenceHousehold {
  persons: ReferencePerson[];
  excluded: string[];
}
export interface ReferenceHouseholdResponse {
  household: ReferenceHousehold | null;
  /** The latest loaded year's choices; null before any year is loaded. */
  options: {
    year: number;
    ageGroups: { key: string; label: string }[];
    food: { key: string; name: string }[];
    items: { key: string; name: string; scope: "individual" | "household" }[];
  } | null;
  partnerName: string;
}

/** Jämfört med Konsumentverket: one item's reference against what was spent (öre per month). */
export interface ReferenceDiff {
  ore: number | null;
  /** Per cent with one decimal; null against a zero reference. */
  pct: number | null;
}
export interface ReferenceWindow {
  from: string;
  to: string;
  /** Months the data reaches; the average divides by these. */
  counted: number;
}
export interface ReferenceItem {
  target: string;
  name: string;
  scope: "individual" | "household";
  referenceOre: number;
  excluded: boolean;
  basis: string;
  kpi: string | null;
  /** The reference over each window: as published, or moved by KPI when asked. */
  reference12Ore: number;
  reference3Ore: number;
  kpiAdjustment: { code: string; name: string; changePct: number; month: string; base: { from: string; to: string } } | null;
  actual12Ore: number | null;
  actual3Ore: number | null;
  diff12: ReferenceDiff;
  diff3: ReferenceDiff;
  sources: string[];
}
export interface ReferenceSum {
  referenceOre: number;
  reference12Ore: number;
  reference3Ore: number;
  actual12Ore: number | null;
  actual3Ore: number | null;
  diff12: ReferenceDiff;
  diff3: ReferenceDiff;
}
export interface ReferenceComparison {
  share: "mine" | "household";
  year: number;
  fallback: { wanted: number; direction: "earlier" | "later" } | null;
  source: { title: string; url: string };
  persons: { name: string; ageGroup: string; food: string; age: number | null }[];
  excluded: { key: string; name: string }[];
  months12: ReferenceWindow;
  months3: ReferenceWindow;
  items: ReferenceItem[];
  kpi: { on: boolean; base: { kind: "year"; year: number } | { kind: "month"; month: string }; adjusted: number; unadjusted: string[]; reason: string | null };
  groceries: ReferenceSum & { targets: string[] };
  total: ReferenceSum;
  notIncluded: { actual12Ore: number | null; actual3Ore: number | null };
  unmapped: { path: string; actual12Ore: number | null }[];
  series: { month: string; rolling12: Record<string, number | null>; rolling3: Record<string, number | null>; reference12: number }[];
}
export type ReferenceComparisonResponse =
  | { status: "ready"; through: string; share: "mine" | "household"; comparison: ReferenceComparison; due: { year: number; latest: number } | null }
  | { status: "no_year" | "no_household"; message: string; through: string; share: "mine" | "household" };

export interface ReferenceMapping {
  categories: { categoryId: number; path: string; parentId: number | null; target: string | null; kind: "item" | "not_included" | "not_spending" | "unmapped" }[];
  expenses: { recurringExpenseId: number; name: string; target: string }[];
  targets: { key: string; name: string }[];
}

/** Att fylla i: one thing typed in by hand, where it comes from and how old it is. */
export type ManualDataStatus = "overdue" | "never" | "soon" | "ok" | "info";
export interface ManualDataItem {
  key: string;
  group: string;
  title: string;
  /** Where the figure is found in real life. */
  source: string;
  input: "upload" | "amount" | "form" | "fetch" | "login" | "click" | "file";
  cadence: string;
  /** The day the figure is true for; a month or a year for some. */
  asOf: string | null;
  ageDays: number | null;
  /** The day it was typed or uploaded; null when not recorded. */
  enteredOn: string | null;
  status: ManualDataStatus;
  note: string;
  link: { view: "overview" | "imports" | "commute" | "salary" | "shared" | "analysis" | "settings"; search?: string; anchor?: string; editBalance?: number };
}

/** Att göra: one thing to act on, dismissable for the day by id. */
export interface OverviewTask {
  id: string;
  kind: "invoice_due" | "salary_late" | "stale_balance" | "invoice_missing" | "review" | "amount_changed" | "fuel_shifts" | "bank" | "watch" | "salary" | "reference_budget" | "backup";
  text: string;
  accountId?: number;
  statementId?: number;
  count?: number;
  items?: { expenseId: number; name: string; amount: number; latest?: number }[];
  /** Vakt: the finding behind the task. */
  finding?: WatchFinding;
  /** Lön: open the view, or acknowledge new values from a payslip. */
  salary?: { action: "open" | "ack"; month?: string };
}

export type WatchKind =
  | "price_drift"
  | "double_charge"
  | "unusual_amount"
  | "new_merchant"
  | "missed_charge"
  | "subscription_stopped"
  | "yearly_renewal"
  | "charge_coming"
  // Sparandet
  | "bet_zone_over"
  | "prices_stale"
  | "fx_missing"
  | "buffer_low"
  | "pension_stale"
  | "pension_forecast_stale"
  // Prylar
  | "warranty_ending"
  | "return_deadline"
  | "maybe_item"
  | "isk_allowance"
  | "tax_return_missing";

/** Something Vakt found (see server/src/watch/watch.ts). Amounts in öre, positive. */
export interface WatchFinding {
  key: string;
  kind: WatchKind;
  text: string;
  date: string;
  accountId?: number | null;
  transactionId?: number;
  otherTransactionId?: number;
  expenseId?: number;
  period?: string;
  series?: string;
  oldAmount?: number;
  newAmount?: number;
  amount?: number;
  merchant?: string;
  /** A yearly expense's. */
  yearly?: boolean;
  /** Yearly renewal paid by invoice (not drawn by itself). */
  invoice?: boolean;
  /** Prylar: the thing a warranty or a return deadline is about. */
  itemId?: number;
}

export interface WatchSettings {
  kinds: Record<WatchKind, boolean>;
  labels: Record<WatchKind, string>;
  /** Price series not watched ('Varierar – fråga inte'). */
  muted: { series: string; name: string }[];
}

/** 'YYYY-MM-DD' -> '24/9'. */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
}

// ---------- Pendling & bränsle ----------

export interface FuelSettings {
  kmPerShift: number;
  otherKmPerMonth: number;
  baseConsumption: number;
  /** Öre per shift. */
  congestionPerShift: number;
  useCalibrated: boolean;
  categoryId: number | null;
  /** The category counted as fuel (categoryId, or Bil › Drivmedel). */
  fuelCategoryId: number | null;
}

/** Öre per litre. */
export interface FuelPrice {
  id: number;
  date: string;
  price: number;
}

export interface FuelMonth {
  month: string;
  shifts: number | null;
  km: number | null;
  spent: number;
  trips: number;
  /** Average paid in the month (by litres), else the price at month end. */
  price: FuelPrice | null;
  litres: number | null;
  /** How many of the month's counted fill-ups have a receipt with litres on it. */
  receipts: number;
  /** All of them do, so the litres are read rather than reckoned. */
  litresExact: boolean;
  /** Only a price entered after the purchases: the litres are a guess, and the month isn't calibrated on. */
  priceLater: boolean;
  orePerKm: number | null;
  l100: number | null;
  perShift: number | null;
}

/** The price a forecast reckons with, and why that one. */
export interface ForecastPrice {
  price: number;
  date: string;
  source: "own" | "national";
  why: string;
}

export interface FuelForecast {
  month: string;
  shifts: number;
  km: number;
  consumption: number;
  consumptionSource: "calibrated" | "base";
  price: ForecastPrice;
  expectedFuel: number;
  expectedCongestion: number;
  spent: number;
  remaining: number;
  perShift: number;
}

export interface FuelCalibration {
  l100: number;
  months: string[];
  min: number;
  max: number;
  /** How many of those months had their litres off receipts. */
  exactMonths: number;
}

/** En tankning som den står på kvittot. Liter i hundradelar, pengar i öre. */
export interface FuelFill {
  id: number;
  transactionId: number | null;
  date: string;
  litresE2: number;
  listPriceOre: number;
  discountOre: number;
  amountOre: number;
  station: string | null;
  note: string | null;
}

/** A fuel purchase with no receipt entered for it yet. */
export interface FuelFillMissing {
  id: number;
  date: string;
  amountOre: number;
  description: string;
}

export interface OdometerReading {
  id: number;
  date: string;
  km: number;
}

export interface FuelOverview {
  today: string;
  settings: FuelSettings;
  latestPrice: (FuelPrice & { ageDays: number }) | null;
  prices: FuelPrice[];
  current: FuelForecast | null;
  missing: "shifts" | "price" | "category" | null;
  next: FuelForecast | null;
  purchases: { id: number; date: string; description: string; amount: number; trip: boolean }[];
  /** Newest first, from two months ahead to a year back. */
  months: FuelMonth[];
  calibration: FuelCalibration | null;
  readings: OdometerReading[];
  odometer: {
    from: OdometerReading;
    to: OdometerReading;
    actualKm: number;
    modelKm: number | null;
    missing: string[];
    deviation: number | null;
    suggestedOtherKm: number | null;
  } | null;
}


/** Pendling › Reseavdrag (GET /fuel/deduction). Öre. */
export interface CommuteDeduction {
  settings: { ratePerMil: number; thresholds: Record<string, number>; marginalTax: number };
  oneWayKm: number;
  conditions: { minOneWayKm: number; minTimeSavedHours: number };
  years: {
    year: string;
    shifts: number;
    milPerShift: number;
    gross: number;
    threshold: number;
    thresholdYear: string | null;
    deductible: number;
    taxEffect: number;
    shiftsToThreshold: number;
    months: { month: string; shifts: number; days: string[] }[];
  }[];
  /** 2.1 from the tax returns, per year that has it. */
  declared: { year: string; amount: number }[];
  /** Last year: as declared against the model on that year's shifts (either may be missing). */
  backtest: { year: string; declared: number | null; computed: number | null; shifts: number; months: number; diff: number | null };
  /** This year's likely deduction: the shifts filled in and the months after this one at the average. */
  forecast: {
    year: string;
    declareYear: string;
    shifts: number;
    perMonth: number;
    monthsEstimated: number;
    gross: number;
    deductible: number;
    taxEffect: number;
  } | null;
}

// ---------- Sparande ----------

export interface SavingsMonth {
  month: string;
  deposited: number;
  withdrawn: number;
  /** Deposited − withdrawn: negative when more was taken out than put in. */
  net: number;
  income: number;
  /** net / income, or null without income. */
  rate: number | null;
}

export interface SavingsHolding {
  id: number;
  name: string;
  values: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
}

export interface SavingsPoint {
  date: string;
  value: number;
  /** Put in since the value before (null for the first). */
  deposited: number | null;
  change: number | null;
  return: number | null;
}

/** GET /api/savings/real: the ISK in today's money (KPI), and the buffer's interest against prices. Öre; rates as fractions. */
export interface RealSavings {
  /** The newest month KPI reaches ('YYYY-MM'). */
  kpiMonth: string | null;
  /** valueOre is Avanza's value (grossOre) less the credit's debt that day (debtOre, 0 or less). */
  points: { date: string; valueOre: number; grossOre: number; debtOre: number; source: "entered" | "computed" | "today"; keepOre: number | null }[];
  totals: {
    since: string;
    until: string;
    startOre: number;
    endOre: number;
    netOre: number;
    deposited: number;
    withdrawn: number;
    netTodayOre: number | null;
    nominalGainOre: number;
    realGainOre: number | null;
    inflationOre: number | null;
    nominal: number | null;
    inflation: number | null;
    real: number | null;
    /** The ISK tax for the span (each year's by its share), paid through the final tax: not in the value. */
    iskTaxOre: number | null;
    realGainAfterTaxOre: number | null;
    /** Interest paid on the credit over the span, from Avanza's statements: already in the value. */
    creditInterestOre: number | null;
  } | null;
  periods: { from: string; to: string; startOre: number; netOre: number; endOre: number; nominal: number | null; inflation: number | null; real: number | null; ongoing: boolean }[];
  years: { year: number; nominal: number | null; inflation: number | null; real: number | null; iskTaxOre: number | null; iskTaxEstimated: boolean }[];
  buffer: {
    accountId: number;
    name: string;
    balanceOre: number;
    inflation12: { from: string; to: string; change: number } | null;
    years: { year: number; averageOre: number; interestOre: number; rate: number | null; inflation: number | null; real: number | null; lostOre: number | null }[];
  } | null;
  /** Avanza's kontobesked read in; coverage is the days the ISK's cover. */
  avanza: { coverage: { from: string; to: string } | null; statements: AvanzaStatement[] } | null;
}

/** One of Avanza's kontobesked read in: only its kind, period and sums are kept. Öre. */
export interface AvanzaStatement {
  id: number;
  account: "isk" | "credit";
  periodFrom: string;
  periodTo: string;
  openingOre: number;
  closingOre: number;
  movements: number;
  depositedOre: number;
  withdrawnOre: number;
}

/** Reads Avanza's kontobesked (PDF) for the ISK and its credit account; all or none. */
export async function uploadAvanzaStatements(files: File[]): Promise<AvanzaStatement[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await fetch("/api/savings/avanza-statements", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`);
  return body as AvanzaStatement[];
}

export interface SavingsOverview {
  categoryId: number | null;
  months: SavingsMonth[];
  total: Omit<SavingsMonth, "month">;
  allTime: { since: string; net: number } | null;
  holdings: SavingsHolding[];
  portfolio: {
    since: string;
    startValue: number;
    date: string;
    value: number;
    deposited: number;
    change: number;
    return: number;
    returnRate: number | null;
    /** Put in after the latest value: not in it yet. */
    depositedSinceValue: number;
    points: SavingsPoint[];
  } | null;
}

// ---------- Bankkopplingar (Enable Banking) ----------

export interface BankAccountLink {
  id: number;
  maskedRef: string | null;
  product: string | null;
  accountId: number | null;
  accountName: string | null;
  lastBookingDate: string | null;
  lastSyncAt: string | null;
  /** Pending (reserved) rows from the last sync: never in sums. */
  pending: { count: number; amount: number };
}

export interface BankConnection {
  id: number;
  bank: string;
  status: "active" | "expired" | "revoked" | "error" | "pending";
  validUntil: string | null;
  daysLeft: number | null;
  expiresSoon: boolean;
  authorizedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  accounts: BankAccountLink[];
}

export interface BankStatus {
  configured: boolean;
  syncing: boolean;
  /** The scheduled syncs' hours, Swedish time: [6, 12, 18]. */
  syncHours: number[];
  banks: string[];
  connections: BankConnection[];
}

export interface BankSyncAccount {
  bankAccountId: number;
  maskedRef: string | null;
  accountId: number | null;
  accountName: string | null;
  from: string | null;
  pages: number;
  fetched: number;
  booked: number;
  pending: number;
  other: number;
  rowsNew: number;
  rowsLinked: number;
  rowsSkipped: number;
  transfersPaired: number;
  balance: { amount: number; type: string } | null;
  error: string | null;
}

export interface BankSyncReport {
  at: string;
  dryRun: boolean;
  connections: { id: number; bank: string; status: string; error: string | null; accounts: BankSyncAccount[] }[];
}

/** 'Swedbank ••1234: 3 nya' … for a toast. */
export function syncSummary(r: BankSyncReport): string {
  const parts = r.connections.flatMap((c) =>
    c.accounts.map((a) => `${a.accountName ?? `${c.bank} ${a.maskedRef ?? ""}`}: ${a.error ? "fel" : `${a.rowsNew} nya${a.rowsLinked ? `, ${a.rowsLinked} länkade` : ""}`}`),
  );
  return parts.length ? parts.join(" · ") : "Inga kopplade konton att synka.";
}

// ---------- Kassaflöde ----------

export interface CashEvent {
  date: string;
  kind: "income" | "fixed" | "invoice" | "planned" | "partner";
  name: string;
  /** Öre, signed: negative = out. */
  amount: number;
  estimate?: boolean;
  plannedId?: number;
  /** A card invoice: the part of it that is the card's likely spending still to come in its period (öre, positive). */
  paced?: number;
  /** The tax refund (or kvarskatt) for this income year; its arithmetic is at /tax/refund/<year>. */
  taxRefundYear?: number;
}

/** When a planned item leaves the bank (a card purchase: its invoice's pay day), and a shared one's half back. */
export interface PlannedPayment {
  payDate: string;
  /** Paid with a card: its name. */
  card: string | null;
  /** Shared: the partner's half (öre, positive) and the day it comes back. */
  partnerHalf: number;
  partnerDate: string | null;
}

/** Har jag råd?: GET /afford. */
export type AffordVerdict = "green" | "yellow" | "red";
export interface AffordFigures {
  lowest: { date: string; balance: number };
  /** The last day of the 90: where it lands. */
  end: { date: string; balance: number };
  safeToSpend: number;
  bufferMonths: number | null;
  withSavingsMonths: number | null;
}
export interface Affordability {
  input: { amount: number; date: string; accountId: number | null; shared: boolean; funding: "cash" | "savings"; partner: boolean };
  payment: PlannedPayment;
  netCost: number;
  before: AffordFigures;
  after: AffordFigures;
  verdict: AffordVerdict;
  headline: string;
  reasons: string[];
  waitUntil: string | null;
  salary: { date: string; amount: number; name: string; forecast: boolean } | null;
  alternative: { funding: "savings"; verdict: AffordVerdict; withSavingsMonths: number | null } | null;
  limits: { buffer: number; redBelowMonths: number };
  horizon: string;
  /** Kvar vid månadsskiftet, without and with the purchase. */
  monthStarts: { date: string; month: string; before: number; after: number }[];
}

export interface PlannedItem extends PlannedPayment {
  id: number;
  /** The day of the purchase (or income). */
  date: string;
  amount: number;
  description: string;
  /** Paid with: null is the bank. */
  accountId: number | null;
  shared: boolean;
}

/** GET /cashflow: the bank accounts day by day, 90 days ahead (öre). */
export interface Cashflow {
  today: string;
  horizon: string;
  partner: boolean;
  partnerName: string;
  start: number;
  accounts: { id: number; name: string; balance: number; updatedAt: string | null }[];
  /** In `start`: the cash on Avanza, entered per account plus what was moved there since. */
  liquid: { accounts: { account: TradeAccount; name: string; ore: number; date: string }[]; depositedOre: number; since: string | null; totalOre: number };
  buffer: number;
  days: { date: string; balance: number; variable: number; events: CashEvent[] }[];
  events: CashEvent[];
  lowest: { date: string; balance: number };
  safeToSpend: number;
  /** perDay is the pace counted (only the food with foodOnly); fullPerDay all the variable spending. */
  variable: {
    perDay: number;
    total: number;
    fuel: number | null;
    fullPerDay: number;
    /** Drawn from the bank day by day; the cards' shares go with their invoices. */
    bankPerDay: number;
    cards: { accountId: number; name: string; perDay: number }[];
  };
  /** Räkna bara med mat: the pace is the food only (the fuel, the invoices and the fixed are always counted). */
  foodOnly: boolean;
  planned: PlannedItem[];
}

/** GET /digest: the week that went, as sent on Sundays (Markdown lines). */
export interface Digest {
  from: string;
  to: string;
  title: string;
  lines: string[];
  markdown: string;
  spent: number;
  average: number;
  largest: { name: string; date: string; amount: number }[];
  coming: { name: string; date: string; amount: number }[];
  comingTotal: number;
  review: number;
  safeToSpend: number;
  lowest: { date: string; balance: number };
  sentAt: string | null;
  canSend: boolean;
}

/** Fasta utgifter › Uppskattat (GET /recurring-expenses/estimates). Öre per month. */
export interface ExpenseEstimates {
  /** The average of the last six salaries that came in (net), or null without any. */
  salary: { average: number; count: number; from: string; to: string } | null;
  /** The entered amount, else the average (Livsmedel, Restaurang & café, Hämtmat). */
  food: { amount: number | null; mine: number | null; source: "entered" | "average" | null; average: EstimateAverage };
  fuel: { amount: number | null; mine: number | null; source: "forecast" | "average" | null; shifts: number | null; average: EstimateAverage };
}
export interface EstimateAverage {
  from: string;
  to: string;
  household: number;
  mine: number;
  mineShare: number;
}

// ---------- Lön ----------

export interface SalarySettings {
  lagMonths: 0 | 1;
  lagSource: string;
  lagManual?: boolean;
  payDay: number;
  fullTimeHours: number;
  taxTable: number;
  taxColumn: number;
  taxYear: number | null;
  shiftHours: number;
  /** The agreement's OB per level (the löneart '150'), from each work month; öre per hour. */
  obLevels: Record<string, { name: string; rates: { from: string; rate: number }[] }>;
  /** Hours over these in a shift or a week are overtime; null = no such rule. */
  shiftLimit: number | null;
  weekLimit: number | null;
  /** Overtime when the quarter's hours pass full time on average. */
  quarterOvertime: boolean;
  /** Days before a month its work schedule is due; null = no deadline shown. */
  scheduleNoticeDays: number | null;
  /** Vacation hours to save to the next vacation year, by its last work month ('2027-03'). */
  vacationSave: Record<string, number>;
}

/** The vacation left at the vacation year's end (31 March), paid out in money. Öre; hours as decimals. */
export interface VacationPayout {
  workMonth: string;
  payDate: string;
  source: string;
  sourceMonth: string;
  remaining: number;
  planned: number;
  save: number;
  hours: number;
  rate: number | null;
  amount: number;
  savedEarlier: number | null;
}

export interface SalaryConstants {
  id: number;
  validFrom: string;
  monthlySalary: number;
  industrySupplement: number;
  salarySupplement: number;
  hoursPerMonth: number;
  fullTimeHours: number;
  mertidRate: number;
  vacationHourlyRate: number | null;
  sources: Record<string, string>;
  baseHourlyRate: number;
  employmentRate: number;
}

export interface BacktestRow {
  payDate: string;
  name: string;
  workMonth: string | null;
  hours: number | null;
  actual: { gross: number; tax: number; net: number };
  model: { gross: number; tax: number; net: number } | null;
  diff: number | null;
  grossDiff?: number;
  taxCheck: { tax: number; diff: number; source: string };
  explained: { what: string; amount: number }[];
  note: string | null;
}

/** GET /salary: Inställningar › Lön. Öre; hours as decimals. */
/** Lön › Årsinkomst: a year's salary (the declared 1.1, twelve payslips, or this year's forecast) and its change. */
export interface AnnualIncomeYear {
  year: number;
  amount: number | null;
  source: "declared" | "payslips" | "forecast" | null;
  declared: number | null;
  payslips: number | null;
  /** Fractions; `real` only with KPI for both years. */
  change: { nominal: number; real: number | null } | null;
  kpi: number | null;
}

/** This year: paid so far, the months entered, the months left at the average, and the span. */
export interface AnnualIncomeCurrent {
  year: number;
  paid: number;
  paidMonths: number;
  forecast: number;
  forecastMonths: number;
  estimated: number;
  remainingMonths: number;
  average: number | null;
  deviation: number;
  expected: number;
  low: number;
  high: number;
}

export interface AnnualIncome {
  years: AnnualIncomeYear[];
  current: AnnualIncomeCurrent;
}

export interface SalaryOverview {
  today: string;
  settings: SalarySettings;
  constants: SalaryConstants[];
  obRates: Record<string, { name: string; rate: number; source: string; month?: string }>;
  payslips: { id: number; payDate: string; name: string; workMonth: string | null; gross: number; tax: number; net: number; hoursWorked: number | null; salaryGroup: string | null; codes: string[] }[];
  taxYears: number[];
  curve: { points: { payDate: string; gross: number; tax: number; rate: number }[]; min: number | null; max: number | null };
  backtest: BacktestRow[];
  /** Pendling's shifts per month. */
  shifts: Record<string, number>;
  /** Months with days marked in Pendling: the overtime per shift/week they give. */
  overtimeFromDays: Record<string, WeekOvertimeResult>;
  /** Null without a balance from a payslip, or once the payslip that pays it is in. */
  vacationPayout: VacationPayout | null;
  /**
   * 'Snitt 12 mån': the last twelve salaries that came in (net, by pay month),
   * as Fasta utgifter's usual salary over six; the gross from the payslips,
   * else the forecasts. Null before any has come in.
   */
  average: { average: number; gross: number | null; count: number; from: string; to: string } | null;
  /** New values from a payslip not yet looked at ('Visa' in Att göra acks them). */
  pendingChanges: { month: string; changes: { field: string; from: number | null; to: number | null }[] }[];
}

export interface WeekOvertimeResult {
  hours: number;
  /** The weeks over the week limit. */
  weeks: { from: string; to: string; shifts: number; hours: number; over: number }[];
}

export interface SalaryModel {
  workMonth: string;
  payDate: string;
  lines: { code: string; name: string; quantity: number | null; unitPrice: number | null; amount: number; unverified?: boolean }[];
  gross: number;
  tax: number;
  taxSource: string;
  net: number;
  thresholds: {
    hoursPerMonth: number;
    fullTimeHours: number;
    mertidRate: number;
    /** The mertid rate plus the 50 % overtime supplement (164). */
    overtimeRate: number;
    /** The quarter passes full time on average. */
    passes: boolean;
    /** Overtime by the month limit: full time on average over the calendar quarter; null when the setting is off. */
    quarter: {
      months: { month: string; hours: number; passHours: number; entered: boolean }[];
      hours: number;
      limit: number;
      over: number;
      /** The hours over less those paid as overtime per shift/week: settled with the quarter's last month. */
      settle: number;
      settlesIn: string;
    } | null;
    next: { at: number; before: number; after: number } | null;
  };
  constantsFrom: string;
}

export interface SalaryMonth {
  month: string;
  hours: number;
  vacationHours: number;
  atfHours: number;
  overtimePassHours: number;
  obHours: Record<string, number>;
  hoursMode: "manual" | "shifts";
  /** Pendling's shifts for the month, and the hours they give (when chosen). */
  shifts: number | null;
  hoursFromShifts: number | null;
  effectiveHours: number;
  /** From the days marked in Pendling, when the hours come from the shifts. */
  overtimeFromDays: WeekOvertimeResult | null;
  effectiveOvertimePassHours: number;
  forecast: SalaryModel | null;
  /** Once paid: what came in, and the difference to the forecast. */
  actual: { bookingDate: string; amount: number } | null;
  diff: number | null;
}

// ---------- Ekonomisk situation ----------

export interface SheetRow {
  key: string;
  name: string;
  /** Öre, positive on both sides: the list it is in says which side. */
  amountOre: number;
  basis: string;
  asOf: string | null;
  /** Nothing known. The amount is 0 and must not be read as one. */
  unknown: boolean;
  /** A card's debt by the day it leaves the bank, soonest first. */
  payments?: { payDate: string; amountOre: number }[];
}

export interface BalanceSheet {
  on: string;
  liquid: SheetRow[];
  debts: SheetRow[];
  csn: SheetRow | null;
  illiquid: SheetRow[];
  totals: {
    /** Pengar totalt: bank accounts, ISK securities and cash (not what the partner owes, not debts). */
    moneyOre: number;
    liquidOre: number;
    debtsOre: number;
    csnOre: number;
    illiquidOre: number;
    netExCsnOre: number;
    netIncCsnOre: number;
    netExCsnWithIlliquidOre: number;
    netIncCsnWithIlliquidOre: number;
  };
  notes: string[];
  /** Framåt: Pengar totalt over the coming salary cycle, by what comes in and goes out of the bank. */
  ahead?: {
    from: string;
    to: string;
    startOre: number;
    items: Pick<CashEvent, "date" | "kind" | "name" | "amount" | "estimate" | "paced" | "taxRefundYear">[];
    endOre: number;
    salaries: string[];
    /** A tax refund (or kvarskatt) further off than the cycle (öre). */
    later?: { incomeYear: number; payDate: string; amount: number }[];
  };
}

/** A figure kept by hand, with what it is worth today. */
export interface ManualBalance {
  id: number;
  key: string;
  kind: "asset" | "debt";
  name: string;
  /** The anchor: what was true on `valueDate`. */
  amountOre: number;
  valueDate: string;
  liquid: boolean;
  recurringExpenseId: number | null;
  source: string | null;
  note: string | null;
  /** The anchor less what the charges have paid off since. */
  currentOre: number;
  paidOre: number;
  charges: number;
  lastChargeDate: string | null;
}

/** Uthållighet: hur länge pengarna räcker om inkomsten upphör. */
export interface EnduranceLevel {
  months: number | null;
  /** Why there is no number, when there isn't one. */
  missing: string | null;
  /** The arithmetic, spelled out in Swedish. */
  formula: string;
  akassaMonths?: number;
}

export interface Akassa {
  grossOre: number;
  payslips: number;
  qualifyingOre: number;
  cappedByCeiling: boolean;
  taxRate: number;
  taxFromPayslips: boolean;
  steps: { days: number; rate: number; monthlyNetOre: number }[];
  totalDays: number;
  months: number;
}

/** The three levels at one rate of spending. */
export interface EnduranceLevels {
  monthlyOre: number;
  buffer: EnduranceLevel;
  withSavings: EnduranceLevel;
  withAkassa: EnduranceLevel;
}

export interface Endurance {
  on: string;
  cost: {
    variableOre: number;
    fixedOre: number;
    totalOre: number;
    from: string;
    to: string;
    months: number;
    fixedCount: number;
    /** Kept out of the average when there is a forecast to speak for it. */
    fuel: { ore: number; source: "forecast" | "spending"; shifts: number | null };
    groceriesOre: number;
    /** Fixed expenses and groceries, nothing else. */
    essentialsOre: number;
  };
  /** portfolioOre is the securities only; the cash on the trade accounts counts as buffer. */
  capital: {
    bufferOre: number;
    bufferAccount: { id: number; name: string } | null;
    cash: { account: TradeAccount; name: string; ore: number; date: string }[];
    deposited: { ore: number; since: string | null };
    cashOre: number;
    portfolioOre: number;
  };
  akassa: Akassa | null;
  /** At the rate of the last three months. */
  current: EnduranceLevels;
  /** What would still have to be paid if the income stopped. */
  essential: EnduranceLevels;
}

export interface AkassaSettings {
  incomeCapOre: number;
  daysPerMonth: number;
  steps: { days: number; rate: number }[];
  /** Null: the rate the payslips actually show. */
  taxRate: number | null;
  incomeMonths: number;
}

export interface NetworthSettings {
  akassa: AkassaSettings;
  bufferAccount: { id: number; name: string } | null;
  payslipTaxRate: number | null;
  pension: { incomeBaseAmounts: IncomeBaseAmount[]; incomeMonths: number };
}

/** Flöde per månad: vad som kom in, vad som gick ut, och vart resten tog vägen. */
export interface MonthFlow {
  month: string;
  incomeOre: number;
  fixedOre: number;
  variableOre: number;
  leftOre: number;
  fixedShareOfIncome: number | null;
}

export interface CsnProgress {
  anchorOre: number;
  anchorDate: string;
  remainingOre: number;
  paidSinceAnchorOre: number;
  paidThisYearOre: number;
  chargesThisYear: number;
  rateOre: number | null;
  monthsLeft: number | null;
  payoffMonth: string | null;
}

export interface Flow {
  from: string;
  to: string;
  months: number;
  perMonth: { incomeOre: number; fixedOre: number; variableOre: number; leftOre: number };
  /** Already netted off the variable figure; written out so the two views reconcile. */
  refundsOre: number;
  fixedShareOfIncome: number | null;
  savingsRate: number | null;
  destinations: {
    portfolioOre: number;
    bufferOre: number;
    bufferAccount: { id: number; name: string } | null;
    /** Negative: more was put aside than was left over, so the accounts shrank. */
    unexplainedOre: number;
  };
  monthly: MonthFlow[];
  csn: CsnProgress | null;
}

/** Långsiktigt: pensionen, låst till 65+. Skrivs av för hand, hämtas aldrig. */
export type PensionKind = "income_pension" | "premium_pension" | "occupational" | "private";
export type FundRegion = "global" | "sweden" | "usa" | "other";

export interface PensionFund {
  id: number;
  entryId: number;
  fundName: string;
  amountOre: number;
  /** Ten-thousandths of a unit, and the unit price in öre. */
  unitsE4: number;
  navOre: number;
  valueDate: string;
  /** Ten-thousandths of a percent: 0,12 % is 1200. */
  feePctE4: number | null;
  region: FundRegion;
}

export interface PensionEntry {
  id: number;
  kind: PensionKind;
  provider: string;
  name: string;
  amountOre: number;
  valueDate: string;
  placeable: boolean;
  status: "active" | "closed";
  monthlyPremiumOre: number | null;
  premiumDate: string | null;
  payoutFromAge: number | null;
  note: string | null;
  funds: PensionFund[];
}

export interface PensionOverview {
  entries: PensionEntry[];
  totalOre: number;
  placeableOre: number;
  fixedOre: number;
  /** What is paid in a month. No assumed return anywhere. */
  monthlyPremiumOre: number;
  regions: { region: FundRegion; amountOre: number; share: number }[];
  oldestValueDate: string | null;
  oldestMonths: number | null;
  stale: { id: number; name: string; valueDate: string }[];
  /** Neutral observations about the mix, never warnings. */
  notes: string[];
  /** What the salary sets aside each month (null: no payslip to work it out from). */
  inflow: PensionInflow | null;
  /** Årsbeskeden entered, each beside the tool's own figure for the year. */
  statements: PensionStatementCheck[];
  /** minPension's forecasts, the newest per retirement age. */
  forecasts: {
    latest: PensionForecast[];
    stale: { madeOn: string; monthsOld: number } | null;
  };
}

export interface PensionForecast {
  id: number;
  madeOn: string;
  retirementAge: number;
  /** Before tax, a month. */
  monthlyPensionOre: number;
  assumptions: string;
  note: string | null;
  createdAt: string;
  monthsOld: number;
}

export interface PensionStatementFigures {
  pensionableIncomeOre: number;
  incomePensionRightOre: number;
  premiumPensionRightOre: number;
}

export interface PensionStatementCheck {
  statement: PensionStatementFigures & { id: number; year: number; source: "orange_envelope"; enteredAt: string };
  computed: (PensionStatementFigures & { year: number; payslips: number; grossOre: number; capped: boolean; baseAmount: IncomeBaseAmount }) | null;
  diff: PensionStatementFigures | null;
  /** The salary declared for the year (1.1), the PGI it gives (× 0,93, capped) and the envelope's PGI less that; null without a return. */
  declared: { employmentIncomeOre: number; pensionableIncomeOre: number; diffOre: number } | null;
}

export interface IncomeBaseAmount {
  year: number;
  amountOre: number;
  source: string;
}

export interface PensionInflow {
  grossOre: number;
  payslips: number;
  from: string;
  to: string;
  baseAmount: IncomeBaseAmount;
  forYear: number;
  capOre: number;
  capped: boolean;
  pensionableOre: number;
  incomePensionOre: number;
  premiumPensionOre: number;
  safLoOre: number;
  totalOre: number;
  safLoLatest: { amountOre: number; date: string | null } | null;
  premiumFunds: string[];
}

export const REGION_NAMES: Record<FundRegion, string> = { global: "Global", sweden: "Sverige", usa: "USA", other: "Annat" };

/** Historik: nettoförmögenheten månad för månad. */
export interface NetworthSnapshot {
  month: string;
  date: string;
  accountsOre: number;
  securitiesOre: number;
  cashOre: number;
  partnerOre: number;
  cardsOre: number;
  otherDebtOre: number;
  csnOre: number;
  illiquidOre: number;
  netExCsnOre: number;
  netIncCsnOre: number;
  /** Worked out backwards rather than recorded at the time. */
  estimated: boolean;
  note: string | null;
}

export interface NetworthHistory {
  months: NetworthSnapshot[];
  /** Today, to end the line on. Not stored: the month isn't over. */
  today: { month: string; date: string; netExCsnOre: number; netIncCsnOre: number; illiquidOre: number };
  earliest: string | null;
  /** Why the line doesn't start earlier, when it can't. */
  missing: string | null;
}

/** GET /api/overview/api-costs: the category API per provider, the last 12 months. */
export interface ApiCosts {
  /** Null: there is no category called API. */
  categoryId: number | null;
  month: string;
  months: { month: string; total: number; byProvider: Record<string, number> }[];
  providers: { name: string; thisMonth: number; year: number }[];
  thisMonth: number;
  year: number;
  averagePerMonth: number;
}

// ---------- Skatt ----------

export interface IskRule {
  year: number;
  /** Basis points (296 = 2,96 %); null until known. */
  rateBp: number | null;
  allowanceOre: number;
  source: string;
}

export interface IskQuarter {
  date: string;
  valueOre: number;
  /** Entered by hand, the tool's own valuation, today's value for a quarter to come, or the first value known (not entered). */
  source: "entered" | "computed" | "today" | "first";
}

export interface IskTax {
  year: number;
  rule: IskRule;
  quarters: IskQuarter[];
  deposits: { ore: number; count: number; through: string };
  capitalBaseOre: number;
  taxableBaseOre: number;
  standardIncomeOre: number | null;
  taxOre: number | null;
  estimated: boolean;
  missing: string[];
}

export interface IskDeclaredYear {
  year: number;
  standardIncomeOre: number;
  rateBp: number | null;
  allowanceOre: number;
  capitalBaseOre: number | null;
  taxOre: number;
}

export interface IskOverview {
  current: IskTax;
  today: { valueOre: number; allowanceOre: number; share: number | null };
  declared: IskDeclaredYear[];
  compared: { year: number; declaredBaseOre: number; ownBaseOre: number; diffOre: number } | null;
}

export interface IskSettings {
  rules: IskRule[];
  quarters: { date: string; valueOre: number }[];
}

/** The final tax as the model works it out (kronor). */
export interface FinalTax {
  ffi: number;
  basicDeduction: number;
  bfi: number;
  municipalTax: number;
  burialFee: number;
  churchFee: number;
  stateTax: number;
  pensionFee: number;
  pensionFeeReduction: number;
  publicService: number;
  workIncome: number;
  jobTaxCredit: number;
  earnedIncomeReduction: number;
  capitalSurplus: number;
  capitalTax: number;
  capitalDeficitReduction: number;
  total: number;
  ki: number;
}

export interface TaxRefundInput {
  value: number;
  from: string;
}

/** Skatteåterbäring (uppskattad) for an income year, in kronor. */
export interface TaxRefund {
  incomeYear: number;
  payDate: string;
  basis: "return" | "forecast";
  input: Record<"salary" | "commuteDeduction" | "iskStandardIncome" | "capitalIncome" | "capitalExpenses", TaxRefundInput>;
  finalTax: FinalTax | null;
  missing: string | null;
  preliminary: { payslips: number; payslipMonths: number; forecast: number; forecastMonths: number; estimated: number; estimatedMonths: number; bank: number; total: number } | null;
  refund: number | null;
  paid: { date: string; amount: number } | null;
  estimated: boolean;
}

export interface TaxYearRules {
  year: number;
  pbbOre: number;
  ibbOre: number;
  stateThresholdOre: number;
  publicServiceIbb: number;
  jobTaxCredit: { lowRate: number; midBase: number; midRate: number; top: number; taper: { fromPbb: number; rate: number } | null };
  source: string;
  municipalPct: number | null;
  regionPct: number | null;
  burialPct: number | null;
  churchPct: number | null;
  ratesSource: string;
}
