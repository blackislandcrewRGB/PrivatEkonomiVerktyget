import { config } from "../config.js";
import { openDb, referenceBudgetLog, runMigrations } from "./client.js";
import { seed } from "./seed.js";
import { backupDatabase, hasPendingMigrations } from "./backup.js";
import { DATA_MIGRATION_NAMES } from "./dataMigrations.js";

const command = process.argv[2];
// Always a copy before migrating (kept, never pruned).
if (hasPendingMigrations(config.databasePath, config.migrationsDir, DATA_MIGRATION_NAMES)) {
  const file = await backupDatabase(config.databasePath, "fore-migrering");
  if (file) console.log(`Säkerhetskopia före migrering: ${file}`);
}
const db = openDb();
for (const line of referenceBudgetLog(runMigrations(db))) console.log(line);
console.log(`Database: ${config.databasePath} (migrated)`);

if (command === "seed") {
  const r = seed(db);
  console.log(
    `Seed: +${r.categoriesAdded} categories, +${r.rulesAdded} rules, +${r.merchantCategoriesAdded} merchant categories`,
  );
} else if (command !== "migrate") {
  console.error(`Unknown command "${command}". Use "migrate" or "seed".`);
  process.exitCode = 1;
}
db.$client.close();
