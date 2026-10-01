import "./timezone.js";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveWeb } from "./webApp.js";
import { config, localAddress } from "./config.js";
import { requestGuard } from "./requestGuard.js";
import { openDb, referenceBudgetLog, runMigrations } from "./db/client.js";
import { isDatabaseEmpty, seed } from "./db/seed.js";
import { backupDatabase, hasPendingMigrations } from "./db/backup.js";
import { DATA_MIGRATION_NAMES } from "./db/dataMigrations.js";
import { createApp } from "./app.js";
import { createBankService } from "./enableBanking/service.js";
import { SYNC_CRON } from "./enableBanking/sync.js";
import cron from "node-cron";
import { runWatch } from "./watch/watch.js";
import { syncPrices } from "./savings/prices/sync.js";
import { captureDue } from "./networth/history.js";
import { indexProviders } from "./prices/providers.js";
import { syncIndexes } from "./prices/sync.js";
import { sendDigest } from "./digest/digest.js";
import { todayLocal } from "./overview/dates.js";
import { scheduleNightlyBackup } from "./db/nightlyBackup.js";
import { startHeartbeat } from "./heartbeat.js";

const url = `http://${localAddress(config.host)}:${config.port}`;

/** What answers on our port, if anything: another Privatekonomi (its health), or null. */
async function probe(): Promise<{ databasePath?: string } | null> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as { databasePath?: string }) : {};
  } catch {
    return null;
  }
}

async function main() {
  // A second start while one is running: say so instead of crashing on the port.
  const running = await probe();
  if (running) {
    if (running.databasePath === config.databasePath) {
      console.log(`Privatekonomi kör redan på ${config.serveWeb ? url : url + "/api"} (databas ${config.databasePath}).`);
      process.exit(0);
    }
    console.error(`Porten ${config.port} används redan${running.databasePath ? ` av en annan Privatekonomi (databas ${running.databasePath})` : ""}. Stäng den eller välj en annan API_PORT.`);
    process.exit(1);
  }

  // Backups: before any migration (kept), and one per start (the newest 14 kept).
  if (hasPendingMigrations(config.databasePath, config.migrationsDir, DATA_MIGRATION_NAMES)) {
    const file = await backupDatabase(config.databasePath, "fore-migrering");
    if (file) console.log(`Säkerhetskopia före migrering: ${path.relative(process.cwd(), file)}`);
  }
  const startBackup = await backupDatabase(config.databasePath, "start");
  if (startBackup) console.log(`Säkerhetskopia: ${path.relative(process.cwd(), startBackup)}`);

  const db = openDb();
  for (const line of referenceBudgetLog(runMigrations(db))) console.log(line);
  // Auto-seed only a brand-new database, so rules/categories the user deletes
  // don't reappear on restart. Run `npm run db:seed` to add missing seed rows manually.
  if (isDatabaseEmpty(db)) {
    const r = seed(db);
    console.log(`Seeded new database: ${r.categoriesAdded} categories, ${r.rulesAdded} rules`);
  }

  // The bank sends the user back to the real instance only (EB_REDIRECT_URL), so the test instance has no bank connections.
  // Notifications (ntfy) only from the real instance.
  const ntfyTopic = config.instance === "main" ? config.enableBanking.ntfyTopic : "";
  const bankService = createBankService(db, config.instance === "main" ? config.enableBanking : { ...config.enableBanking, appId: "" }, undefined, {
    afterSync: () => runWatch(db, todayLocal(), ntfyTopic),
  });
  const api = createApp(db, { databasePath: config.databasePath, instance: config.instance, serveWeb: config.serveWeb, bankService, ntfyTopic, refreshCache: true });
  // The banks at 06, 12 and 18 (Enable Banking, see SYNC_HOURS); only the real instance, and only once set up.
  if (config.instance === "main" && bankService.configured) {
    cron.schedule(
      SYNC_CRON,
      () => {
        bankService.sync({ onlySynced: true }).then(
          (r) => {
            const summary = r.connections.flatMap((c) => c.accounts.map((a) => `${c.bank} ${a.maskedRef ?? ""}: ${a.rowsNew} nya, ${a.rowsLinked} länkade${a.error ? ` (fel: ${a.error})` : ""}`));
            if (summary.length) console.log(`Banksynk ${r.at}: ${summary.join("; ")}`);
          },
          (e) => console.error(`Banksynken misslyckades: ${(e as Error).message}`),
        );
      },
      { timezone: "Europe/Stockholm" },
    );
  }
  // Kurser var sjätte timme. Only the real instance: the test
  // instance would ask the same public sources for the same numbers.
  if (config.instance === "main") {
    cron.schedule(
      "30 */6 * * *",
      () => {
        syncPrices(db, todayLocal()).then(
          (r) => {
            const failed = [...r.prices.filter((p) => !p.ok).map((p) => `${p.name}: ${p.error}`), ...r.rates.filter((x) => !x.ok).map((x) => `${x.pair}: ${x.error}`)];
            if (r.prices.length || r.rates.length) console.log(`Kurssynk ${r.at}: ${r.prices.filter((p) => p.ok).length} kurser, ${r.rates.filter((x) => x.ok).length} valutakurser${failed.length ? `; misslyckades: ${failed.join("; ")}` : ""}`);
          },
          (e) => console.error(`Kurssynken misslyckades: ${(e as Error).message}`),
        );
      },
      { timezone: "Europe/Stockholm" },
    );
  }

  // Balansräkningen sparas den sista i månaden, 23:50 svensk tid — sent nog
  // att dagen är över, tidigt nog att inte hamna i nästa. Körs varje kväll,
  // eftersom funktionen själv vet vilken månad som är obevakad: en kväll då
  // servern var avstängd hämtas igen nästa gång, som en uppskattning.
  if (config.instance === "main") {
    cron.schedule(
      "50 23 * * *",
      () => {
        try {
          const r = captureDue(db, todayLocal());
          if (r.captured.length || r.estimated.length) {
            console.log(`Nettoförmögenhet sparad: ${r.captured.join(", ") || "–"}${r.estimated.length ? `; framräknad bakåt: ${r.estimated.join(", ")}` : ""}`);
          }
        } catch (e) {
          console.error(`Månadsavstämningen av nettoförmögenheten misslyckades: ${(e as Error).message}`);
        }
      },
      { timezone: "Europe/Stockholm" },
    );
  }

  // Index och rikssnitt en gång om dygnet, 07:10 svensk tid. Källorna
  // publicerar en gång i månaden respektive en gång i veckan, och synken
  // själv vet när det kan finnas något nytt — den dagliga körningen är bara
  // en knackning på dörren, inte en hämtning. Bara den riktiga instansen.
  if (config.instance === "main") {
    cron.schedule(
      "10 7 * * *",
      () => {
        syncIndexes(db, indexProviders(), { today: todayLocal() }).then(
          (r) => {
            const worth = r.sources.filter((s) => s.added || s.revised || s.error);
            if (worth.length) console.log(`Prisindexsynk ${r.at}: ${worth.map((s) => `${s.source}: ${s.error ?? `${s.added} nya, ${s.revised} reviderade`}`).join("; ")}`);
          },
          (e) => console.error(`Prisindexsynken misslyckades: ${(e as Error).message}`),
        );
      },
      { timezone: "Europe/Stockholm" },
    );
  }

  // Nattkopian 03:45 UTC, for restic at 04:00 (see nightlyBackup.ts); the real instance only.
  scheduleNightlyBackup(cron.schedule, db, config.instance, config.databasePath);

  // Hjärtslaget till Uptime Kuma every five minutes; the real instance only, and only with KUMA_PUSH_URL.
  startHeartbeat(config.instance, config.kumaPushUrl, { db, startedAt: new Date() });

  // Veckodigest: Sundays 19:00 Swedish time, only where there is a topic (the real instance).
  if (ntfyTopic) {
    cron.schedule(
      "0 19 * * 0",
      () => {
        sendDigest(db, todayLocal(), ntfyTopic).then(
          (r) => console.log(`Veckodigest ${r.digest.title}: ${r.sent ? "skickad" : "inte skickad"}`),
          (e) => console.error(`Veckodigesten misslyckades: ${(e as Error).message}`),
        );
      },
      { timezone: "Europe/Stockholm" },
    );
  }
  let app: Hono = api as unknown as Hono;
  if (config.serveWeb) {
    if (!fs.existsSync(path.join(config.webDir, "index.html"))) {
      console.error("Webbappen är inte byggd. Kör `npm run build:web` (startskriptet gör det automatiskt).");
      process.exit(1);
    }
    app = new Hono();
    // The web app's files too, so no other name gets as far as the page.
    app.use("*", requestGuard(config.allowedHosts));
    app.route("/", api);
    serveWeb(app, config.webDir);
  }

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
    console.log(`Privatekonomi (${config.instance}) på ${config.serveWeb ? url : url + "/api"} — databas ${config.databasePath}`);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`Porten ${config.port} används av ett annat program. Stäng det eller välj en annan API_PORT.`);
      process.exit(1);
    }
    throw e;
  });
}

main();
