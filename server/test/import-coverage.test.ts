import { describe, expect, it } from "vitest";
import { accounts, bankAccounts, bankConnections, statements } from "../src/db/schema.js";
import { importCoverage } from "../src/import/coverage.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

describe("how far each account is imported, and how it gets its rows", () => {
  it("Enable Banking for an account a live bank connection feeds, files for the rest", async () => {
    const db = freshDb({ seeded: true });
    const all = db.select().from(accounts).all();
    const [fed, gone, manual] = all;
    const live = db.insert(bankConnections).values({ aspspName: "Swedbank", status: "active" }).returning().get();
    const removed = db.insert(bankConnections).values({ aspspName: "Bank Norwegian", status: "revoked" }).returning().get();
    db.insert(bankAccounts).values({ connectionId: live.id, uid: "a", accountId: fed.id, lastSyncAt: "2026-09-25T04:00:00Z" }).run();
    db.insert(bankAccounts).values({ connectionId: removed.id, uid: "b", accountId: gone.id, lastSyncAt: "2026-09-20T04:00:00Z" }).run();
    db.insert(statements).values({ accountId: manual.id, periodFrom: "2026-07-19", periodTo: "2026-08-18", dueDate: "2026-09-05", amountDue: 100, source: "pdf" }).run();
    db.insert(statements).values({ accountId: manual.id, periodFrom: "2026-08-19", periodTo: "2026-09-18", nextPeriodTo: "2026-10-16", dueDate: "2026-10-05", amountDue: 100, source: "pdf" }).run();

    const coverage = importCoverage(db);
    expect(coverage.find((c) => c.accountId === fed.id)).toMatchObject({ via: "enable_banking", syncedAt: "2026-09-25T04:00:00Z", importedTo: null });
    expect(coverage.find((c) => c.accountId === gone.id)).toMatchObject({ via: "file", syncedAt: null });
    expect(coverage.find((c) => c.accountId === manual.id)).toMatchObject({ via: "file", lastInvoiceTo: "2026-09-18", nextInvoiceTo: "2026-10-16" });

    const app = createApp(db, { databasePath: ":memory:" });
    const served = (await (await app.request("/api/imports/coverage")).json()) as { accountId: number; kind: string }[];
    expect(served).toHaveLength(all.length);
    expect(served[0]).toMatchObject({ accountId: all[0].id, kind: all[0].kind });
  });
});
