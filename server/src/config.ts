import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedHostNames } from "./requestGuard.js";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// .env's DATABASE_PATH and API_PORT are the real instance's: the test instance
// keeps its own (a value set in the shell still wins, as usual).
const fromFile: Record<string, string> = {};
dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true, processEnv: fromFile });
for (const [key, value] of Object.entries(fromFile)) {
  if (process.env[key] !== undefined) continue;
  if (process.env.PRIVATEKONOMI_INSTANCE === "test" && (key === "DATABASE_PATH" || key === "API_PORT")) continue;
  process.env[key] = value;
}

/** The real database. Only the main instance may use it. */
export const MAIN_DATABASE = path.join(ROOT_DIR, "data/finance.db");

/**
 * PRIVATEKONOMI_INSTANCE=test is the test instance: its own database under
 * data/test/ (never data/finance.db, not even by mistake) and its own ports.
 */
const instance: "main" | "test" = process.env.PRIVATEKONOMI_INSTANCE === "test" ? "test" : "main";
const databasePath = path.resolve(ROOT_DIR, process.env.DATABASE_PATH || (instance === "test" ? "data/test/finance-test.db" : "data/finance.db"));
if (instance === "test" && databasePath === MAIN_DATABASE) {
  throw new Error("Testinstansen får inte använda data/finance.db. Ta bort DATABASE_PATH eller peka den någon annanstans.");
}

/**
 * The address the server listens on. 127.0.0.1 on the Mac: nothing outside the
 * machine reaches it. 0.0.0.0 in the container, whose network only DockTail
 * reaches — no port is published on the host.
 */
const host = process.env.HOST || "127.0.0.1";

/** Where this process reaches its own server: a wildcard address is reached on loopback. */
export function localAddress(listenHost: string): string {
  if (listenHost === "0.0.0.0" || listenHost === "::") return "127.0.0.1";
  return listenHost.includes(":") ? `[${listenHost}]` : listenHost;
}

export const config = {
  instance,
  host,
  /** The names besides loopback a request may be addressed to (see requestGuard.ts). */
  allowedHosts: allowedHostNames(process.env.PUBLIC_BASE_URL ?? "", process.env.ALLOWED_HOSTS ?? ""),
  port: Number(process.env.API_PORT || (instance === "test" ? 3101 : 3001)),
  databasePath,
  /** Serve the built web app (dist/web) from the API port: the 'npm start' app mode. */
  serveWeb: process.env.SERVE_WEB === "1",
  webDir: path.join(ROOT_DIR, "dist/web"),
  migrationsDir: path.join(ROOT_DIR, "server/drizzle"),
  /** Uptime Kuma's push URL for the heartbeat (heartbeat.ts). A secret: it holds Kuma's token, and is never logged. */
  kumaPushUrl: process.env.KUMA_PUSH_URL ?? "",
  /** Enable Banking (PSD2): automatic fetching from the banks. Off without an app id and key. */
  enableBanking: {
    appId: process.env.EB_APP_ID ?? "",
    privateKeyPath: process.env.EB_PRIVATE_KEY_PATH ? path.resolve(ROOT_DIR, process.env.EB_PRIVATE_KEY_PATH) : "",
    redirectUrl: process.env.EB_REDIRECT_URL ?? "",
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
    ntfyTopic: process.env.NTFY_TOPIC ?? "",
  },
};
