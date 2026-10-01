import type { Db } from "./client.js";

/**
 * The database's generation: it moves with every write through this
 * connection (total_changes) and every commit by another one, a script or
 * the sqlite3 shell (data_version). What is worked out from the database
 * alone can be kept while it stays the same.
 */
export function generation(db: Db): string {
  const changes = db.$client.prepare("select total_changes() as n").get() as { n: number };
  return `${db.$client.pragma("data_version", { simple: true })}:${changes.n}`;
}

/**
 * `work(db)` kept per database until its generation moves. For what many
 * callers in one request ask for again, like the card invoice cycles.
 */
export function perGeneration<T>(work: (db: Db) => T): (db: Db) => T {
  const kept = new WeakMap<Db, { generation: string; value: T }>();
  return (db) => {
    const now = generation(db);
    const hit = kept.get(db);
    if (hit && hit.generation === now) return hit.value;
    const value = work(db);
    kept.set(db, { generation: generation(db), value });
    return value;
  };
}
