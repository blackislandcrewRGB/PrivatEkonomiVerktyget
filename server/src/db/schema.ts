/**
 * Database schema.
 *
 * Conventions:
 * - All money columns are INTEGER in öre (1 SEK = 100 öre) to avoid float rounding.
 *   Negative = money out (expense), positive = money in.
 * - Dates are TEXT 'YYYY-MM-DD'; timestamps are TEXT ISO 8601 (UTC).
 * - Booleans are INTEGER 0/1.
 * - Full card/account numbers are never stored in clear text. Only masked forms
 *   (e.g. '479696******6699', '••1234') and the sha256 fingerprint.
 */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  blob,
  uniqueIndex,
  index,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const PAYMENT_METHODS = ["card", "credit_card", "autogiro", "transfer"] as const;
export const BILLING_CYCLES = ["monthly", "yearly"] as const;
/** Currencies a fixed expense can be priced in (a subscription in euro); none is kronor. */
export const EXPENSE_CURRENCIES = ["EUR", "USD"] as const;
// 'enable_banking': fetched from the bank's API only; 'both': an imported file row the API also returned (linked).
// 'csv': a file from any bank, read with a column mapping the household made (import/csvImport.ts).
export const TRANSACTION_SOURCES = ["swedbank", "norwegian", "mastercard", "csv", "manual", "enable_banking", "both"] as const;
export const IMPORT_SOURCES = ["swedbank", "norwegian", "mastercard", "csv"] as const;
/** What an import can be: a bank's file, a rent notice or a tax return receipt (no rows of their own, see rentNotices and taxReturns). */
export const IMPORT_KINDS = [...IMPORT_SOURCES, "rent_notice", "tax_return"] as const;
/** How an import came in: a file, or a sync with the bank (Enable Banking). */
export const IMPORT_VIA = ["file", "enable_banking"] as const;
export const BANK_CONNECTION_STATUSES = ["pending", "active", "expired", "revoked", "error"] as const;
export const SCHEDULE_TYPES = ["day_of_month", "last_day"] as const;
export const BANK_DAY_RULES = ["none", "next", "previous"] as const;

/** A plan a fixed expense was on before a change (Plus before Pro): up to and including `until` (YYYY-MM). */
export interface PastPlan {
  until: string;
  amount: number;
  foreignAmount: number | null;
  scheduleType: (typeof SCHEDULE_TYPES)[number];
  anchorDay: number | null;
  bankDayRule: (typeof BANK_DAY_RULES)[number];
  name: string | null;
}
export const DATE_BASES = ["transaction", "booking"] as const;
export const CATEGORY_SOURCES = ["rule", "merchant_category", "llm", "manual", "none"] as const;
export const MATCH_TYPES = ["exact", "contains", "regex"] as const;
export const RULE_ORIGINS = ["manual", "llm", "seed"] as const;
export const ACCOUNT_KINDS = ["bank", "credit_card"] as const;
export const RULE_DIRECTIONS = ["any", "in", "out"] as const;
export const STATEMENT_SOURCES = ["manual", "pdf"] as const;
export const PAYERS = ["me", "partner"] as const;
/** Categories the code looks up. They can be renamed but not deleted. */
export const CATEGORY_KEYS = [
  "income", // Inkomst (main category)
  "salary", // Inkomst › Lön
  "from_partner", // Inkomst › Från partner
  "to_partner", // Till partner
  "transfers", // Överföringar & sparande (main category)
  "own_transfer", // Överföringar & sparande › Egna överföringar
  "card_payment", // Överföringar & sparande › Kortbetalning
  "savings", // Överföringar & sparande › Sparande (Analys: Sparande)
  "unknown", // Övrigt › Okänt ('Vet ej')
  "groceries", // Mat › Livsmedel (Analys: Mat)
  "restaurants", // Mat › Restaurang & café (Analys: Mat)
  "takeaway", // Mat › Hämtmat (Analys: Mat)
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, {
      onDelete: "restrict",
    }),
    color: text("color"),
    // Transfers/savings are never counted as expenses in statistics.
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    // Money between me and the partner ('Till partner', 'Från partner'): not an
    // expense or income in statistics or the forecast, only used in the settlement.
    isSettlement: integer("is_settlement", { mode: "boolean" }).notNull().default(false),
    // Categories the code relies on ('income', 'salary', 'unknown', …), so they
    // can be renamed or moved freely. See CATEGORY_KEYS.
    systemKey: text("system_key"),
  },
  (t) => [
    index("categories_parent_idx").on(t.parentId),
    // Sibling names are unique within a parent; top-level names are unique too
    // (needs its own partial index since NULLs never collide in a unique index).
    uniqueIndex("categories_name_parent_uq").on(t.parentId, t.name),
    uniqueIndex("categories_top_name_uq").on(t.name).where(sql`${t.parentId} IS NULL`),
    uniqueIndex("categories_system_key_uq").on(t.systemKey),
  ],
);

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  balance: integer("balance").notNull().default(0),
  balanceUpdatedAt: text("balance_updated_at"),
  note: text("note"),
  // 'credit_card' accounts hold a debt: balance is negative.
  kind: text("kind", { enum: ACCOUNT_KINDS }).notNull().default("bank"),
  // Off: the account has no balance to follow (Bank Norwegian: only the card and its
  // invoices). Not shown, never asked for, and not in the forecast.
  trackBalance: integer("track_balance", { mode: "boolean" }).notNull().default(true),
  // Which import source feeds this account, if any.
  source: text("source", { enum: IMPORT_SOURCES }),
  // Masked account number (e.g. '••1234') the account is bound to. Set the first
  // time a file's rows are imported into this account; later files with the same
  // number map here automatically. Never the full number.
  accountRef: text("account_ref"),
  // Case-insensitive substring of the Swedbank 'Produkt' column used to suggest
  // this account for a not-yet-bound account number (e.g. 'Privatkonto').
  importHint: text("import_hint"),
  // Clearing number (e.g. '80000'). With account_ref it identifies the account
  // as the counterpart of a transfer (Swedbank puts the full number in 'Referens').
  clearing: text("clearing"),
  manuallyEditedAt: text("manually_edited_at"),
});

export const recurringIncome = sqliteTable("recurring_income", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  amount: integer("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Case-insensitive substring of the transaction text, e.g. 'LÖN'.
  matchPattern: text("match_pattern"),
  manuallyEditedAt: text("manually_edited_at"),
});

/**
 * Expected amount for one month of a recurring income ('YYYY-MM'), replacing
 * the estimate (e.g. from the pay slip). An imported salary row for the month
 * wins over both.
 */
export const recurringIncomeOverrides = sqliteTable(
  "recurring_income_overrides",
  {
    recurringIncomeId: integer("recurring_income_id")
      .notNull()
      .references(() => recurringIncome.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recurringIncomeId, t.month] })],
);

export const recurringExpenses = sqliteTable("recurring_expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Stored as a positive number (the monthly/yearly charge).
  amount: integer("amount").notNull(),
  // When it is drawn (see recurring/schedule.ts). 'day_of_month' uses anchor_day
  // (clamped to short months: 30 is 28/2, 31 is always the last day);
  // 'last_day' is the last day of the month. NULL anchor_day = no day known.
  scheduleType: text("schedule_type", { enum: SCHEDULE_TYPES }).notNull().default("day_of_month"),
  anchorDay: integer("anchor_day"),
  // Yearly ones: the month (1–12) of the draw or renewal, with anchor_day its day.
  anchorMonth: integer("anchor_month"),
  // How many days before a charge to ask in Att göra. NULL is the default for
  // the kind of charge it is (14 days for a yearly renewal, 3 for a charge
  // being watched), 0 is never.
  remindDays: integer("remind_days"),
  // A subscription started for a while, that is to be cancelled before it
  // draws again: the Vakt asks before every charge. Yearly ones already ask
  // through yearly_renewal, so this is for the others.
  remindBeforeCharge: integer("remind_before_charge", { mode: "boolean" }).notNull().default(false),
  // Moved to the next/previous Swedish bank day when the day is a weekend or holiday.
  bankDayRule: text("bank_day_rule", { enum: BANK_DAY_RULES }).notNull().default("none"),
  // Which date of a charge is compared with the schedule: card purchases the
  // transaction day, autogiro the booking day.
  dateBasis: text("date_basis", { enum: DATE_BASES }).notNull().default("booking"),
  paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull(),
  // The account the charge is drawn from. Decides which imported transactions it
  // may be matched against (a Mastercard charge never matches a Privatkonto row).
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  // Moved to another account (a new card): the one before, drawn from up to
  // the month before account_from (YYYY-MM, the first period on account_id).
  previousAccountId: integer("previous_account_id").references(() => accounts.id, { onDelete: "set null" }),
  accountFrom: text("account_from"),
  // Case-insensitive substring of the bank's text for this charge, e.g. 'TRE KRONOR'.
  matchPattern: text("match_pattern"),
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  link: text("link"),
  note: text("note"),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  // Paused (cancelled) after a last draw (YYYY-MM): counted, linked and shared
  // up to that period, not after. NULL on a paused one: not counted at all.
  lastPeriod: text("last_period"),
  billingCycle: text("billing_cycle", { enum: BILLING_CYCLES }).notNull().default("monthly"),
  // The service can be paid yearly instead ('FINNS ÅRLIG' in the sheet).
  yearlyAvailable: integer("yearly_available", { mode: "boolean" }).notNull().default(false),
  // End of a binding period ('BUNDET … 2026-10-20'), YYYY-MM-DD.
  boundUntil: text("bound_until"),
  // The name a row was seeded from (databases that were filled from a spreadsheet
  // before that was removed); nothing sets it now.
  seedName: text("seed_name"),
  manuallyEditedAt: text("manually_edited_at"),
  // Drawn together with another expense (Mobilabonnemang in Tele2's charge for
  // Bredband): no charge of its own, it follows that one's day and account,
  // and that charge is split: this one's amount, the rest to the other.
  partOfId: integer("part_of_id").references((): AnySQLiteColumn => recurringExpenses.id, { onDelete: "set null" }),
  // An icon of its own (data/icons/<hash>.<ext>), even without a rule.
  iconPath: text("icon_path"),
  // Priced in another currency (a subscription in euro): the price before VAT
  // in hundredths and the VAT on top, in per cent. `amount` is then worked out
  // from them with the day's rate and the bank's markup (recurring/foreignPrice.ts).
  currency: text("currency", { enum: EXPENSE_CURRENCIES }),
  foreignAmount: integer("foreign_amount"),
  vatPercent: integer("vat_percent"),
  // A new price from a period on (a subscription downgraded, from its next
  // draw): YYYY-MM, the kronor then, and for one priced in a currency its new
  // price before VAT. The periods before keep the price; once a charge for
  // `next_from` or later has come, it becomes the price (recurring/priceChange.ts).
  nextFrom: text("next_from"),
  nextAmount: integer("next_amount"),
  nextForeignAmount: integer("next_foreign_amount"),
  nextPlanName: text("next_plan_name"),
  // The plan it is on now (Plus, Pro): optional, only a label.
  planName: text("plan_name"),
  // The plans it was on before, oldest first, each up to and including `until`
  // (YYYY-MM): price and day, so a period before a plan change keeps its own
  // price and draw day (recurring/plans.ts).
  planHistory: text("plan_history", { mode: "json" }).$type<PastPlan[]>(),
});

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: IMPORT_KINDS }).notNull(),
  filename: text("filename").notNull(),
  periodFrom: text("period_from"),
  periodTo: text("period_to"),
  importedAt: text("imported_at").notNull().default(now),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsNew: integer("rows_new").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  via: text("via", { enum: IMPORT_VIA }).notNull().default("file"),
});

/**
 * Credit card bills: Bank Norwegian from the PDF invoice, Swedbank Mastercard
 * entered by hand each month. Latest per account = current debt and due date.
 */
export const statements = sqliteTable(
  "statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    dueDate: text("due_date").notNull(),
    // Amount to pay / total debt, positive öre.
    amountDue: integer("amount_due").notNull(),
    // The invoice says where the next one ends ('köp gjorda t o m 2026-10-07'), if it does.
    nextPeriodTo: text("next_period_to"),
    minPayment: integer("min_payment"),
    source: text("source", { enum: STATEMENT_SOURCES }).notNull(),
    importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
    note: text("note"),
    // Ticked off by hand. (A matched card payment also makes it paid; that is computed.)
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("statements_account_due_idx").on(t.accountId, t.dueDate)],
);

/**
 * The amount for one month ('YYYY-MM') of a recurring expense that varies by
 * month (e.g. CSN), replacing its usual amount in forecasts, the settlement
 * and the 'amount changed' check.
 */
export const recurringExpenseAmounts = sqliteTable(
  "recurring_expense_amounts",
  {
    recurringExpenseId: integer("recurring_expense_id")
      .notNull()
      .references(() => recurringExpenses.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    // Positive öre.
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recurringExpenseId, t.month] })],
);

/**
 * Rent notices (hyresavier), imported as PDFs a few months at a time. Each
 * belongs to the fixed expense that pays it and sets that expense's amount
 * for the period it is paid in (the month of its due date), so a new rent is
 * counted from the notice rather than from the first charge. The PDF is kept
 * to be opened again.
 */
export const rentNotices = sqliteTable(
  "rent_notices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importId: integer("import_id").references(() => imports.id, { onDelete: "cascade" }),
    recurringExpenseId: integer("recurring_expense_id").references(() => recurringExpenses.id, { onDelete: "set null" }),
    issuer: text("issuer").notNull(),
    // Avinr.
    number: text("number").notNull(),
    noticeDate: text("notice_date"),
    dueDate: text("due_date").notNull(),
    // The month the rent is for, and the expense's period it is paid in (the due date's month).
    rentMonth: text("rent_month").notNull(),
    period: text("period").notNull(),
    // Att betala, positive öre.
    amount: integer("amount").notNull(),
    // JSON [{ text, amount }].
    lines: text("lines").notNull().default("[]"),
    bankgiro: text("bankgiro"),
    // The period's own amount before the notice set it (null: none), put back when the import is undone.
    previousAmount: integer("previous_amount"),
    pdf: blob("pdf", { mode: "buffer" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("rent_notices_number_idx").on(t.issuer, t.number), index("rent_notices_expense_idx").on(t.recurringExpenseId, t.period)],
);

/**
 * The ISK's value at a quarter's start (1/1, 1/4, 1/7, 1/10) as Avanza shows
 * it, entered by hand for the quarters the tool can't value itself (before
 * the holdings were entered). The capital base for the ISK tax is the four
 * quarters' values plus the year's deposits, divided by four. Öre.
 */
export const iskQuarterValues = sqliteTable("isk_quarter_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  valueOre: integer("value_ore").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const AVANZA_ACCOUNTS = ["isk", "credit"] as const;

/**
 * Avanza's kontobesked, read in for Sparande efter inflation: the ISK and the
 * credit account linked to it, a period each. Only the account's kind, the
 * period and the cash balance at its start and end are kept – no names,
 * account numbers or addresses – and the file itself is not. One per account
 * and start: reading the same one again replaces it.
 */
export const avanzaStatements = sqliteTable(
  "avanza_statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account: text("account", { enum: AVANZA_ACCOUNTS }).notNull(),
    periodFrom: text("period_from").notNull(),
    periodTo: text("period_to").notNull(),
    openingOre: integer("opening_ore").notNull(),
    closingOre: integer("closing_ore").notNull(),
    importedAt: text("imported_at").notNull().default(now),
  },
  (t) => [uniqueIndex("avanza_statements_account_from_uq").on(t.account, t.periodFrom)],
);

/**
 * A statement's cash movements in its order: the booking day, the kind as
 * Avanza writes it ('INSÄTTNING', 'UTTAG', 'KREDIT INS', 'KREDITREGL', 'KAP
 * DEB RÄNTA'; a security bought or sold is 'VÄRDEPAPPER', without its name),
 * the amount and the cash balance after it. Öre.
 */
export const avanzaMovements = sqliteTable(
  "avanza_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    statementId: integer("statement_id")
      .notNull()
      .references(() => avanzaStatements.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    date: text("date").notNull(),
    kind: text("kind").notNull(),
    amountOre: integer("amount_ore").notNull(),
    balanceOre: integer("balance_ore").notNull(),
  },
  (t) => [index("avanza_movements_statement_idx").on(t.statementId)],
);

export const TAX_RETURN_SOURCES = ["pdf", "manual"] as const;

/**
 * The income tax return as filed, one row per income year: read from
 * Skatteverket's receipt (Kvittens – Inkomstdeklaration 1) or entered by hand.
 * Only the income year, the day it was sent and five boxes are kept, never the
 * receipt's name, personnummer or number, and never the file. A box the
 * receipt doesn't have is null. Öre.
 */
export const taxReturns = sqliteTable("tax_returns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incomeYear: integer("income_year").notNull().unique(),
  submittedAt: text("submitted_at"),
  // 1.1 Lön, förmåner, sjukpenning m.m.
  employmentIncome: integer("employment_income"),
  // 2.1 Resor till och från arbetet (after the threshold).
  commuteDeduction: integer("commute_deduction"),
  // 7.1 Schablonintäkter (ISK).
  iskStandardIncome: integer("isk_standard_income"),
  // 7.2 Ränteinkomster, utdelningar m.m.
  capitalIncome: integer("capital_income"),
  // 8.1 Ränteutgifter m.m.
  capitalExpenses: integer("capital_expenses"),
  source: text("source", { enum: TAX_RETURN_SOURCES }).notNull(),
  // The receipt's import, for 'Ångra'; null when entered or changed by hand.
  importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
  // JSON of the row a receipt replaced, put back when that import is undone.
  previous: text("previous"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * A recurring expense ticked off as paid for one period ('YYYY-MM', or 'YYYY'
 * for yearly ones): for charges on an account that is never imported. Mastercard
 * was one before its invoices could be imported.
 */
export const recurringExpenseMarks = sqliteTable(
  "recurring_expense_marks",
  {
    recurringExpenseId: integer("recurring_expense_id")
      .notNull()
      .references(() => recurringExpenses.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    // 'paid': ticked off as paid outside the imported accounts. 'skipped': not
    // drawn that period (a subscription paused for a while): nothing expected.
    kind: text("kind", { enum: ["paid", "skipped"] }).notNull().default("paid"),
    markedAt: text("marked_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.recurringExpenseId, t.period] })],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: TRANSACTION_SOURCES }).notNull(),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    bookingDate: text("booking_date").notNull(),
    transactionDate: text("transaction_date"),
    // Card purchases: the day the bank posted it (Bank Norwegian 'BookDate',
    // usually the day after the purchase). It decides which invoice the
    // purchase is on: the invoice 16/8–15/9 has a purchase made 15/8 but posted 16/8.
    postedDate: text("posted_date"),
    descriptionRaw: text("description_raw").notNull(),
    descriptionClean: text("description_clean").notNull(),
    // The user's own name for the row ('Lunch med Erik'). Display only: the
    // bank's description stays the source for fingerprint, rules and grouping.
    label: text("label"),
    counterparty: text("counterparty"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("SEK"),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }).notNull().default("none"),
    // LLM confidence 0..1 when category_source = 'llm'.
    categoryConfidence: real("category_confidence"),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    // Hidden in lists unless 'Visa privata' is on (gifts for the partner). Counted
    // in every sum like any row, but never shared and never in the settlement.
    private: integer("private", { mode: "boolean" }).notNull().default(false),
    // 'partner': a shared expense the partner paid from her own account, entered
    // by hand. Counted in household statistics and the settlement, never in my
    // balances or forecast (no account).
    paidBy: text("paid_by", { enum: PAYERS }).notNull().default("me"),
    // The whole amount belongs to the other person, not the payer: something I
    // paid that is entirely the partner's (she owes all of it), or something
    // she paid that is entirely mine. Never together with shared.
    forOther: integer("for_other", { mode: "boolean" }).notNull().default(false),
    // A Swish between us that is left out of the settlement: it settled something
    // on its own (my half of a shared purchase she paid, swished right away).
    settlementExcluded: integer("settlement_excluded", { mode: "boolean" }).notNull().default(false),
    // A returned purchase and its refunds share this id (the purchase's id): together
    // they cancel out and are left out of every sum and statistic, but stay listed.
    returnGroupId: integer("return_group_id"),
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    // Masked card number for card rows (Bank Norwegian), e.g. '479696******6699'.
    cardMasked: text("card_masked"),
    // Paid in another currency (Mastercard): the original amount (signed like
    // amount, in hundredths), its currency and the bank's rate.
    foreignAmount: integer("foreign_amount"),
    foreignCurrency: text("foreign_currency"),
    exchangeRate: real("exchange_rate"),
    // Bank Norwegian: the bank's merchant category (as exported) and city.
    merchantCategory: text("merchant_category"),
    merchantArea: text("merchant_area"),
    // sha256 over the identifying fields, see import code. Together with
    // occurrence_index this is the dedupe key; Swedbank 'Radnummer' is never used.
    fingerprint: text("fingerprint").notNull(),
    occurrenceIndex: integer("occurrence_index").notNull().default(1),
    importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
    recurringExpenseId: integer("recurring_expense_id").references(() => recurringExpenses.id, {
      onDelete: "set null",
    }),
    recurringIncomeId: integer("recurring_income_id").references(() => recurringIncome.id, { onDelete: "set null" }),
    // Masked counterpart account of a transfer, from Swedbank 'Referens':
    // first five digits (clearing) + last four, e.g. '80000-••5678'. Never the full number.
    counterRef: text("counter_ref"),
    // The counterpart when it is one of my accounts: the row is an internal transfer.
    counterAccountId: integer("counter_account_id").references(() => accounts.id, { onDelete: "set null" }),
    // Both sides of an internal transfer share this id (the lower transaction id).
    transferPairId: integer("transfer_pair_id"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
    // Set whenever the user edits category/shared/note/etc. Undoing an import
    // never deletes rows with manual edits without warning.
    manuallyEditedAt: text("manually_edited_at"),
    // Soft delete for imported rows: excluded from every sum, list and forecast,
    // but the row (and its fingerprint) stays so a re-import never brings it back.
    deletedAt: text("deleted_at"),
    // 'Glömd': deleted and not shown anywhere at all, not even among the deleted
    // rows. The row is kept solely as the memory that stops the next import from
    // fetching it again. Always set together with deleted_at.
    forgottenAt: text("forgotten_at"),
    // Enable Banking: the bank's entry reference and its whole transaction (JSON).
    entryReference: text("entry_reference"),
    bankRaw: text("bank_raw"),
    // 'booking date|amount in öre|description' normalised (see matchKey): finds the
    // same bank transaction whether it came from a file or the API.
    matchKey: text("match_key"),
  },
  (t) => [
    uniqueIndex("transactions_fingerprint_occ_uq").on(t.fingerprint, t.occurrenceIndex),
    index("transactions_booking_date_idx").on(t.bookingDate),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_import_idx").on(t.importId),
    index("transactions_account_idx").on(t.accountId),
    index("transactions_transfer_pair_idx").on(t.transferPairId),
    index("transactions_account_match_idx").on(t.accountId, t.matchKey),
    index("transactions_account_entry_idx").on(t.accountId, t.entryReference),
    // The duplicate search (Att granska, the menu's count) pairs rows on account, day and amount.
    index("transactions_account_day_amount_idx").on(t.accountId, t.transactionDate, t.amount),
    // Fasta utgifter and Översikt read the rows linked to a fixed expense.
    index("transactions_recurring_expense_idx").on(t.recurringExpenseId),
  ],
);

/**
 * One purchase split across several categories: an Amazon order that is partly
 * clothes, partly electronics. The parts always have the transaction's sign and
 * sum to its amount exactly, so no total changes when a row is split. The
 * transaction keeps its own category_id (the largest part), so anything that
 * only reads the column still shows something sensible.
 */
export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    // 'restrict': a category with parts is never deleted from under them; the
    // delete moves them first (see categoryUsage/reassign).
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("transaction_splits_tx_idx").on(t.transactionId), index("transaction_splits_category_idx").on(t.categoryId)],
);

export const merchantRules = sqliteTable(
  "merchant_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pattern: text("pattern").notNull(),
    matchType: text("match_type", { enum: MATCH_TYPES }).notNull().default("contains"),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    // NULL = don't touch the shared flag; true/false = set it.
    sharedDefault: integer("shared_default", { mode: "boolean" }),
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    // For transfers to one of my accounts that the text identifies (e.g. 'Bank Norwegian').
    counterAccountId: integer("counter_account_id").references(() => accounts.id, { onDelete: "set null" }),
    // 'in' = only money in (amount > 0), 'out' = only money out. The same Swish
    // number can mean different things depending on direction.
    direction: text("direction", { enum: RULE_DIRECTIONS }).notNull().default("any"),
    createdFrom: text("created_from", { enum: RULE_ORIGINS }).notNull().default("manual"),
    hits: integer("hits").notNull().default(0),
    // The merchant's icon: a simple-icons slug (see icons/brands.ts), and an
    // uploaded image (data/icons/<hash>.<ext>) that wins over it.
    brandSlug: text("brand_slug"),
    iconPath: text("icon_path"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("merchant_rules_pattern_dir_uq").on(t.matchType, t.pattern, t.direction)],
);

/**
 * Name rules: new imports whose text matches the pattern get this label (the
 * name shown instead of the bank's text), e.g. 'ANTHROPIC* CLAUDE SUB' →
 * 'CLAUDE Abonnemang'. Matched like category rules (merchant text, most
 * specific wins); only rows without a name of their own are touched.
 */
export const labelRules = sqliteTable(
  "label_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pattern: text("pattern").notNull(),
    matchType: text("match_type", { enum: MATCH_TYPES }).notNull().default("contains"),
    label: text("label").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("label_rules_pattern_uq").on(t.matchType, t.pattern)],
);

/** Pendling & bränsle: work shifts per month (the number the forecast uses). */
export const workShifts = sqliteTable("work_shifts", {
  month: text("month").primaryKey(), // YYYY-MM
  shifts: integer("shifts").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/** Optional: the days worked. Marking days sets the month's count to their number. */
export const workShiftDays = sqliteTable("work_shift_days", {
  date: text("date").primaryKey(),
});

/** Diesel price per litre in öre, as entered, with the day it applied. */
export const fuelPrices = sqliteTable("fuel_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  price: integer("price").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * En tankning som den står på kvittot: liter, pumppris och rabatt.
 *
 * The bank only ever says what a fill-up cost. Until now the litres were
 * worked out by dividing that by a price entered by hand, which is a good
 * estimate and nothing more — and it turned out to be a biased one, because
 * the price entered was the pump's list price while the card was charged 25
 * öre a litre less.
 *
 * So a receipt is kept as what it says, and nothing is inferred from it: the
 * litres, the list price per litre, the discount on the fill and the total.
 * The price actually paid is those divided, worked out when needed rather
 * than stored, because a stored figure could disagree with the three it came
 * from.
 *
 * `transaction_id` is the row in the bank, when it is known: one fill-up per
 * transaction. A receipt with no transaction yet is still worth keeping.
 */
export const fuelFills = sqliteTable(
  "fuel_fills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .unique(),
    /** The receipt's own day, which can be the day before the bank's. */
    date: text("date").notNull(),
    /** Hundredths of a litre: 60,44 l = 6044. */
    litresE2: integer("litres_e2").notNull(),
    /** Öre per litre as displayed at the pump, before any discount. */
    listPriceOre: integer("list_price_ore").notNull(),
    /** The discount on the whole fill-up, in öre. */
    discountOre: integer("discount_ore").notNull().default(0),
    /** What was actually charged, in öre. */
    amountOre: integer("amount_ore").notNull(),
    station: text("station"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("fuel_fills_date_idx").on(t.date)],
);

/** Odometer readings, to check the km the model assumes against the km actually driven. */
export const odometerReadings = sqliteTable("odometer_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  km: integer("km").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * A consent at a bank through Enable Banking (PSD2): one per bank. 'pending'
 * while the user is at the bank (state checked on the callback); 'active' with
 * a session until valid_until.
 */
export const bankConnections = sqliteTable("bank_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull().default("SE"),
  status: text("status", { enum: BANK_CONNECTION_STATUSES }).notNull().default("pending"),
  // Random value sent to /auth and checked on the callback; cleared once used.
  state: text("state"),
  sessionId: text("session_id"),
  validUntil: text("valid_until"),
  authorizedAt: text("authorized_at"),
  lastSyncAt: text("last_sync_at"),
  lastError: text("last_error"),
  lastErrorAt: text("last_error_at"),
  createdAt: text("created_at").notNull().default(now),
});

/** An account in a connection (the API's uid) and the account in the app it feeds. */
export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => bankConnections.id, { onDelete: "cascade" }),
    uid: text("uid").notNull(),
    // Null until matched (last four digits against accounts.account_ref) or chosen.
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    // Masked only, e.g. '••1234'.
    maskedRef: text("masked_ref"),
    name: text("name"),
    product: text("product"),
    currency: text("currency"),
    // Latest booking date fetched: the next sync starts 7 days before it.
    lastBookingDate: text("last_booking_date"),
    lastSyncAt: text("last_sync_at"),
  },
  (t) => [uniqueIndex("bank_accounts_connection_uid_uq").on(t.connectionId, t.uid)],
);

/**
 * Pending (PDNG) transactions from the last sync, like Bank Norwegian's
 * 'Reserverat': shown, never in sums. Replaced on every sync; the booked row
 * comes as an ordinary transaction.
 */
export const bankPending = sqliteTable("bank_pending", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bankAccountId: integer("bank_account_id")
    .notNull()
    .references(() => bankAccounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull(),
  raw: text("raw").notNull(),
});

/**
 * Savings held outside the bank accounts (Avanza ISK), valued by hand. Not an
 * account: the money isn't there to live on, so it stays out of balances and
 * the forecast. Money in and out is the category Överföringar & sparande › Sparande.
 */
export const savingsHoldings = sqliteTable("savings_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/** A holding's value (öre) as entered for a date; one per day. */
export const savingsValues = sqliteTable(
  "savings_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => savingsHoldings.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    value: integer("value").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("savings_values_holding_date_uq").on(t.holdingId, t.date)],
);

/**
 * Kassaflöde: a one-off expense or income planned for a day (a trip in
 * November), saved from a scenario. In the 90-day forecast until its day has passed.
 */
export const plannedItems = sqliteTable("planned_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  // Signed like transactions: negative = money out.
  amount: integer("amount").notNull(),
  description: text("description").notNull(),
  // Paid with: null or a bank account on the day; a card on its invoice's pay day.
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  // A shared purchase: the partner's half comes back with her next payment.
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Löneprognos: a payslip as read from the employer's file (Hogia).
 * Never the personal identity number, name, address or employee number; the
 * bank account only masked. Money in öre, hours as decimals.
 */
export const payslips = sqliteTable("payslips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payDate: text("pay_date").notNull().unique(),
  // 'Grundlön avser' (YYYY-MM): the payroll's own month label, the pay month.
  labelMonth: text("label_month"),
  // The month the work was done (the salary lines' period): the pay month − the lag.
  workMonth: text("work_month"),
  gross: integer("gross").notNull(),
  tax: integer("tax").notNull(),
  net: integer("net").notNull(),
  // 'Beräknad på': the whole kronor the tax table was read at.
  taxBasis: integer("tax_basis"),
  taxTable: integer("tax_table"),
  taxColumn: integer("tax_column"),
  category: text("category"),
  salaryGroup: text("salary_group"),
  hoursWorked: real("hours_worked"),
  ytdGross: integer("ytd_gross"),
  ytdTax: integer("ytd_tax"),
  ytdNet: integer("ytd_net"),
  ytdHours: real("ytd_hours"),
  // '*Sem.gr inkomst': this year's income that vacation pay is based on.
  vacationIncomeYtd: integer("vacation_income_ytd"),
  vacationHourlyRate: integer("vacation_hourly_rate"),
  vacationEarned: real("vacation_earned"),
  // 'Semestersaldon': hours taken and left of this vacation year, and saved from earlier ones.
  vacationTaken: real("vacation_taken"),
  vacationRemaining: real("vacation_remaining"),
  vacationSaved: real("vacation_saved"),
  atfBalance: real("atf_balance"),
  wellnessYtd: integer("wellness_ytd"),
  accountMasked: text("account_masked"),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull().unique(),
  importedAt: text("imported_at").notNull().default(now),
});

/** A payslip's lines (lönearter), in order. Amount signed: negative = deducted. */
export const payslipLines = sqliteTable(
  "payslip_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payslipId: integer("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
    // The column between the dates and the quantity ('Omf 1,00', 'Beräknad på: 31507').
    info: text("info"),
    quantity: real("quantity"),
    unitPrice: integer("unit_price"),
    amount: integer("amount"),
  },
  (t) => [index("payslip_lines_payslip_idx").on(t.payslipId)],
);

/**
 * The salary's constants from a work month on (a revision on 1 June gives a
 * new row): read from a payslip, or changed by hand.
 */
export const salaryConstants = sqliteTable("salary_constants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // First work month (YYYY-MM) the values hold for.
  validFrom: text("valid_from").notNull().unique(),
  monthlySalary: integer("monthly_salary").notNull(),
  industrySupplement: integer("industry_supplement").notNull().default(0),
  salarySupplement: integer("salary_supplement").notNull().default(0),
  // Monthly working time (140) and full time (165,6).
  hoursPerMonth: real("hours_per_month").notNull(),
  fullTimeHours: real("full_time_hours").notNull(),
  // Öre per hour.
  mertidRate: integer("mertid_rate").notNull(),
  vacationHourlyRate: integer("vacation_hourly_rate"),
  // Where the values come from: {field: 'från julispec 2026' | 'ändrat för hand'}.
  sources: text("sources").notNull().default("{}"),
  payslipId: integer("payslip_id").references(() => payslips.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().default(now),
});

/** Löneprognos: what I enter per work month. */
export const salaryMonths = sqliteTable("salary_months", {
  month: text("month").primaryKey(),
  hours: real("hours").notNull(),
  vacationHours: real("vacation_hours").notNull().default(0),
  atfHours: real("atf_hours").notNull().default(0),
  // Hours over 13 per shift or 52 per week (within the month's hours): the overtime supplement.
  overtimePassHours: real("overtime_pass_hours").notNull().default(0),
  // Optional OB hours per level: {"150": 7.5, "151": 23}.
  obHours: text("ob_hours").notNull().default("{}"),
  // 'manual': the hours as entered; 'shifts': from Pendling's shifts × hours per shift.
  hoursMode: text("hours_mode", { enum: ["manual", "shifts"] }).notNull().default("manual"),
  updatedAt: text("updated_at").notNull().default(now),
});

/** Skatteverket's tax tables (open data), as fetched: one row per income bracket. */
export const taxTableRows = sqliteTable(
  "tax_table_rows",
  {
    year: integer("year").notNull(),
    tableNo: integer("table_no").notNull(),
    // '30B': kronor for a monthly salary; '30%': per cent above the table's top.
    kind: text("kind").notNull(),
    incomeFrom: integer("income_from").notNull(),
    incomeTo: integer("income_to").notNull(),
    // Columns 1–6 as published (kronor, or per cent for '30%').
    columns: text("columns").notNull(),
  },
  (t) => [primaryKey({ columns: [t.year, t.tableNo, t.kind, t.incomeFrom] })],
);

export const WATCH_KINDS = [
  "price_drift",
  "double_charge",
  "unusual_amount",
  "new_merchant",
  "missed_charge",
  "subscription_stopped",
  "yearly_renewal",
  // A subscription being watched: it draws again in a few days.
  "charge_coming",
  // Sparandet: the bet zone over its ceiling, prices that stopped arriving,
  // a currency rate that never came.
  "bet_zone_over",
  "prices_stale",
  "fx_missing",
  // Ekonomisk situation: the buffer thinner than three months, a pension
  // value nobody has updated in a year.
  "buffer_low",
  "pension_stale",
  // The latest minPension forecast is over a year old.
  "pension_forecast_stale",
  // Prylar (see items/itemWatch.ts).
  "warranty_ending",
  "return_deadline",
  "maybe_item",
  // Deklaration: the ISK close to the tax-free allowance, a year's return not read in by May.
  "isk_allowance",
  "tax_return_missing",
] as const;

/**
 * Vakt: findings seen (so each is notified once), dismissed (never shown again)
 * or accepted (a price drift's new amount: the series' baseline from then on).
 * The findings themselves are computed from the data; this only remembers.
 */
export const watchFindings = sqliteTable(
  "watch_findings",
  {
    // Stable per finding, e.g. 'double_charge:12:15', 'missed_charge:8:2026-09'.
    key: text("key").primaryKey(),
    kind: text("kind", { enum: WATCH_KINDS }).notNull(),
    // A price drift's series ('expense:5', 'merchant:spotify').
    series: text("series"),
    // Accepted: the amount (öre, positive) and the charge's date.
    amount: integer("amount"),
    date: text("date"),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    dismissedAt: text("dismissed_at"),
    acceptedAt: text("accepted_at"),
  },
  (t) => [index("watch_findings_series_idx").on(t.series)],
);

/**
 * Display names for counterparties (Swish numbers etc.), so lists show 'Mio'
 * instead of '+46765550019'. Keyed on the transaction's counterparty value.
 */
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  counterparty: text("counterparty").notNull().unique(),
  name: text("name").notNull(),
  note: text("note"),
});

/**
 * Bank Norwegian 'Merchant Category' -> our category. Keyed on a normalized form
 * (upper case, punctuation collapsed) because the exports spell the same
 * category differently ('GROCERY STORES/SUPERMARKETS' vs 'Grocery Stores, Supermarkets').
 * Unknown categories are recorded with category_id NULL so they can be mapped in the UI.
 */
export const merchantCategoryMap = sqliteTable("merchant_category_map", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  // One spelling as seen in an export, for display.
  label: text("label").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  timesSeen: integer("times_seen").notNull().default(0),
  lastSeenAt: text("last_seen_at"),
});

/** Possible-duplicate pairs the user has looked at and kept both of. */
export const duplicateDismissals = sqliteTable(
  "duplicate_dismissals",
  {
    olderId: integer("older_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    newerId: integer("newer_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    dismissedAt: text("dismissed_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.olderId, t.newerId] })],
);

/** User settings as JSON values, e.g. 'partner_swish_numbers' => ["+46701234567"]. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Code-based data migrations (things SQL can't do, e.g. recomputing sha256 fingerprints). */
export const dataMigrations = sqliteTable("data_migrations", {
  name: text("name").primaryKey(),
  appliedAt: text("applied_at").notNull().default(now),
});

/**
 * A reconciled month of the shared economy ('Stäm av'): the figures as they
 * were when locked. Later changes show as a deviation instead of silently
 * changing the result. Deleting the row unlocks the month.
 */
export const settlements = sqliteTable("settlements", {
  // 'YYYY-MM' (calendar month by transaction date)
  month: text("month").primaryKey(),
  // All positive öre.
  iPaid: integer("i_paid").notNull(),
  partnerPaid: integer("partner_paid").notNull(),
  fromPartner: integer("from_partner").notNull(),
  toPartner: integer("to_partner").notNull(),
  // Wholly the partner's, paid by me / wholly mine, paid by the partner.
  iPaidForPartner: integer("i_paid_for_partner").notNull().default(0),
  partnerPaidForMe: integer("partner_paid_for_me").notNull().default(0),
  // Result carried in from the previous month (positive = partner owed me).
  carryIn: integer("carry_in").notNull(),
  // Positive = the partner pays me, negative = I pay the partner.
  result: integer("result").notNull(),
  // true: the result carries into next month. false: 'vi är kvitt', the
  // difference was settled outside the tool or written off, next month starts at 0.
  carryForward: integer("carry_forward", { mode: "boolean" }).notNull().default(true),
  note: text("note"),
  settledAt: text("settled_at").notNull().default(now),
});

export const ITEM_OWNERS = ["me", "partner", "shared"] as const;
export const ITEM_STATUSES = ["owned", "sold", "returned", "broken"] as const;
export const ITEM_ATTACHMENT_KINDS = ["image", "receipt", "other"] as const;

/**
 * 'Prylar': the things I have bought and chose to record — an Ovalring ring from
 * Amazon, a monitor — with a picture, the receipt and the transaction they
 * were paid with. Not an inventory of everything I own: only what I put in.
 *
 * An item is metadata, never money. It is counted in no sum, no category and
 * no settlement, which is why the price is stored positive (what the thing
 * cost) rather than signed like a transaction's amount, and why removing an
 * item never touches a transaction.
 */
export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    // Free text, suggested from the subcategories under 'Prylar & hem'. Not a
    // category_id: this says what the thing is ('Elektronik'), and renaming or
    // merging a money category must not rewrite that.
    category: text("category"),
    purchaseDate: text("purchase_date").notNull(),
    // Öre, positive: what it cost. 0 for something that was free.
    priceOre: integer("price_ore").notNull(),
    merchant: text("merchant"),
    // The product page, to find the thing again. http(s) only, see items.ts.
    purchaseUrl: text("purchase_url"),
    note: text("note"),
    owner: text("owner", { enum: ITEM_OWNERS }).notNull().default("me"),
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("owned"),
    // Months of warranty counted from the purchase date; NULL = not known.
    warrantyMonths: integer("warranty_months"),
    // Last day it can be sent back ('ångerrätt'), when that is worth watching.
    returnDeadline: text("return_deadline"),
    // Sold on: what it went for and when, so 'cost per day owned' can end.
    soldPriceOre: integer("sold_price_ore"),
    soldDate: text("sold_date"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    // Soft delete, as everywhere else: gone from every list, still in the database.
    deletedAt: text("deleted_at"),
  },
  (t) => [index("items_purchase_date_idx").on(t.purchaseDate), index("items_status_idx").on(t.status)],
);

/**
 * What an item was paid with. Many-to-many because a purchase and its refund,
 * or an instalment plan, are several transactions for one thing, and one
 * transaction (an Amazon order) can hold several things. The link is a
 * reference and nothing more: no amount, no share, nothing that could make a
 * sum move.
 */
export const itemTransactions = sqliteTable(
  "item_transactions",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.transactionId] }), index("item_transactions_tx_idx").on(t.transactionId)],
);

/**
 * Pictures and receipts. The files live under data/attachments/<item_id>/,
 * outside git and outside the database, the way merchant icons do; the row
 * keeps the path, the name the file had when it was uploaded and the
 * thumbnail made with sharp.
 */
export const itemAttachments = sqliteTable(
  "item_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ITEM_ATTACHMENT_KINDS }).notNull(),
    filePath: text("file_path").notNull(),
    originalFilename: text("original_filename"),
    thumbnailPath: text("thumbnail_path"),
    createdAt: text("created_at").notNull().default(now),
    // Soft delete: the file stays on disk, because a backup may point at it.
    deletedAt: text("deleted_at"),
  },
  (t) => [index("item_attachments_item_idx").on(t.itemId)],
);

/** The shops whose receipts the tool can read (one profile each, see receipts/parse.ts). */
export const INSTRUMENT_KINDS = ["etf", "stock"] as const;
/** Basen (the global ETF) and Bet-zonen (single stocks), from the investment policy. */
export const INSTRUMENT_ZONES = ["base", "bet"] as const;
export const INSTRUMENT_CURRENCIES = ["SEK", "USD", "EUR"] as const;
export const TRADE_ACCOUNTS = ["isk", "depot"] as const;
/** 'opening' is a holding that existed before the tool did: quantity and the average price paid. */
export const TRADE_SIDES = ["buy", "sell", "opening"] as const;
export const FX_PAIRS = ["USDSEK", "EURSEK"] as const;

export const RECEIPT_STORES = ["lidl", "ica", "willys", "rusta"] as const;
/** Where the text came from: pasted by hand, or read out of a PDF. */
export const RECEIPT_SOURCES = ["text", "pdf"] as const;
export const RECEIPT_LINE_KINDS = ["item", "discount", "deposit", "bag"] as const;

/**
 * 'Kvitton': what the money actually bought. Pasted from the shop's own page
 * or read from a PDF, and tied to the transaction that paid for it.
 *
 * A receipt is metadata, never money — exactly like a pryl. The transaction
 * holds the amount; these rows say what it became. Nothing here is counted in
 * a sum, a category or the settlement, and deleting a receipt leaves the
 * transaction untouched.
 *
 * `total_ore` is what the receipt itself states, and the rows always add up to
 * it exactly (checked when saving). That is the whole safety of reading text
 * written by four different shops: a receipt that doesn't balance is not
 * stored.
 */
export const receipts = sqliteTable(
  "receipts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // The purchase it belongs to. Kept on delete: losing the transaction must
    // not silently throw away what was bought.
    transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    store: text("store", { enum: RECEIPT_STORES }).notNull(),
    // The shop and where it is, as the receipt writes it ('Willys Exempelstad Centrum').
    storeArea: text("store_area"),
    purchaseDate: text("purchase_date").notNull(),
    purchaseTime: text("purchase_time"),
    // Öre, positive: what the receipt says was paid.
    totalOre: integer("total_ore").notNull(),
    // 'Totalt 27 varor' when the receipt counts them; a second check.
    statedItemCount: integer("stated_item_count"),
    source: text("source", { enum: RECEIPT_SOURCES }).notNull(),
    // What was pasted, with card and membership numbers taken out. Kept so a
    // receipt can be read again when a profile learns something new.
    rawText: text("raw_text").notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("receipts_transaction_idx").on(t.transactionId), index("receipts_purchase_date_idx").on(t.purchaseDate)],
);

/**
 * One row of a receipt. `total_ore` is signed the way the receipt writes it:
 * positive for something bought, negative for a discount, so the rows add up
 * to the total. `name_key` is the name folded for comparison, which is what a
 * view of one grocery over time is grouped by.
 */
export const receiptLines = sqliteTable(
  "receipt_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    // The order on the receipt, so a discount stays under what it belongs to.
    position: integer("position").notNull(),
    kind: text("kind", { enum: RECEIPT_LINE_KINDS }).notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    // Thousandths: 2 pieces is 2000 and 0,124 kg is 124. Integers, like öre.
    quantityMilli: integer("quantity_milli"),
    unit: text("unit"),
    unitPriceOre: integer("unit_price_ore"),
    totalOre: integer("total_ore").notNull(),
  },
  (t) => [index("receipt_lines_receipt_idx").on(t.receiptId), index("receipt_lines_name_key_idx").on(t.nameKey)],
);

/**
 * A shelf in the shop, as the groceries are followed: Mejeri & ägg, Snacks &
 * godis. Its own list, not the budget's categories — those are about where the
 * money went, these about what was in the bag.
 */
export const productGroups = sqliteTable(
  "product_groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    color: text("color"),
    // The order they are shown in; equal positions fall back to the name.
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("product_groups_name_uq").on(t.name)],
);

/**
 * One grocery, followed over time. The shops print it differently ('Havredryck
 * Barista' at Lidl, 'HAVREDRYCK NATURELL' at Willys, both cut short), so the
 * printed names are aliases and this is the thing they mean. A product with no
 * group is simply one nobody has placed yet.
 */
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    groupId: integer("group_id").references(() => productGroups.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("products_group_idx").on(t.groupId)],
);

/**
 * A name a receipt prints, and which product it means. The key is the folded
 * name alone: the same name in two shops is the same thing until told
 * otherwise, and next month's receipt finds the product without being asked
 * again. Putting two products together moves the aliases, so the answer keeps.
 */
export const productAliases = sqliteTable(
  "product_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nameKey: text("name_key").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("product_aliases_name_key_uq").on(t.nameKey), index("product_aliases_product_idx").on(t.productId)],
);

/**
 * A security held at Avanza. Prices are fetched for `ticker_yahoo`; the
 * currency is the one it trades in, which is what the price is in.
 */
export const instruments = sqliteTable(
  "instruments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    isin: text("isin"),
    currency: text("currency", { enum: INSTRUMENT_CURRENCIES }).notNull(),
    kind: text("kind", { enum: INSTRUMENT_KINDS }).notNull(),
    zone: text("zone", { enum: INSTRUMENT_ZONES }).notNull(),
    // 'EXFG.DE': the symbol *and* the exchange, since the same fund trades in
    // different currencies in different places.
    tickerYahoo: text("ticker_yahoo"),
    // Avanza's orderbook id, only ever used to compare a price with.
    tickerAvanza: text("ticker_avanza"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("instruments_zone_idx").on(t.zone)],
);

/**
 * A buy or a sell, as it was made. What is held now is these summed, never
 * stored: a holding that disagrees with its own trades is a holding that
 * lies.
 *
 * `quantity_e4` is ten-thousandths of a share (73 shares = 730000), and
 * `price_e4` ten-thousandths of the instrument's currency (167,14 EUR =
 * 1671400). Integers, for the same reason money is in öre.
 *
 * `fee_ore` is in SEK: Avanza charges courtage in kronor whatever the
 * instrument trades in. `fx_rate_e6` is the rate that was paid, when it is
 * known — what a purchase cost in kronor is decided the day it is made, not
 * by today's rate. Without it the day's rate is used, and without that the
 * amount invested is unknown rather than wrong.
 */
export const trades = sqliteTable(
  "trades",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    account: text("account", { enum: TRADE_ACCOUNTS }).notNull(),
    side: text("side", { enum: TRADE_SIDES }).notNull(),
    date: text("date").notNull(),
    quantityE4: integer("quantity_e4").notNull(),
    priceE4: integer("price_e4").notNull(),
    feeOre: integer("fee_ore").notNull().default(0),
    fxRateE6: integer("fx_rate_e6"),
    // The transfer in Överföringar & sparande › Sparande this was paid with.
    transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("trades_instrument_idx").on(t.instrumentId), index("trades_date_idx").on(t.date)],
);

/** One price per instrument and day; fetching it again the same day replaces it. */
export const priceSnapshots = sqliteTable(
  "price_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    priceE4: integer("price_e4").notNull(),
    currency: text("currency", { enum: INSTRUMENT_CURRENCIES }).notNull(),
    source: text("source").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("price_snapshots_instrument_date_uq").on(t.instrumentId, t.date)],
);

/** Kronor per unit of the foreign currency, in millionths (9,83 = 9830000). */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pair: text("pair", { enum: FX_PAIRS }).notNull(),
    date: text("date").notNull(),
    rateE6: integer("rate_e6").notNull(),
    source: text("source").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("fx_rates_pair_date_uq").on(t.pair, t.date)],
);

/**
 * Money standing in the account, not in any security. Avanza's own value for
 * the account includes it, so without it a reconciliation would call 12 480
 * kr of cash a 'difference'.
 */
export const cashBalances = sqliteTable(
  "cash_balances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account: text("account", { enum: TRADE_ACCOUNTS }).notNull(),
    date: text("date").notNull(),
    amountOre: integer("amount_ore").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("cash_balances_account_date_uq").on(t.account, t.date)],
);

/** An asset or a debt kept by hand. */
export const MANUAL_BALANCE_KINDS = ["asset", "debt"] as const;

/**
 * Something owned or owed that no import knows about: the student loan, the
 * car.
 *
 * The amount is an *anchor* — what was true on `value_date` — never a running
 * total. Where a monthly charge pays the thing down, `recurring_expense_id`
 * points at it and the balance today is the anchor minus every charge booked
 * since that day. So a month that is paid twice, or not at all, is right
 * without anyone remembering to correct it, and correcting it by hand is
 * nothing more than a newer anchor.
 *
 * Always positive, debts included: a debt of 200 000 kr is 20_000_000, and
 * `kind` says which side of the sheet it belongs on.
 */
export const manualBalances = sqliteTable("manual_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // A stable handle for the ones the tool seeds and reasons about: 'csn', 'car'.
  key: text("key").notNull(),
  kind: text("kind", { enum: MANUAL_BALANCE_KINDS }).notNull(),
  name: text("name").notNull(),
  amountOre: integer("amount_ore").notNull(),
  valueDate: text("value_date").notNull(),
  // Whether it can become money quickly. The car cannot, and is kept out of
  // the net worth unless the interface is asked to show what isn't liquid.
  liquid: integer("liquid", { mode: "boolean" }).notNull().default(false),
  recurringExpenseId: integer("recurring_expense_id").references(() => recurringExpenses.id, { onDelete: "set null" }),
  // Where the figure comes from, in words: 'annonser'.
  source: text("source"),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
  deletedAt: text("deleted_at"),
});

export const PENSION_KINDS = ["income_pension", "premium_pension", "occupational", "private"] as const;
export const PENSION_STATUSES = ["active", "closed"] as const;
/** Where a pension fund puts the money, coarsely: enough to see a tilt. */
export const FUND_REGIONS = ["global", "sweden", "usa", "other"] as const;

/**
 * Pensionen: låst kapital, skrivet av för hand från minpension.se.
 *
 * It is written down once a year or so, never fetched: there is no public
 * price source for an occupational pension, and a figure invented to look
 * fresh would be worse than one that says how old it is. Every row therefore
 * carries the day it was true, and the interface shows the oldest of them.
 *
 * This money is shown and never counted. It is not in the net worth and not
 * in how long the money would last, because it cannot be spent for decades —
 * mixing it in would answer a question nobody asked with a number nobody can
 * use.
 */
export const pensionEntries = sqliteTable("pension_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: PENSION_KINDS }).notNull(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  amountOre: integer("amount_ore").notNull(),
  valueDate: text("value_date").notNull(),
  // Whether the holder chooses the funds. An income pension is not placeable.
  placeable: integer("placeable", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: PENSION_STATUSES }).notNull().default("active"),
  // The last premium seen, and when. No forecast is built on it beyond
  // 'it grows by about this a month'.
  monthlyPremiumOre: integer("monthly_premium_ore"),
  premiumDate: text("premium_date"),
  payoutFromAge: integer("payout_from_age"),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
  deletedAt: text("deleted_at"),
});

export const PENSION_STATEMENT_SOURCES = ["orange_envelope"] as const;

/**
 * Årsbeskedet (the orange envelope), one per income year, typed in by hand.
 * It is the check on the tool's own arithmetic: the pensionable income and
 * the pension rights the year gave, as Pensionsmyndigheten counted them.
 */
export const pensionStatements = sqliteTable("pension_statements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // The income year the envelope reports on, not the year it arrived.
  year: integer("year").notNull().unique(),
  pensionableIncomeOre: integer("pensionable_income_ore").notNull(),
  incomePensionRightOre: integer("income_pension_right_ore").notNull(),
  premiumPensionRightOre: integer("premium_pension_right_ore").notNull(),
  source: text("source", { enum: PENSION_STATEMENT_SOURCES }).notNull().default("orange_envelope"),
  enteredAt: text("entered_at").notNull().default(now),
});

/**
 * A forecast from minPension, typed in as it was shown: the monthly pension
 * before tax at a given retirement age, and the assumptions it rests on
 * (return, wage growth — minPension's, not this tool's). Nothing is computed
 * from it. One per day and age: entering it again corrects it.
 */
export const pensionForecasts = sqliteTable(
  "pension_forecasts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    madeOn: text("made_on").notNull(),
    retirementAge: integer("retirement_age").notNull(),
    // Before tax, a month.
    monthlyPensionOre: integer("monthly_pension_ore").notNull(),
    assumptions: text("assumptions").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("pension_forecasts_made_on_age_uq").on(t.madeOn, t.retirementAge)],
);

/** A fund inside a placeable pension, as its statement lists it. */
export const pensionFunds = sqliteTable(
  "pension_funds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entryId: integer("entry_id")
      .notNull()
      .references(() => pensionEntries.id, { onDelete: "cascade" }),
    fundName: text("fund_name").notNull(),
    amountOre: integer("amount_ore").notNull(),
    // Ten-thousandths of a unit, and the unit price in öre, as everywhere else.
    unitsE4: integer("units_e4").notNull(),
    navOre: integer("nav_ore").notNull(),
    valueDate: text("value_date").notNull(),
    // Ten-thousandths of a percent: 0,12 % is 1200.
    feePctE4: integer("fee_pct_e4"),
    region: text("region", { enum: FUND_REGIONS }).notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("pension_funds_entry_idx").on(t.entryId)],
);

/**
 * Balansräkningen som den såg ut den sista i en månad.
 *
 * Taken once a month and never recomputed: a snapshot that changed when an
 * old transaction was edited would not be a history, it would be a second
 * opinion about the present.
 *
 * `estimated` marks a month that was worked out backwards from what is known
 * today rather than recorded at the time. Those points are drawn differently
 * and say what was estimated, because a line that mixes the two without
 * saying so is a line that claims more than it knows.
 */
export const networthSnapshots = sqliteTable("networth_snapshots", {
  // 'YYYY-MM': one per month, the last day of it.
  month: text("month").primaryKey(),
  date: text("date").notNull(),
  // Assets by kind.
  accountsOre: integer("accounts_ore").notNull(),
  securitiesOre: integer("securities_ore").notNull(),
  cashOre: integer("cash_ore").notNull(),
  partnerOre: integer("partner_ore").notNull(),
  // Debts by kind. Positive, as on the sheet itself.
  cardsOre: integer("cards_ore").notNull(),
  otherDebtOre: integer("other_debt_ore").notNull(),
  csnOre: integer("csn_ore").notNull(),
  // Kept apart, never inside the two nets.
  illiquidOre: integer("illiquid_ore").notNull(),
  netExCsnOre: integer("net_ex_csn_ore").notNull(),
  netIncCsnOre: integer("net_inc_csn_ore").notNull(),
  estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Priser: officiella index och rikssnitt, hämtade utifrån.
 *
 * A series is one thing measured over time by someone else — KPI for food,
 * the weekly average diesel price in Sweden — and it exists so that a figure
 * of mine can be held up against it. Nothing here is a price watch: the point
 * is the comparison, not the number.
 *
 * Integers, as everywhere: an index is kept in hundredths (114,25 = 11425)
 * and a fuel price in öre per litre, and `unit` says which of the two a row
 * is. A value without its unit is a number nobody can read twice.
 */
export const PRICE_SERIES_UNITS = ["index", "ore_per_liter"] as const;
export const PRICE_SERIES_FREQUENCIES = ["monthly", "weekly"] as const;

export const priceSeries = sqliteTable("price_series", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stable name used in code and configuration: 'kpi_food_total', 'diesel_se_avg'. */
  key: text("key").notNull().unique(),
  /** What the interface calls it, in Swedish. */
  name: text("name").notNull(),
  unit: text("unit", { enum: PRICE_SERIES_UNITS }).notNull(),
  /** Who publishes it, shown under every chart that uses it. */
  source: text("source").notNull(),
  frequency: text("frequency", { enum: PRICE_SERIES_FREQUENCIES }).notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * One reading in a series, dated by the *first day of the period* it covers —
 * a month is its first day, a week its Monday. Two series can then be lined
 * up by date without anyone having to remember which end of a period a given
 * source dates its figures from.
 *
 * One row per series and date: fetching the same period again replaces it,
 * because a published figure is revised, not duplicated. `fetched_at` is when
 * we last asked, which is what the interface shows as "hämtat".
 */
export const pricePoints = sqliteTable(
  "price_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: integer("series_id")
      .notNull()
      .references(() => priceSeries.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    value: integer("value").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("price_points_series_date_uq").on(t.seriesId, t.date), index("price_points_date_idx").on(t.date)],
);

export type Category = typeof categories.$inferSelect;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type LabelRule = typeof labelRules.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Item = typeof items.$inferSelect;
export type ItemAttachment = typeof itemAttachments.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type ReceiptLine = typeof receiptLines.$inferSelect;
export type ProductGroup = typeof productGroups.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductAlias = typeof productAliases.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type ManualBalance = typeof manualBalances.$inferSelect;
export type PensionEntry = typeof pensionEntries.$inferSelect;
export type PensionFund = typeof pensionFunds.$inferSelect;
export type NetworthSnapshot = typeof networthSnapshots.$inferSelect;
export type PriceSeries = typeof priceSeries.$inferSelect;
export type PricePoint = typeof pricePoints.$inferSelect;
export type FuelFill = typeof fuelFills.$inferSelect;

/**
 * Konsumentverkets beräknade hushållskostnader (referensbudgeten), a year at
 * a time. Loaded from `server/reference-budget/<year>.json` at start; the
 * file is the truth, and a year whose file changed is replaced whole. The
 * published totals are not stored: they are worked out from the items.
 */
export const REFERENCE_BUDGET_SCOPES = ["individual", "household"] as const;
/** The footnote adjustments the calculation knows how to apply. */
export const REFERENCE_BUDGET_CONDITIONS = ["child_under_8", "age_18_19", "age_over_65"] as const;

export const referenceBudgetYears = sqliteTable("reference_budget_years", {
  year: integer("year").primaryKey(),
  sourceTitle: text("source_title").notNull(),
  sourceUrl: text("source_url").notNull(),
  note: text("note"),
  // JSON: [{ key: '25-50', label: '25–50 år' }, …] in the publication's order.
  ageGroups: text("age_groups").notNull(),
  // JSON: [1, 2, …, 7].
  householdSizes: text("household_sizes").notNull(),
  // sha256 of the file as read: a changed file replaces the year.
  sourceHash: text("source_hash").notNull(),
  // A month to read the figures' price level at ('2026-07'); null for the year's KPI average (the default).
  priceBase: text("price_base"),
  loadedAt: text("loaded_at").notNull().default(now),
});

export const referenceBudgetItems = sqliteTable(
  "reference_budget_items",
  {
    year: integer("year")
      .notNull()
      .references(() => referenceBudgetYears.year, { onDelete: "cascade" }),
    key: text("key").notNull(),
    scope: text("scope", { enum: REFERENCE_BUDGET_SCOPES }).notNull(),
    // Items with the same choice are alternatives, one per person (the two food variants).
    choice: text("choice"),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    // SCB's COICOP group the item moves with ('03'), for the KPI adjustment.
    kpi: text("kpi"),
  },
  (t) => [primaryKey({ columns: [t.year, t.key] })],
);

/**
 * One amount: an age group ('25-50') for an individual item, a household size
 * ('2') for a household one. A cell the publication leaves empty has no row —
 * not a zero.
 */
export const referenceBudgetAmounts = sqliteTable(
  "reference_budget_amounts",
  {
    year: integer("year")
      .notNull()
      .references(() => referenceBudgetYears.year, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    bracket: text("bracket").notNull(),
    amountOre: integer("amount_ore").notNull(),
  },
  (t) => [primaryKey({ columns: [t.year, t.itemKey, t.bracket] })],
);

/** The footnotes: an amount added to an item when a condition holds (negative = less). */
export const referenceBudgetAdjustments = sqliteTable(
  "reference_budget_adjustments",
  {
    year: integer("year")
      .notNull()
      .references(() => referenceBudgetYears.year, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    condition: text("condition", { enum: REFERENCE_BUDGET_CONDITIONS }).notNull(),
    amountOre: integer("amount_ore").notNull(),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.year, t.itemKey, t.condition] })],
);

/**
 * Which of Konsumentverkets items a category's spending is compared with, or
 * 'not_included' for spending the reference leaves out (rent, transport,
 * restaurants …). Keyed on the category, so a rename changes nothing and a
 * deleted category leaves the map. A category with no row is shown as
 * unmapped, never guessed. Income, transfers and settlement are not spending
 * and need no row.
 */
export const REFERENCE_NOT_INCLUDED = "not_included";

export const referenceBudgetCategoryMap = sqliteTable("reference_budget_category_map", {
  categoryId: integer("category_id")
    .primaryKey()
    .references(() => categories.id, { onDelete: "cascade" }),
  // An item key ('clothing') or 'not_included'.
  target: text("target").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * The same for a fixed expense, which wins over its rows' category: Tre
 * Kronor draws both the home and the car insurance under Försäkring, and
 * only the fixed expense a row is linked to tells the two apart.
 */
export const referenceBudgetExpenseMap = sqliteTable("reference_budget_expense_map", {
  recurringExpenseId: integer("recurring_expense_id")
    .primaryKey()
    .references(() => recurringExpenses.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});
