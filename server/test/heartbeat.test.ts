import { describe, expect, it } from "vitest";
import { createHeartbeat, healthReport, pushUrl, startHeartbeat } from "../src/heartbeat.js";
import { setSetting } from "../src/settings.js";
import { freshDb } from "./helpers.js";

/**
 * Hjärtslaget till Uptime Kuma: down for as long as something is wrong, up
 * only when it is all right again, one log line per change, and the push
 * URL (Kuma's token) never in the log.
 */

type Db = ReturnType<typeof freshDb>;

const TOKEN = "hemligtoken123";
const URL_ = `http://192.168.0.153:3001/api/push/${TOKEN}?status=up&msg=OK&ping=`;
const START = new Date("2026-09-22T10:00:00Z");
const ok = (db: Db, at: string) => setSetting(db, "nightly_backup", { at, ok: true, file: "x.db", lastOkAt: at });
const failed = (db: Db, at: string, error: string, lastOkAt?: string) => setSetting(db, "nightly_backup", { at, ok: false, error, lastOkAt });

/** A heartbeat against a fake Kuma: every URL it was sent, and every log line. */
function rig(db: Db, opts: { now?: () => Date; kuma?: (url: string) => Promise<Response> } = {}) {
  const sent: URL[] = [];
  const lines: string[] = [];
  const beat = createHeartbeat({
    db,
    url: URL_,
    startedAt: START,
    now: opts.now ?? (() => new Date("2026-09-23T08:00:00Z")),
    log: (l) => lines.push(l),
    fetch: (async (url: string) => {
      sent.push(new URL(url));
      return opts.kuma ? opts.kuma(url) : new Response("{\"ok\":true}");
    }) as typeof fetch,
  });
  const last = () => ({ status: sent.at(-1)!.searchParams.get("status"), msg: sent.at(-1)!.searchParams.get("msg") });
  return { beat, sent, lines, last };
}

describe("what the heartbeat says", () => {
  it("up when the database answers and last night's copy worked", () => {
    const db = freshDb();
    ok(db, "2026-09-23T03:45:02Z");
    expect(healthReport(db, new Date("2026-09-23T08:00:00Z"), START)).toEqual({ status: "up", message: "OK" });
  });

  it("down, saying which: a failed copy, no copy for two days, a database that doesn't answer", () => {
    const now = new Date("2026-09-23T08:00:00Z");
    const a = freshDb();
    failed(a, "2026-09-23T03:45:02Z", "disken är full");
    expect(healthReport(a, now, START)).toEqual({ status: "down", message: "nattkopia misslyckad 23/9: disken är full" });

    const b = freshDb();
    ok(b, "2026-09-21T03:45:02Z");
    expect(healthReport(b, now, START)).toEqual({ status: "down", message: "ingen lyckad nattkopia sedan 21/9" });

    const c = freshDb();
    c.$client.close();
    expect(healthReport(c, now, START)).toMatchObject({ status: "down", message: expect.stringMatching(/^databasen svarar inte: /) });
  });

  it("a copy that has never run is fine for two days after the start, then down", () => {
    const db = freshDb();
    expect(healthReport(db, new Date("2026-09-23T08:00:00Z"), START).status).toBe("up");
    expect(healthReport(db, new Date("2026-09-24T11:00:00Z"), START)).toEqual({ status: "down", message: "ingen nattkopia sedan start 22/9" });
  });

  it("goes to Kuma's own address, with this beat's status and message in place of the pasted ones", () => {
    const url = new URL(pushUrl(URL_, { status: "down", message: "nattkopia misslyckad 23/9: disken är full" }));
    expect(url.pathname).toBe(`/api/push/${TOKEN}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "down", msg: "nattkopia misslyckad 23/9: disken är full", ping: "" });
  });
});

describe("up → down → up", () => {
  it("sends down on every beat while it lasts, up when solved, and logs one line per change", async () => {
    const db = freshDb();
    const { beat, sent, lines, last } = rig(db);

    ok(db, "2026-09-23T03:45:02Z");
    await beat();
    expect(last()).toEqual({ status: "up", msg: "OK" });

    failed(db, "2026-09-23T03:45:02Z", "disken är full", "2026-09-22T03:45:01Z");
    await beat();
    await beat();
    await beat();
    // Down every time, so a down in Kuma doesn't clear itself at the next beat.
    expect(sent.slice(1).map((u) => u.searchParams.get("status"))).toEqual(["down", "down", "down"]);
    expect(last().msg).toBe("nattkopia misslyckad 23/9: disken är full");

    ok(db, "2026-09-23T09:00:00Z");
    await beat();
    await beat();
    expect(sent.slice(4).map((u) => u.searchParams.get("status"))).toEqual(["up", "up"]);

    // Six beats, three states: three lines.
    expect(lines).toEqual(["Hjärtslag till Kuma: up", "Hjärtslag till Kuma: down – nattkopia misslyckad 23/9: disken är full", "Hjärtslag till Kuma: up"]);
  });
});

describe("a Kuma that doesn't answer", () => {
  it("never stops the tool, and says so once, and once when it answers again", async () => {
    const db = freshDb();
    ok(db, "2026-09-23T03:45:02Z");
    let down = true;
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: `connect ECONNREFUSED ${URL_}` } });
    const { beat, lines } = rig(db, { kuma: async () => (down ? Promise.reject(refused) : new Response("ok")) });

    for (let i = 0; i < 5; i++) await expect(beat()).resolves.toMatchObject({ status: "up" });
    expect(lines).toEqual(["Hjärtslag till Kuma: up", "Uptime Kuma nås inte (ECONNREFUSED). Försöker igen var femte minut, och loggar när den svarar."]);

    down = false;
    await beat();
    await beat();
    expect(lines.slice(2)).toEqual(["Uptime Kuma nås igen."]);
  });

  it("counts an error answer as not reached, and a slow one too", async () => {
    const db = freshDb();
    const bad = rig(db, { kuma: async () => new Response("nej", { status: 404 }) });
    await bad.beat();
    expect(bad.lines.at(-1)).toBe("Uptime Kuma nås inte (HTTP 404). Försöker igen var femte minut, och loggar när den svarar.");
    const slow = rig(db, { kuma: async () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })) });
    await slow.beat();
    expect(slow.lines.at(-1)).toBe("Uptime Kuma nås inte (svarade inte inom 10 s). Försöker igen var femte minut, och loggar när den svarar.");
  });

  it("never writes the push URL or its token to the log", async () => {
    const db = freshDb();
    failed(db, "2026-09-23T03:45:02Z", "disken är full");
    const refused = Object.assign(new TypeError(`fetch failed ${URL_}`), { cause: { code: "ECONNREFUSED", message: URL_ } });
    const { beat, lines } = rig(db, { kuma: async () => Promise.reject(refused) });
    await beat();
    await beat();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });
});

describe("when it runs", () => {
  const fetchSpy = () => {
    const calls: string[] = [];
    return { calls, fetch: (async (url: string) => (calls.push(url), new Response("ok"))) as typeof fetch };
  };

  it("sends nothing without KUMA_PUSH_URL, and nothing in the test instance", async () => {
    const db = freshDb();
    const spy = fetchSpy();
    expect(startHeartbeat("main", "", { db, startedAt: START, fetch: spy.fetch })).toBeNull();
    expect(startHeartbeat("test", URL_, { db, startedAt: START, fetch: spy.fetch })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(spy.calls).toEqual([]);
  });

  it("starts at once in the real instance and beats on", async () => {
    const db = freshDb();
    const spy = fetchSpy();
    const stop = startHeartbeat("main", URL_, { db, startedAt: START, fetch: spy.fetch, log: () => {} }, 30)!;
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(spy.calls.length).toBeGreaterThanOrEqual(3);
    const n = spy.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(spy.calls).toHaveLength(n);
  });

  it("says once, without the value, when KUMA_PUSH_URL isn't an address", () => {
    const lines: string[] = [];
    const spy = fetchSpy();
    expect(startHeartbeat("main", `inte-en-adress-${TOKEN}`, { db: freshDb(), startedAt: START, fetch: spy.fetch, log: (l) => lines.push(l) })).toBeNull();
    expect(lines).toEqual(["KUMA_PUSH_URL är ingen giltig adress. Inget hjärtslag skickas."]);
    expect(spy.calls).toEqual([]);
  });
});
