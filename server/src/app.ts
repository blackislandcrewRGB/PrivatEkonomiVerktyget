import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import {
  accounts,
  categories,
  contacts,
  merchantCategoryMap,
  merchantRules,
  recurringIncome,
  transactions,
} from "./db/schema.js";
import type { AccountMap } from "./import/importSwedbank.js";
import { importFiles } from "./import/importBatch.js";
import { guessMapping, importCsv, previewCsv, savedMapping, type CsvMapping } from "./import/csvImport.js";
import { ImportParseError } from "./import/swedbank.js";
import { ImportError } from "./import/importCore.js";
import { undoImport } from "./import/undoImport.js";
import { importCoverage } from "./import/coverage.js";
import { importHistory } from "./import/history.js";
import { rentNoticeRoutes } from "./routes/rentNotices.js";
import { taxReturnRoutes } from "./routes/taxReturns.js";
import { taxRoutes } from "./routes/tax.js";
import { affordRoutes } from "./routes/afford.js";
import { dataRoutes } from "./routes/data.js";
import { labelRuleRoutes } from "./routes/labelRules.js";
import { fuelRoutes } from "./routes/fuel.js";
import { savingsRoutes } from "./routes/savings.js";
import { watchRoutes } from "./routes/watch.js";
import { cashflowRoutes } from "./routes/cashflow.js";
import { networthRoutes } from "./routes/networth.js";
import { manualDataRoutes } from "./routes/manualData.js";
import { referenceBudgetRoutes } from "./routes/referenceBudget.js";
import { salaryRoutes } from "./routes/salary.js";
import { digestRoutes } from "./routes/digest.js";
import { runWatch } from "./watch/watch.js";
import { getModules, getOwnName, getPartnerName, getPartnerNumbers, setModules, setOwnName, setPartnerNumbers } from "./settings.js";
import { normalizePhone } from "./categorize/counterparty.js";
import { ruleMatchCounts } from "./categorize/ruleService.js";
import { todayLocal, twelveMonthsBack } from "./overview/dates.js";
import { recurringExpenseRoutes } from "./routes/recurringExpenses.js";
import { reviewRoutes, ruleRoutes, transactionRoutes } from "./routes/transactions.js";
import { recurringIncomeRoutes } from "./routes/recurringIncome.js";
import { categoryRoutes } from "./routes/categories.js";
import { sharedRoutes } from "./routes/shared.js";
import { analysisRoutes } from "./routes/analysis.js";
import { accountRoutes, expenseMarkRoutes, overviewRoutes, statementRoutes } from "./routes/overview.js";
import { enableBankingRoutes } from "./routes/enableBanking.js";
import { createBankService, type BankService } from "./enableBanking/service.js";
import { iconRoutes } from "./routes/icons.js";
import { attachmentRoutes, itemRoutes } from "./routes/items.js";
import { receiptRoutes } from "./routes/receipts.js";
import { productRoutes } from "./routes/products.js";
import { attachmentsDir } from "./items/attachments.js";
import { iconsDir } from "./icons/upload.js";
import { ruleIcon } from "./icons/icons.js";
import { config } from "./config.js";
import { requestGuard } from "./requestGuard.js";
import { merchantCategoryKey } from "./import/norwegianKey.js";
import { responseCache } from "./responseCache.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The pages Enable Banking links to from the bank's consent screen. */
const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p></body></html>`;

export function createApp(
  db: Db,
  info: { databasePath: string; instance?: "main" | "test"; serveWeb?: boolean; bankService?: BankService; ntfyTopic?: string; iconsDir?: string; attachmentsDir?: string; allowedHosts?: string[]; refreshCache?: boolean },
) {
  const app = new Hono().basePath("/api");
  // Outermost: the answers go gzipped to a browser that takes it (the kept ones too; they are kept plain).
  app.use("*", compress());
  // Before the routes: the heavy GETs are kept until the database changes, and the server works out stale ones again when left alone.
  const cache = responseCache(db);
  app.use("*", cache.middleware);
  if (info.refreshCache) cache.startRefreshing((request) => app.fetch(request));
  app.route("/", iconRoutes(db, info.iconsDir ?? iconsDir(info.databasePath)));
  app.route("/", attachmentRoutes(db, info.attachmentsDir ?? attachmentsDir(info.databasePath)));
  const bankService = info.bankService ?? createBankService(db, config.enableBanking);
  // Vakt after every import (the bank service runs it after its syncs). Only given a topic, it notifies.
  const watch = () => runWatch(db, todayLocal(), info.ntfyTopic ?? "").catch((e) => console.error(`Vakten misslyckades: ${(e as Error).message}`));

  app.get("/health", (c) => {
    const count = (table: typeof categories | typeof merchantRules | typeof accounts | typeof transactions) =>
      db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
    return c.json({
      ok: true,
      databasePath: info.databasePath,
      instance: info.instance ?? "main",
      web: info.serveWeb ?? false,
      // The commit the image was built from (GIT_COMMIT, set by the deploy): the deploy waits for its own.
      commit: process.env.GIT_COMMIT || null,
      counts: {
        categories: count(categories),
        rules: count(merchantRules),
        accounts: count(accounts),
        transactions: db.select({ n: sql<number>`count(*)` }).from(transactions).where(isNull(transactions.deletedAt)).get()?.n ?? 0,
      },
    });
  });

  app.get("/rules", (c) => {
    const rows = db
      .select({
        id: merchantRules.id,
        pattern: merchantRules.pattern,
        matchType: merchantRules.matchType,
        direction: merchantRules.direction,
        categoryId: merchantRules.categoryId,
        sharedDefault: merchantRules.sharedDefault,
        isTransfer: merchantRules.isTransfer,
        createdFrom: merchantRules.createdFrom,
        hits: merchantRules.hits,
        brandSlug: merchantRules.brandSlug,
        iconPath: merchantRules.iconPath,
      })
      .from(merchantRules)
      .orderBy(asc(merchantRules.id))
      .all();
    // Rows of the last 12 months each rule decides ('Oanvända' when none).
    const matches = ruleMatchCounts(db, twelveMonthsBack(todayLocal()));
    return c.json(rows.map((r) => ({ ...r, matches12: matches.get(r.id) ?? 0, icon: ruleIcon(r) })));
  });

  // Each bank category with how many of its rows are still without a category (not deleted, not a transfer, as in Att granska).
  app.get("/merchant-categories", (c) => {
    const uncategorized = new Map<string, number>();
    for (const { label } of db
      .select({ label: transactions.merchantCategory })
      .from(transactions)
      .where(and(isNotNull(transactions.merchantCategory), isNull(transactions.categoryId), isNull(transactions.deletedAt), eq(transactions.isTransfer, false)))
      .all()) {
      const key = merchantCategoryKey(label!);
      uncategorized.set(key, (uncategorized.get(key) ?? 0) + 1);
    }
    return c.json(
      db
        .select()
        .from(merchantCategoryMap)
        .orderBy(sql`${merchantCategoryMap.categoryId} is not null`, desc(merchantCategoryMap.timesSeen), asc(merchantCategoryMap.key))
        .all()
        .map((m) => ({ ...m, uncategorized: uncategorized.get(m.key) ?? 0 })),
    );
  });

  // Map a bank merchant category to one of ours. Affects future imports only;
  // existing transactions are never recategorised behind the user's back.
  app.put("/merchant-categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { categoryId?: number | null };
    const categoryId = body.categoryId ?? null;
    if (categoryId !== null && !db.select().from(categories).where(eq(categories.id, categoryId)).get()) {
      return c.json({ error: "Kategorin finns inte." }, 400);
    }
    const updated = db.update(merchantCategoryMap).set({ categoryId }).where(eq(merchantCategoryMap.id, id)).returning().get();
    return updated ? c.json(updated) : c.json({ error: "Hittades inte." }, 404);
  });

  app.get("/accounts", (c) => c.json(db.select().from(accounts).orderBy(asc(accounts.id)).all()));

  // The history a page at a time (?before=YYYY-MM-DD, ?via=file|enable_banking), with whether each can be undone ('Ångra') and why not.
  app.get("/imports", (c) => {
    const before = c.req.query("before");
    const via = c.req.query("via");
    return c.json(
      importHistory(db, {
        before: before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : undefined,
        via: via === "file" || via === "enable_banking" ? via : undefined,
      }),
    );
  });

  /** Undo an import: its rows and invoice go (for real, so the file can be imported again). */
  app.delete("/imports/:id", (c) => {
    try {
      return c.json(undoImport(db, Number(c.req.param("id"))));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Per account: up to which date it is imported and how it gets its rows (see importCoverage). */
  app.get("/imports/coverage", (c) => c.json(importCoverage(db)));

  /**
   * Upload one or more bank files. Form fields:
   *   files       the CSV/PDF/XLSX files (repeatable; 'file' also accepted)
   *   dryRun      '1' => run the whole batch and roll it back: an exact preview
   *   accountMap  JSON {"••1234": <accountId> | "new"} (optional)
   */
  app.post("/imports", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = [body.files, body.file].flat().filter((f): f is File => f instanceof File);
    if (raw.length === 0) return c.json({ error: "Inga filer skickades." }, 400);
    if (raw.some((f) => f.size > MAX_UPLOAD_BYTES)) return c.json({ error: "En fil är för stor." }, 413);

    let accountMap: AccountMap = {};
    if (typeof body.accountMap === "string" && body.accountMap) {
      try {
        accountMap = JSON.parse(body.accountMap);
      } catch {
        return c.json({ error: "Ogiltig kontomappning." }, 400);
      }
    }
    const files = await Promise.all(raw.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const result = await importFiles(db, files, { dryRun: body.dryRun === "1", accountMap });
    if (body.dryRun !== "1") await watch();
    return c.json(result);
  });

  /**
   * A file from any bank, read with a column mapping (see import/csvImport.ts).
   * Form fields: file, accountId, mapping (JSON, the whole mapping or the parts that change),
   * and for the real import dryRun '1' for the exact preview. /preview only looks at the file:
   * what it holds, what the mapping makes of it, and with an account what importing would do.
   */
  const csvForm = async (c: Context) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new ImportError("Ingen fil skickades.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ImportError("Filen är för stor.");
    let mapping: Partial<CsvMapping> | null = null;
    if (typeof body.mapping === "string" && body.mapping) {
      try {
        mapping = JSON.parse(body.mapping);
      } catch {
        throw new ImportError("Ogiltiga kolumninställningar.");
      }
    }
    const accountId = typeof body.accountId === "string" && body.accountId ? Number(body.accountId) : null;
    return { file, bytes: new Uint8Array(await file.arrayBuffer()), mapping, accountId, dryRun: body.dryRun === "1" };
  };
  const csvError = (c: Context, e: unknown) => {
    if (e instanceof ImportParseError || e instanceof ImportError) return c.json({ error: e.message, details: e.details }, 422);
    throw e;
  };
  app.post("/imports/csv/preview", async (c) => {
    try {
      const f = await csvForm(c);
      return c.json(previewCsv(db, f.bytes, f.file.name, { accountId: f.accountId, mapping: f.mapping }));
    } catch (e) {
      return csvError(c, e);
    }
  });
  app.post("/imports/csv", async (c) => {
    try {
      const f = await csvForm(c);
      if (!f.accountId) throw new ImportError("Välj vilket konto raderna ska läggas på.");
      const kept = savedMapping(db, f.accountId);
      const mapping: CsvMapping = { ...(kept ?? guessMapping(f.bytes)), ...(f.mapping ?? {}) };
      const result = importCsv(db, f.bytes, f.file.name, f.accountId, mapping, { dryRun: f.dryRun });
      if (!f.dryRun) await watch();
      return c.json(result);
    } catch (e) {
      return csvError(c, e);
    }
  });

  app.route("/label-rules", labelRuleRoutes(db));
  app.route("/fuel", fuelRoutes(db));
  app.route("/savings", savingsRoutes(db));
  app.route("/watch", watchRoutes(db));
  app.route("/cashflow", cashflowRoutes(db));
  app.route("/afford", affordRoutes(db));
  app.route("/salary", salaryRoutes(db));
  app.route("/digest", digestRoutes(db, info.ntfyTopic ?? ""));
  app.route("/categories", categoryRoutes(db));
  app.route("/shared", sharedRoutes(db));
  app.route("/analysis", analysisRoutes(db));
  app.route("/networth", networthRoutes(db));
  app.route("/manual-data", manualDataRoutes(db));
  app.route("/reference-budget", referenceBudgetRoutes(db));
  app.route("/recurring-expenses", recurringExpenseRoutes(db));
  app.route("/recurring-expenses", expenseMarkRoutes(db));
  app.route("/overview", overviewRoutes(db));
  app.route("/accounts", accountRoutes(db));
  app.route("/statements", statementRoutes(db));
  app.route("/rent-notices", rentNoticeRoutes(db));
  app.route("/tax-returns", taxReturnRoutes(db));
  app.route("/tax", taxRoutes(db));

  app.route("/recurring-income", recurringIncomeRoutes(db));

  app.get("/contacts", (c) => c.json(db.select().from(contacts).orderBy(asc(contacts.name)).all()));

  // Add or rename a contact. The counterparty is normalized like the importer
  // stores it (phone numbers in +46 form).
  app.put("/contacts", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { counterparty?: string; name?: string; note?: string | null };
    const name = b.name?.trim();
    const raw = b.counterparty?.trim();
    if (!name || !raw) return c.json({ error: "Nummer och namn krävs." }, 400);
    const counterparty = normalizePhone(raw) ?? raw;
    const row = db
      .insert(contacts)
      .values({ counterparty, name, note: b.note ?? null })
      .onConflictDoUpdate({ target: contacts.counterparty, set: { name, note: b.note ?? null } })
      .returning()
      .get();
    return c.json(row);
  });

  app.delete("/contacts/:id", (c) => {
    db.delete(contacts).where(eq(contacts.id, Number(c.req.param("id")))).run();
    return c.json({ ok: true });
  });

  const settingsNow = () => ({ partnerSwishNumbers: getPartnerNumbers(db), partnerName: getPartnerName(db), ownName: getOwnName(db), modules: getModules(db) });
  app.get("/settings", (c) => c.json(settingsNow()));

  /** Sets what is sent: the partner's Swish numbers, my own name and/or which modules are on; the rest is left as it is. */
  app.put("/settings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { partnerSwishNumbers?: string[]; ownName?: string | null; modules?: Record<string, unknown> };
    try {
      if (b.partnerSwishNumbers !== undefined) setPartnerNumbers(db, b.partnerSwishNumbers);
      if (b.ownName !== undefined) setOwnName(db, b.ownName);
      if (b.modules !== undefined) setModules(db, b.modules);
      return c.json(settingsNow());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.route("/data", dataRoutes(db, info));
  app.route("/items", itemRoutes(db));
  app.route("/receipts", receiptRoutes(db));
  app.route("/products", productRoutes(db));
  app.route("/transactions", transactionRoutes(db));
  app.route("/rules", ruleRoutes(db));
  app.route("/review", reviewRoutes(db));
  app.route("/enable-banking", enableBankingRoutes(bankService));

  const root = new Hono();
  // Before every route: only the tool's own names, and only its own pages may change anything.
  root.use("*", requestGuard(info.allowedHosts ?? config.allowedHosts));
  root.get("/privacy", (c) =>
    c.html(PAGE("Integritet", "Privatekonomi är ett privat verktyg som bara läser mina egna konton; uppgifterna stannar på min egen dator och delas aldrig med någon.")),
  );
  root.get("/terms", (c) => c.html(PAGE("Villkor", "Privatekonomi används bara av mig för att läsa mina egna konton, utan garantier och utan att någon annan får tillgång.")));
  root.route("/", app);
  return root;
}
