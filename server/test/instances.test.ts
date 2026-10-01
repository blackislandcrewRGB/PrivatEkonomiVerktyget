import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localAddress } from "../src/config.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const loadConfig = (env: Record<string, string>) =>
  spawnSync(process.execPath, ["--import", "tsx", "-e", "const { config } = await import('./server/src/config.ts'); console.log(JSON.stringify(config));"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_PATH: "", API_PORT: "", PRIVATEKONOMI_INSTANCE: "", HOST: "", ...env },
    encoding: "utf8",
  });

describe("test instance", () => {
  it("has its own database and ports by default", () => {
    const r = loadConfig({ PRIVATEKONOMI_INSTANCE: "test" });
    const config = JSON.parse(r.stdout);
    expect(config).toMatchObject({ instance: "test", port: 3101 });
    expect(config.databasePath).toBe(path.join(ROOT, "data/test/finance-test.db"));
  });

  it("refuses the real database", () => {
    const r = loadConfig({ PRIVATEKONOMI_INSTANCE: "test", DATABASE_PATH: "data/finance.db" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Testinstansen får inte använda data/finance.db");
  });

  it("ignores .env's DATABASE_PATH and API_PORT (the real instance's), not the shell's", () => {
    // Without the two in the environment, .env (DATABASE_PATH=data/finance.db, API_PORT=3001 on this machine) would be read.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "DATABASE_PATH" && k !== "API_PORT"));
    const r = spawnSync(process.execPath, ["--import", "tsx", "-e", "const { config } = await import('./server/src/config.ts'); console.log(JSON.stringify(config));"], {
      cwd: ROOT,
      env: { ...env, PRIVATEKONOMI_INSTANCE: "test" },
      encoding: "utf8",
    });
    expect(JSON.parse(r.stdout)).toMatchObject({ instance: "test", port: 3101, databasePath: path.join(ROOT, "data/test/finance-test.db") });
  });

  it("the main instance uses data/finance.db on port 3001", () => {
    const config = JSON.parse(loadConfig({}).stdout);
    expect(config).toMatchObject({ instance: "main", port: 3001, databasePath: path.join(ROOT, "data/finance.db") });
  });
});

describe("the listening address", () => {
  it("is loopback unless HOST says otherwise", () => {
    expect(JSON.parse(loadConfig({}).stdout).host).toBe("127.0.0.1");
    // In the container: every interface of its own network, which only DockTail reaches.
    expect(JSON.parse(loadConfig({ HOST: "0.0.0.0" }).stdout).host).toBe("0.0.0.0");
  });

  it("is reached on loopback when it is a wildcard, else on itself", () => {
    expect(localAddress("0.0.0.0")).toBe("127.0.0.1");
    expect(localAddress("::")).toBe("127.0.0.1");
    expect(localAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(localAddress("100.122.38.91")).toBe("100.122.38.91");
    expect(localAddress("::1")).toBe("[::1]");
  });
});
