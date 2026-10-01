import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { accounts, categories, dataMigrations, merchantCategoryMap, merchantRules, receiptLines, recurringExpenses, transactions } from "./schema.js";
import { assignCategoryKeys, insertSeedRule, isDatabaseEmpty, markSettlementCategories, seedContacts, seedMerchantCategoryMap } from "./seed.js";
import { applyExpenseShared, linkRecurring } from "../recurring/link.js";
import { recategorizeUncategorized } from "../categorize/categorize.js";
import { MASTERCARD_NOTE, MASTERCARD_RULES, SEED_ACCOUNTS, SEED_CATEGORIES, SEED_RULES } from "./seedData.js";
import { getCategoryPathMap } from "./seed.js";
import { isNorwegianPaymentText, merchantCategoryKey, norwegianFingerprint, splitPdfDescription } from "../import/norwegianKey.js";
import { maskLongNumbers } from "../import/text.js";
import { matchKey } from "../import/matchKey.js";
import { applyCategoryPalette } from "./paletteMigration.js";
import { assignBrandSlugs } from "../icons/icons.js";
import { seedProductGroups, syncProducts } from "../receipts/products.js";
import { applyDefaultMapping } from "../referenceBudget/mapping.js";
import { setModules } from "../settings.js";

interface DataMigration {
  name: string;
  run(db: Db): void;
}

/**
 * Migrations that transform existing data in code (SQL can't compute sha256).
 * Run after the SQL migrations, each once, in its own transaction. On a brand
 * new database there is nothing to transform: they are just marked as applied
 * and the seed creates the current state.
 */
const MIGRATIONS: DataMigration[] = [
  {
    // Norwegian fingerprint v2: same key for PDF and XLSX (no card number,
    // merchant text without city, payments as 'INBETALNING'). Also splits the
    // city out of description_clean into merchant_area.
    name: "0001_norwegian_fingerprint_v2",
    run(db) {
      const rows = db.select().from(transactions).where(eq(transactions.source, "norwegian")).orderBy(asc(transactions.id)).all();
      if (rows.length === 0) return;

      // Park occurrence indexes out of the way so the unique key can't collide mid-update.
      db.update(transactions).set({ occurrenceIndex: sql`-${transactions.id}` }).where(eq(transactions.source, "norwegian")).run();

      const nextIndex = new Map<string, number>();
      for (const r of rows) {
        const isPayment = isNorwegianPaymentText(r.descriptionRaw);
        const { merchant, area } = isPayment
          ? { merchant: r.descriptionClean, area: null }
          : splitPdfDescription(r.descriptionRaw);
        const fp = norwegianFingerprint({
          transactionDate: r.transactionDate ?? r.bookingDate,
          merchantText: merchant,
          isPayment,
          amount: r.amount,
        });
        const index = (nextIndex.get(fp) ?? 0) + 1;
        nextIndex.set(fp, index);
        db.update(transactions)
          .set({
            fingerprint: fp,
            occurrenceIndex: index,
            descriptionClean: isPayment ? maskLongNumbers(merchant) : merchant,
            merchantArea: r.merchantArea ?? area,
            counterparty: isPayment ? "Bank Norwegian" : merchant,
          })
          .where(eq(transactions.id, r.id))
          .run();
      }
    },
  },
  {
    // Mat › Systembolaget becomes Mat › Alkohol; merchant category map and the
    // Systembolaget rule are added.
    name: "0002_merchant_categories_and_alkohol",
    run(db) {
      const mat = db.select().from(categories).where(and(eq(categories.name, "Mat"), isNull(categories.parentId))).get();
      if (mat) {
        const children = db.select().from(categories).where(eq(categories.parentId, mat.id)).all();
        const systembolaget = children.find((c) => c.name === "Systembolaget");
        if (!children.some((c) => c.name === "Alkohol")) {
          if (systembolaget) db.update(categories).set({ name: "Alkohol" }).where(eq(categories.id, systembolaget.id)).run();
          else db.insert(categories).values({ name: "Alkohol", parentId: mat.id, color: mat.color }).run();
        }
      }
      for (const rule of SEED_RULES.filter((r) => r.category === "Mat/Alkohol")) insertSeedRule(db, rule);
      seedMerchantCategoryMap(db);
    },
  },
  {
    // e-sparkonto, categories and rules for the remaining Swedbank accounts and
    // the income side; counter accounts on the card-payment rules.
    name: "0003_accounts_transfers_income",
    run(db) {
      const esparkonto = SEED_ACCOUNTS.find((a) => a.name === "Swedbank e-sparkonto")!;
      const hasEspar = db.select().from(accounts).where(eq(accounts.name, esparkonto.name)).get();
      if (!hasEspar) db.insert(accounts).values(esparkonto).run();

      for (const [parent, child] of [
        ["Försäkring", "A-kassa"],
        ["Resor", "Hotell"],
        ["Inkomst", "Från partner"],
      ]) {
        const p = db.select().from(categories).where(and(eq(categories.name, parent), isNull(categories.parentId))).get();
        if (!p) continue;
        const exists = db.select().from(categories).where(and(eq(categories.name, child), eq(categories.parentId, p.id))).get();
        if (!exists) db.insert(categories).values({ name: child, parentId: p.id, color: p.color, isTransfer: p.isTransfer }).run();
      }

      const NEW_PATTERNS = new Set([
        "SYSTEMBOLA", "\\bAVANZA\\b", "\\bLYSA\\b", "\\bELITE\\b", "QUALITY HO", "SCANDIC",
        "TRE KRONOR", "IF SKADEFÖRS", "A-?KASSA", "PRIS NYCKELKUND", "\\bCSN\\b", "TELE2", "FOLKTANDV",
        "FITNESS24", "APOTEK", "FORDONSSKATT", "TRÄNGSELSKATT", "Infrastrukturavg", "^L[ÖO]N\\b", "Sparränta", "ÅTERBET",
      ]);
      for (const rule of SEED_RULES.filter((r) => NEW_PATTERNS.has(r.pattern))) insertSeedRule(db, rule);

      // Card-payment rules now know which account they pay.
      for (const rule of SEED_RULES.filter((r) => r.counterAccount)) {
        const account = db.select().from(accounts).where(eq(accounts.name, rule.counterAccount!)).get();
        if (!account) continue;
        db.update(merchantRules)
          .set({ counterAccountId: account.id })
          .where(and(eq(merchantRules.pattern, rule.pattern), eq(merchantRules.createdFrom, "seed"), isNull(merchantRules.counterAccountId)))
          .run();
      }
    },
  },
  {
    // 'Överföring via internet' is no longer a transfer by rule: only when
    // Referens matches one of my accounts. Rows the rule made transfers (and
    // that aren't internal or edited by hand) go back to review.
    name: "0004_remove_internet_transfer_rule",
    run(db) {
      const rule = db
        .select()
        .from(merchantRules)
        .where(and(eq(merchantRules.pattern, "Överföring via internet"), eq(merchantRules.createdFrom, "seed")))
        .get();
      if (!rule) return;
      db.update(transactions)
        .set({ categoryId: null, categorySource: "none", isTransfer: false })
        .where(
          and(
            eq(transactions.descriptionClean, "Överföring via internet"),
            eq(transactions.categoryId, rule.categoryId),
            eq(transactions.categorySource, "rule"),
            isNull(transactions.counterAccountId),
            isNull(transactions.manuallyEditedAt),
          ),
        )
        .run();
      db.delete(merchantRules).where(eq(merchantRules.id, rule.id)).run();
    },
  },
  {
    // Named Swish counterparties (partner, parents) with direction-aware rules,
    // the 'Till partner' category, then a new categorisation pass over rows
    // still without category (never rows edited by hand).
    name: "0005_contacts_and_person_rules",
    run(db) {
      if (!db.select().from(categories).where(and(eq(categories.name, "Till partner"), isNull(categories.parentId))).get()) {
        db.insert(categories).values({ name: "Till partner", color: "#9333ea" }).run();
      }
      for (const rule of SEED_RULES.filter((r) => r.direction)) insertSeedRule(db, rule);
      seedContacts(db);
      recategorizeUncategorized(db);
    },
  },
  {
    // Partner money is settlement, not expense/income; Pocket is billed via Apple.
    name: "0006_settlement_categories_and_pocket",
    run(db) {
      markSettlementCategories(db);
      linkRecurring(db);
    },
  },
  {
    // Keys for the categories the code relies on (so they can be renamed), and
    // the new categories Övrigt › Okänt ('Vet ej') and Vänner › Utlägg.
    name: "0007_category_keys_and_new_categories",
    run(db) {
      const ensure = (parent: string, color: string, child: string) => {
        let top = db.select().from(categories).where(and(eq(categories.name, parent), isNull(categories.parentId))).get();
        if (!top) top = db.insert(categories).values({ name: parent, color }).returning().get();
        const exists = db.select().from(categories).where(and(eq(categories.name, child), eq(categories.parentId, top.id))).get();
        if (!exists) db.insert(categories).values({ name: child, parentId: top.id, color: top.color }).run();
      };
      for (const top of SEED_CATEGORIES.filter((c) => c.name === "Övrigt" || c.name === "Vänner")) {
        for (const child of top.children ?? []) ensure(top.name, top.color, child);
      }
      assignCategoryKeys(db);
    },
  },
  {
    // Remember the seeded name of existing fixed expenses, so a re-run of the
    // Excel seed recognises them after a rename.
    name: "0008_recurring_expense_seed_names",
    run(db) {
      db.update(recurringExpenses).set({ seedName: sql`${recurringExpenses.name}` }).where(isNull(recurringExpenses.seedName)).run();
    },
  },
  {
    // Keys for Mat › Livsmedel and Mat › Restaurang & café (the food analysis).
    name: "0009_food_category_keys",
    run(db) {
      assignCategoryKeys(db);
    },
  },
  {
    // Mastercard Guld is imported now (invoice PDF and the internet bank's list):
    // its own source and its merchants' rules, and the history linked.
    name: "0010_mastercard",
    run(db) {
      const card =
        db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get() ??
        db.select().from(accounts).where(and(eq(accounts.kind, "credit_card"), sql`${accounts.importHint} like '%Mastercard%'`)).get();
      if (card) {
        db.update(accounts)
          .set({
            source: "mastercard",
            importHint: null,
            ...(card.note === "Skuld. Räkningen läggs in manuellt varje månad." ? { note: MASTERCARD_NOTE } : {}),
          })
          .where(eq(accounts.id, card.id))
          .run();
      }
      // A category renamed by the user: that rule is skipped.
      const paths = getCategoryPathMap(db);
      for (const rule of MASTERCARD_RULES) if (paths.has(rule.category)) insertSeedRule(db, rule);

      recategorizeUncategorized(db);
      linkRecurring(db);
    },
  },
  {
    // Corrected one household's own fixed expense; nothing left to do for anyone else.
    name: "0011_nordicwell_pattern",
    run() {},
  },
  {
    // Category colours to the colour-blind-safe palette (UI step 6): one per
    // main category, nearest to the old one; subcategories follow.
    name: "0012_colorblind_palette",
    run(db) {
      applyCategoryPalette(db);
    },
  },
  {
    // Charges linked to a shared fixed expense stayed 'own' in the list (only
    // the settlement counted them as shared). They follow the expense now.
    name: "0013_shared_expense_charges",
    run(db) {
      for (const e of db.select().from(recurringExpenses).where(eq(recurringExpenses.shared, true)).all()) applyExpenseShared(db, e.id, true);
    },
  },
  {
    // Key for Överföringar & sparande › Sparande (Analys: Sparande).
    name: "0014_savings_category_key",
    run(db) {
      assignCategoryKeys(db);
    },
  },
  {
    // Mat › Hämtmat (made by hand in the real data) with a key: Analys › Mat counts it.
    name: "0015_takeaway_category",
    run(db) {
      const mat = db.select().from(categories).where(and(eq(categories.name, "Mat"), isNull(categories.parentId))).get();
      if (mat && !db.select().from(categories).where(and(eq(categories.name, "Hämtmat"), eq(categories.parentId, mat.id))).get()) {
        db.insert(categories).values({ name: "Hämtmat", parentId: mat.id, color: mat.color }).run();
      }
      assignCategoryKeys(db);
    },
  },
  {
    // Match keys on every imported row, so the bank's API (Enable Banking) finds
    // the rows the files already brought in instead of adding them again.
    name: "0016_match_keys",
    run(db) {
      const rows = db
        .select({ id: transactions.id, bookingDate: transactions.bookingDate, amount: transactions.amount, descriptionClean: transactions.descriptionClean })
        .from(transactions)
        .where(sql`${transactions.source} != 'manual' and ${transactions.matchKey} is null`)
        .all();
      for (const r of rows) db.update(transactions).set({ matchKey: matchKey(r) }).where(eq(transactions.id, r.id)).run();
    },
  },
  {
    // Brand icons (simple-icons) on the rules whose rows are all one brand.
    name: "0017_brand_slugs",
    run(db) {
      assignBrandSlugs(db);
    },
  },
  {
    // Groceries become things: the shelves, and a product for every name the
    // receipts have printed, placed by the rules to start with. The deposit
    // rows Willys and Lidl write in their own way ('+PANT ENG PET',
    // 'Pantburk 1,00 SE') were read as groceries; they are deposits, which
    // changes no amount, only what the row is called a kind of.
    name: "0018_products",
    run(db) {
      db.update(receiptLines)
        .set({ kind: "deposit" })
        .where(and(eq(receiptLines.kind, "item"), sql`${receiptLines.nameKey} like 'pant%' or ${receiptLines.nameKey} like '+pant%'`))
        .run();
      seedProductGroups(db);
      syncProducts(db);
    },
  },
  {
    // Seeded one household's own balances (a loan and a car); the figures are not part of the code.
    name: "0019_manual_balances",
    run() {},
  },
  {
    // Seeded one household's own pensions; the figures are not part of the code.
    name: "0020_pensions",
    run() {},
  },
  {
    // Konsumentverkets referensbudget: which category is compared with which
    // item, as approved 2026-09-21, and the home insurance told apart from
    // the car insurance by their fixed expenses.
    name: "0021_reference_budget_map",
    run(db) {
      applyDefaultMapping(db);
    },
  },
  {
    // Bank Norwegian's sync sends Visa's wording since September 2026: a
    // merchant category logged under it joins the one with the export's
    // wording (merchantCategoryAliases.ts).
    name: "0022_merchant_category_aliases",
    run(db) {
      mergeMerchantCategoryKeys(db);
    },
  },
  {
    // Lön and Pendling & bränsle became modules, off in a new database. A database that
    // was in use before that keeps them on, so nothing it shows goes away.
    name: "0023_modules_on_for_existing_databases",
    run(db) {
      setModules(db, { salary: true, commute: true });
    },
  },
];

/**
 * Merchant categories whose key is no longer what their label gives (an
 * alias was added) join the entry with that key: the rows seen are added up,
 * that entry's category is kept, or else theirs is taken. Without such an
 * entry the key is just corrected.
 */
export function mergeMerchantCategoryKeys(db: Db): number {
  let merged = 0;
  for (const m of db.select().from(merchantCategoryMap).all()) {
    const key = merchantCategoryKey(m.label);
    if (key === m.key) continue;
    const target = db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, key)).get();
    if (!target) {
      db.update(merchantCategoryMap).set({ key }).where(eq(merchantCategoryMap.id, m.id)).run();
      continue;
    }
    db.update(merchantCategoryMap)
      .set({
        timesSeen: target.timesSeen + m.timesSeen,
        categoryId: target.categoryId ?? m.categoryId,
        lastSeenAt: [target.lastSeenAt, m.lastSeenAt].filter((x): x is string => !!x).sort().at(-1) ?? null,
      })
      .where(eq(merchantCategoryMap.id, target.id))
      .run();
    db.delete(merchantCategoryMap).where(eq(merchantCategoryMap.id, m.id)).run();
    merged++;
  }
  return merged;
}

/** Names of all data migrations, to tell whether a database has some left to run. */
export const DATA_MIGRATION_NAMES = MIGRATIONS.map((m) => m.name);

export function runDataMigrations(db: Db): void {
  const applied = new Set(db.select({ name: dataMigrations.name }).from(dataMigrations).all().map((r) => r.name));
  const fresh = isDatabaseEmpty(db);
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.transaction((tx) => {
      if (!fresh) m.run(tx as unknown as Db);
      tx.insert(dataMigrations).values({ name: m.name }).run();
    });
  }
}
