import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("my own name in the settings", () => {
  it("is null until given, is trimmed, and empty clears it", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    const get = async () => (await (await app.request("/api/settings")).json()) as { ownName: string | null; partnerSwishNumbers: string[] };
    expect((await get()).ownName).toBeNull();
    await app.request("/api/settings", json("PUT", { ownName: "  Kim  " }));
    expect((await get()).ownName).toBe("Kim");
    await app.request("/api/settings", json("PUT", { ownName: "" }));
    expect((await get()).ownName).toBeNull();
  });

  it("leaves the partner's numbers alone when only the name is sent, and the other way round", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    await app.request("/api/settings", json("PUT", { partnerSwishNumbers: ["0701234567"] }));
    const named = (await (await app.request("/api/settings", json("PUT", { ownName: "Kim" }))).json()) as { ownName: string; partnerSwishNumbers: string[] };
    expect(named).toMatchObject({ ownName: "Kim", partnerSwishNumbers: ["+46701234567"] });
    const numbers = (await (await app.request("/api/settings", json("PUT", { partnerSwishNumbers: [] }))).json()) as { ownName: string; partnerSwishNumbers: string[] };
    expect(numbers).toMatchObject({ ownName: "Kim", partnerSwishNumbers: [] });
  });

  it("comes with Delad ekonomi's month", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    await app.request("/api/settings", json("PUT", { ownName: "Kim" }));
    const month = (await (await app.request("/api/shared/2026-09")).json()) as { ownName: string | null };
    expect(month.ownName).toBe("Kim");
  });
});
