import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, labelRules, transactions } from "../src/db/schema.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { createApp } from "../src/app.js";
import { buildCsv, freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const get = async <T = any>(app: App, path: string) => (await (await app.request(`/api${path}`)).json()) as T;
const post = async <T = any>(app: App, path: string, body: unknown) => (await (await app.request(`/api${path}`, json("POST", body))).json()) as T;

let seq = 0;
function tx(db: Db, desc: string, o: { label?: string; source?: "swedbank" | "manual"; deleted?: boolean } = {}) {
  return db
    .insert(transactions)
    .values({
      source: o.source ?? "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
      bookingDate: "2026-07-01",
      transactionDate: "2026-07-01",
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount: -24950,
      label: o.label ?? null,
      deletedAt: o.deleted ? "2026-09-01T00:00:00Z" : null,
      fingerprint: `l${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}
const row = (db: Db, id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;

describe("name rules", () => {
  it("suggests the text the rows share, and shows what else it would rename", async () => {
    const { db, app } = setup();
    const a = tx(db, "ANTHROPIC* CLAUDE SUB");
    const b = tx(db, "ANTHROPIC* CLAUDE SUB");
    tx(db, "ANTHROPIC* CLAUDE SUB");
    tx(db, "ANTHROPIC* CLAUDE SUB", { label: "Redan döpt" });
    tx(db, "ANTHROPIC");
    expect(await get(app, `/label-rules/suggest?ids=${a.id},${b.id}`)).toEqual({
      pattern: "ANTHROPIC* CLAUDE SUB",
      matchType: "contains",
      matches: 1,
      examples: ["ANTHROPIC* CLAUDE SUB"],
    });
    // A shared start that ends mid-word is cut back to whole words.
    const c = tx(db, "GOOGLE*CLOUD WZ9");
    const d = tx(db, "GOOGLE*CLOUD KLM");
    expect((await get(app, `/label-rules/suggest?ids=${c.id},${d.id}`)).pattern).toBe("GOOGLE*CLOUD");
    expect(await get(app, `/label-rules/preview?pattern=anthropic&exclude=${a.id}`)).toMatchObject({ matches: 3 });
  });

  it("saves the rule, names the chosen rows and every row without a name it matches; undo puts it all back", async () => {
    const { db, app } = setup();
    const a = tx(db, "ANTHROPIC* CLAUDE SUB");
    const old = tx(db, "ANTHROPIC* CLAUDE SUB");
    const named = tx(db, "ANTHROPIC* CLAUDE SUB", { label: "Eget namn" });
    const gone = tx(db, "ANTHROPIC* CLAUDE SUB", { deleted: true });
    const manual = tx(db, "ANTHROPIC* CLAUDE SUB kontant", { source: "manual" });
    const other = tx(db, "OPENAI");

    const r = await post(app, "/label-rules", { pattern: "ANTHROPIC* CLAUDE SUB", matchType: "contains", label: " CLAUDE Abonnemang ", ids: [a.id] });
    expect(r).toMatchObject({ renamed: 1, applied: 1, previousLabel: null, rule: { label: "CLAUDE Abonnemang" } });
    expect(row(db, a.id)).toMatchObject({ label: "CLAUDE Abonnemang", descriptionClean: "ANTHROPIC* CLAUDE SUB" });
    expect(row(db, a.id).manuallyEditedAt).not.toBeNull();
    // Named by the rule, not by hand: an import with it can still be undone.
    expect(row(db, old.id)).toMatchObject({ label: "CLAUDE Abonnemang", manuallyEditedAt: null });
    expect([named, gone, manual, other].map((t) => row(db, t.id).label)).toEqual(["Eget namn", null, null, null]);

    expect(await get(app, "/label-rules")).toEqual([expect.objectContaining({ pattern: "ANTHROPIC* CLAUDE SUB", label: "CLAUDE Abonnemang", rows: 2 })]);

    expect(await post(app, `/label-rules/${r.rule.id}/undo`, { previousLabel: r.previousLabel, before: r.before })).toEqual({ restored: 2 });
    expect([a, old].map((t) => row(db, t.id).label)).toEqual([null, null]);
    expect(db.select().from(labelRules).all()).toEqual([]);
  });

  it("a new name for the same pattern replaces the old one, and undo gives the old name back", async () => {
    const { db, app } = setup();
    const first = await post(app, "/label-rules", { pattern: "GITHUB", label: "GitHub" });
    const again = await post(app, "/label-rules", { pattern: "GITHUB", label: "GitHub Copilot" });
    expect(again).toMatchObject({ previousLabel: "GitHub", rule: { id: first.rule.id, label: "GitHub Copilot" } });
    await post(app, `/label-rules/${again.rule.id}/undo`, { previousLabel: again.previousLabel, before: again.before });
    expect(db.select().from(labelRules).all()).toEqual([expect.objectContaining({ label: "GitHub" })]);
  });

  it("refuses an empty pattern or name and a broken regex", async () => {
    const { app } = setup();
    for (const body of [{ pattern: " ", label: "X" }, { pattern: "X", label: "" }, { pattern: "(", matchType: "regex", label: "X" }]) {
      expect((await app.request("/api/label-rules", json("POST", body))).status).toBe(400);
    }
  });

  it("new imports get the name; the bank's text stays and rows keep it when the rule is removed", async () => {
    const { db, app } = setup();
    const r = await post(app, "/label-rules", { pattern: "CLAUDE SUB", label: "CLAUDE Abonnemang" });
    importSwedbankCsv(
      db,
      buildCsv([
        { date: "2026-08-30", desc: "ANTHROPIC* CLAUDE SUB", amount: "-249.50" },
        { date: "2026-08-30", desc: "OPENAI", amount: "-119.00" },
      ]),
      "a.csv",
    );
    const imported = db.select().from(transactions).all();
    expect(imported.map((t) => [t.descriptionClean, t.label])).toEqual([
      ["ANTHROPIC* CLAUDE SUB", "CLAUDE Abonnemang"],
      ["OPENAI", null],
    ]);

    const removed = await (await app.request(`/api/label-rules/${r.rule.id}`, json("DELETE"))).json();
    expect(db.select().from(labelRules).all()).toEqual([]);
    expect(db.select().from(transactions).all()[0].label).toBe("CLAUDE Abonnemang");
    await post(app, "/label-rules/restore", removed.rule);
    expect(db.select().from(labelRules).all()).toEqual([expect.objectContaining({ pattern: "CLAUDE SUB", label: "CLAUDE Abonnemang" })]);
  });

  it("renaming one row suggests a rule for its text, unless a rule already gives it that name", async () => {
    const { db, app } = setup();
    const a = tx(db, "exempelgym");
    tx(db, "exempelgym");
    tx(db, "exempelgym", { label: "Gymmet" });
    const manual = tx(db, "Kontant", { source: "manual" });
    const patch = async (id: number, body: unknown) => (await (await app.request(`/api/transactions/${id}`, json("PATCH", body))).json()) as any;

    expect((await patch(a.id, { label: "Exempelgym" })).labelRuleSuggestion).toEqual({
      pattern: "exempelgym",
      matchType: "contains",
      label: "Exempelgym",
      matches: 1,
      examples: ["exempelgym"],
      existingRuleId: null,
    });
    // A note, or the same name again: no question.
    expect((await patch(a.id, { note: "x" })).labelRuleSuggestion).toBeNull();
    expect((await patch(manual.id, { label: "Kontanter" })).labelRuleSuggestion).toBeNull();

    await post(app, "/label-rules", { pattern: "exempelgym", label: "Exempelgym" });
    expect((await patch(a.id, { label: "Exempelgym gym" })).labelRuleSuggestion).toMatchObject({ existingRuleId: expect.any(Number) });
    expect((await patch(a.id, { label: "Exempelgym" })).labelRuleSuggestion).toBeNull();
  });
});

