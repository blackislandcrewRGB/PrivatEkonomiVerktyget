import type { CategoryKey } from "./schema.js";

/**
 * Seed data: category tree (two levels) and initial merchant rules.
 * Category names are user-facing and therefore Swedish.
 * Rules reference categories by path: "Parent" or "Parent/Child".
 */

export interface SeedCategory {
  name: string;
  color: string;
  isTransfer?: boolean;
  children?: string[];
}

// Colours from the colour-blind-safe palette (db/palette.ts), one per main
// category, each the nearest one to what the category had before: Mat stays
// green and Bil red. 16 colours for 17 main categories: Övrigt is neutral grey.
export const SEED_CATEGORIES: SeedCategory[] = [
  { name: "Mat", color: "#117733", children: ["Livsmedel", "Restaurang & café", "Hämtmat", "Alkohol"] },
  { name: "Boende", color: "#56B4E9", children: ["Hyra", "Hem & hushåll"] },
  { name: "Bil", color: "#D55E00", children: ["Drivmedel", "Parkering", "Service & besiktning", "Trängselskatt"] },
  { name: "Resor", color: "#E69F00", children: ["SL", "Taxi", "Hotell", "Övriga resor"] },
  { name: "Nöje", color: "#CC79A7", children: ["Streaming", "Film", "Musik", "Spel", "Aktiviteter"] },
  { name: "AI & utveckling", color: "#332288", children: ["AI-tjänster", "Moln & hosting", "Mjukvara"] },
  { name: "Prylar & hem", color: "#F0E442", children: ["Elektronik", "Inredning & verktyg", "Kläder", "Frakt"] },
  { name: "IT & tele", color: "#0072B2", children: ["Bredband & mobil"] },
  { name: "Försäkring", color: "#882255", children: ["A-kassa"] },
  { name: "Hälsa", color: "#44AA99", children: ["Tandvård", "Vård & apotek", "Träning"] },
  { name: "Bank & avgifter", color: "#CC6677" },
  { name: "Lån & avbetalning", color: "#DDCC77", children: ["CSN"] },
  { name: "Vänner", color: "#999933", children: ["Utlägg"] },
  // 'Okänt' is what 'Vet ej' sets: an ordinary expense, but no rule is made.
  { name: "Övrigt", color: "#94a3b8", children: ["Okänt"] },
  // What I pay the partner (Swish to her): settled in the shared economy.
  { name: "Till partner", color: "#AA4499" },
  // 'Från partner' is the partner's share paid back to me: settled in the shared
  // economy, never counted as ordinary income in the forecast.
  { name: "Inkomst", color: "#009E73", children: ["Lön", "Gåva & bidrag", "Övrigt", "Från partner"] },
  {
    name: "Överföringar & sparande",
    color: "#88CCEE",
    isTransfer: true,
    children: ["Egna överföringar", "Sparande", "Kortbetalning"],
  },
];

/** Category paths the code relies on, by key (see schema: CATEGORY_KEYS). */
export const SEED_CATEGORY_KEYS: Record<string, CategoryKey> = {
  Inkomst: "income",
  "Inkomst/Lön": "salary",
  "Inkomst/Från partner": "from_partner",
  "Till partner": "to_partner",
  "Överföringar & sparande": "transfers",
  "Överföringar & sparande/Egna överföringar": "own_transfer",
  "Överföringar & sparande/Kortbetalning": "card_payment",
  "Överföringar & sparande/Sparande": "savings",
  "Övrigt/Okänt": "unknown",
  "Mat/Livsmedel": "groceries",
  "Mat/Restaurang & café": "restaurants",
  "Mat/Hämtmat": "takeaway",
};

/** Categories used only in the shared-economy settlement (see schema: is_settlement). */
export const SEED_SETTLEMENT_CATEGORIES = ["Till partner", "Inkomst/Från partner"];

export interface SeedRule {
  pattern: string;
  matchType: "exact" | "contains" | "regex";
  category: string;
  isTransfer?: boolean;
  sharedDefault?: boolean | null;
  /** Name of one of my accounts the text identifies as the transfer's counterpart. */
  counterAccount?: string;
  /** Only money in / only money out. Default: both. */
  direction?: "in" | "out";
}

/** Merchants on the Mastercard (invoices and the transaction list); also added to existing databases (data migration 0010). */
export const MASTERCARD_RULES: SeedRule[] = [
  { pattern: "PLEXINC", matchType: "contains", category: "Nöje/Film" },
  { pattern: "YouTubePremium", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "Google One", matchType: "contains", category: "Nöje/Streaming" },
  // More specific than AMAZON (Prylar & hem): the membership is shipping.
  { pattern: "Amazon Prime", matchType: "contains", category: "Prylar & hem/Frakt" },
  { pattern: "MATSMART", matchType: "contains", category: "Mat/Livsmedel" },
  { pattern: "BONUSUTBETALNING", matchType: "contains", category: "Inkomst/Övrigt" },
  { pattern: "ÅRSAVGIFT", matchType: "contains", category: "Bank & avgifter" },
];

// Matching is case-insensitive against description_clean.
// Regex with \b is used where a plain substring would give false positives
// (e.g. "ICA" inside "AMERICA", "PLEX" inside "PERPLEXITY").
export const SEED_RULES: SeedRule[] = [
  // Mat/Livsmedel
  { pattern: "LIDL", matchType: "contains", category: "Mat/Livsmedel" },
  { pattern: "\\bICA\\b", matchType: "regex", category: "Mat/Livsmedel" },
  { pattern: "WILLYS", matchType: "contains", category: "Mat/Livsmedel" },
  { pattern: "\\bCOOP\\b", matchType: "regex", category: "Mat/Livsmedel" },
  { pattern: "HEMK[ÖO]P", matchType: "regex", category: "Mat/Livsmedel" },

  // Short on purpose: Swedbank card rows truncate the name ('K*Systembola').
  { pattern: "SYSTEMBOLA", matchType: "contains", category: "Mat/Alkohol" },

  // Mat/Restaurang & café
  { pattern: "MCDONALD", matchType: "contains", category: "Mat/Restaurang & café" },
  { pattern: "\\bMAX\\b", matchType: "regex", category: "Mat/Restaurang & café" },
  { pattern: "BURGER KING", matchType: "contains", category: "Mat/Restaurang & café" },
  { pattern: "SUBWAY", matchType: "contains", category: "Mat/Restaurang & café" },
  { pattern: "WAYNES COFFEE", matchType: "contains", category: "Mat/Restaurang & café" },
  { pattern: "ESPRESSO HOUSE", matchType: "contains", category: "Mat/Restaurang & café" },
  { pattern: "PIZZERIA", matchType: "contains", category: "Mat/Restaurang & café" },

  // Bil
  { pattern: "CIRCLE K", matchType: "contains", category: "Bil/Drivmedel" },
  { pattern: "\\bOKQ8\\b", matchType: "regex", category: "Bil/Drivmedel" },
  { pattern: "PREEM", matchType: "contains", category: "Bil/Drivmedel" },
  { pattern: "\\bST1\\b", matchType: "regex", category: "Bil/Drivmedel" },
  { pattern: "PARKSTER", matchType: "contains", category: "Bil/Parkering" },
  { pattern: "EASYPARK", matchType: "contains", category: "Bil/Parkering" },
  { pattern: "BILTEMA", matchType: "contains", category: "Bil/Service & besiktning" },
  { pattern: "BESIKTNING", matchType: "contains", category: "Bil/Service & besiktning" },

  // Transfers & savings — never counted as expenses. 'Överföring via internet'
  // has no rule on purpose: it is an internal transfer only when Referens
  // points at one of my accounts (see transfers.ts); otherwise it goes to review.
  { pattern: "Swish Avanza", matchType: "contains", category: "Överföringar & sparande/Sparande", isTransfer: true },
  { pattern: "Lysa Spar", matchType: "contains", category: "Överföringar & sparande/Sparande", isTransfer: true },
  // A card bill's payment is a transfer to that card's account: its rule is made with the card account.
  // Deposits from / payments to savings.
  { pattern: "\\bAVANZA\\b", matchType: "regex", category: "Överföringar & sparande/Sparande", isTransfer: true },
  { pattern: "\\bLYSA\\b", matchType: "regex", category: "Överföringar & sparande/Sparande", isTransfer: true },

  // Resor
  { pattern: "Swish AB STORSTOCKHOLM", matchType: "contains", category: "Resor/SL" },
  { pattern: "\\bELITE\\b", matchType: "regex", category: "Resor/Hotell" },
  { pattern: "QUALITY HO", matchType: "contains", category: "Resor/Hotell" },
  { pattern: "SCANDIC", matchType: "contains", category: "Resor/Hotell" },

  // Boende, försäkring, bank, lån, tele (mostly autogiro from e-sparkonto)
  { pattern: "TRE KRONOR", matchType: "contains", category: "Försäkring" },
  { pattern: "IF SKADEFÖRS", matchType: "contains", category: "Försäkring" },
  { pattern: "A-?KASSA", matchType: "regex", category: "Försäkring/A-kassa" },
  { pattern: "PRIS NYCKELKUND", matchType: "contains", category: "Bank & avgifter" },
  { pattern: "\\bCSN\\b", matchType: "regex", category: "Lån & avbetalning/CSN" },
  { pattern: "TELE2", matchType: "contains", category: "IT & tele/Bredband & mobil" },

  // Hälsa
  { pattern: "FOLKTANDV", matchType: "contains", category: "Hälsa/Tandvård" },
  { pattern: "FITNESS24", matchType: "contains", category: "Hälsa/Träning" },
  { pattern: "APOTEK", matchType: "contains", category: "Hälsa/Vård & apotek" },

  // Bil: skatter och avgifter
  { pattern: "FORDONSSKATT", matchType: "contains", category: "Bil" },
  { pattern: "TRÄNGSELSKATT", matchType: "contains", category: "Bil/Trängselskatt" },
  { pattern: "Infrastrukturavg", matchType: "contains", category: "Bil/Trängselskatt" },

  // Inkomster
  { pattern: "^L[ÖO]N\\b", matchType: "regex", category: "Inkomst/Lön" },
  { pattern: "Sparränta", matchType: "contains", category: "Inkomst/Övrigt" },
  { pattern: "ÅTERBET", matchType: "contains", category: "Inkomst/Övrigt" },

  // People are not here: a Swish number is somebody's own. The partner's number is a
  // setting, and a rule for anyone else is made from the transaction list.

  // AI & utveckling
  { pattern: "OPENAI", matchType: "contains", category: "AI & utveckling/AI-tjänster" },
  { pattern: "CLAUDE", matchType: "contains", category: "AI & utveckling/AI-tjänster" },
  { pattern: "ANTHROPIC", matchType: "contains", category: "AI & utveckling/AI-tjänster" },
  { pattern: "RUNPOD", matchType: "contains", category: "AI & utveckling/Moln & hosting" },
  { pattern: "GOOGLE ?\\*CLOUD", matchType: "regex", category: "AI & utveckling/Moln & hosting" },

  // Prylar & hem
  { pattern: "AMAZON", matchType: "contains", category: "Prylar & hem" },
  { pattern: "IKEA", matchType: "contains", category: "Prylar & hem/Inredning & verktyg" },
  { pattern: "CLAS OHLSON", matchType: "contains", category: "Prylar & hem/Inredning & verktyg" },
  { pattern: "ELGIGANTEN", matchType: "contains", category: "Prylar & hem/Elektronik" },
  { pattern: "H&M", matchType: "contains", category: "Prylar & hem/Kläder" },
  { pattern: "KJELL", matchType: "contains", category: "Prylar & hem/Elektronik" },
  { pattern: "REFURBED", matchType: "contains", category: "Prylar & hem/Elektronik" },
  { pattern: "ALIEXPRESS", matchType: "contains", category: "Prylar & hem" },

  // Nöje/Streaming
  { pattern: "SPOTIFY", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "NETFLIX", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "DISNEY", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "VIAPLAY", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "\\bPLEX\\b", matchType: "regex", category: "Nöje/Streaming" },
  { pattern: "PODME", matchType: "contains", category: "Nöje/Streaming" },
  { pattern: "APPLE.COM/BILL", matchType: "contains", category: "Nöje/Streaming" },
  ...MASTERCARD_RULES,
];

export interface SeedAccount {
  name: string;
  kind: "bank" | "credit_card";
  source: "swedbank" | "norwegian" | "mastercard";
  importHint?: string;
  note?: string;
}

/** Example rules for paying the example cards' bills: a rule per card account, made with it. */
export const EXAMPLE_CARD_RULES: SeedRule[] = [
  { pattern: "Bank Norwegian", matchType: "contains", category: "Överföringar & sparande/Kortbetalning", isTransfer: true, counterAccount: "Bank Norwegian" },
  { pattern: "Mastercard Guld", matchType: "contains", category: "Överföringar & sparande/Kortbetalning", isTransfer: true, counterAccount: "Swedbank Mastercard Guld" },
];

export const MASTERCARD_NOTE = "Skuld enligt senaste importerade faktura. Fakturan importeras som PDF (eller läggs in för hand).";

export const SEED_ACCOUNTS: SeedAccount[] = [
  { name: "Swedbank Privatkonto", kind: "bank", source: "swedbank", importHint: "Privatkonto" },
  {
    name: "Swedbank e-sparkonto",
    kind: "bank",
    source: "swedbank",
    importHint: "e-sparkonto",
    note: "Lönekonto. Autogiron och kortfakturor dras härifrån.",
  },
  {
    name: "Swedbank Mastercard Guld",
    kind: "credit_card",
    source: "mastercard",
    note: MASTERCARD_NOTE,
  },
  {
    name: "Bank Norwegian",
    kind: "credit_card",
    source: "norwegian",
    note: "Gemensamt kreditkort. Skuld enligt senaste faktura.",
  },
];

/**
 * Bank Norwegian 'Merchant Category' -> category path. Keys are written as in the
 * export; they are normalized with merchantCategoryKey() before use.
 */
export const SEED_MERCHANT_CATEGORIES: Record<string, string> = {
  "GROCERY STORES/SUPERMARKETS": "Mat/Livsmedel",
  "MISC FOOD STORES - DEFAULT": "Mat/Livsmedel",
  "FAST FOOD RESTAURANTS": "Mat/Restaurang & café",
  RESTAURANTS: "Mat/Restaurang & café",
  "EATING PLACES, RESTAURANTS": "Mat/Restaurang & café",
  "AUTOMATED FUEL DISPENSERS": "Bil/Drivmedel",
  "PKG STORES/BEER/WINE/LIQUOR": "Mat/Alkohol",
  "DEPARTMENT STORES": "Prylar & hem",
};

/** Display names for counterparties. `partner: true` also sets the partner setting. */
export type SeedContact = { counterparty: string; name: string; partner?: boolean; note?: string };

/** Nothing is seeded: a Swish number is somebody's own (the demo data and the tests have examples). */
export const SEED_CONTACTS: SeedContact[] = [];
