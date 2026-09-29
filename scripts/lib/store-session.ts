import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { assertNoOtherStoreWriter } from "./store-guard";

/**
 * Store access for one-off scripts, for either backend (ADR-108).
 *   JSON file: refuses while the app owns `.data/commerceos.lock` (FX-24).
 *   Postgres:  takes the writer lease (refused while the app holds it) and loads the store.
 */
export async function openStore(): Promise<void> {
  if (db.backend === "json") assertNoOtherStoreWriter();
  await db.ready();
}

/**
 * A backup before any change (it holds password hashes, encrypted credentials and customer data: owner-only file), beside the data directory (default ./.backups): a copy of the JSON file, or for Postgres a
 * JSON export of the whole store as loaded. Returns the backup path.
 */
export function backupStore(label: string): string {
  const dataDir = db.getPersistenceHealth().data_dir; // honours COMMERCEOS_DATA_DIR
  const backupDir = path.join(path.dirname(dataDir), ".backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = Date.now();
  if (db.backend === "json") {
    const file = path.join(backupDir, `commerceos.json.${label}.${stamp}.bak`);
    fs.copyFileSync(path.join(dataDir, "commerceos.json"), file);
    fs.chmodSync(file, 0o600);
    return file;
  }
  const file = path.join(backupDir, `commerceos.postgres-export.${label}.${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(db.data), { encoding: "utf-8", mode: 0o600 });
  return file;
}

/** Leaves without changing anything (dry runs, refusals): releases the Postgres lease first, so the app doesn't wait for it. */
export async function exitStore(code: number): Promise<never> {
  await db.shutdown();
  process.exit(code);
}

/** Saves the changes (flush), releases the Postgres lease, and says whether everything was saved. */
export async function saveStore(): Promise<{ ok: boolean; reason: string | null }> {
  await db.flush();
  const health = db.getPersistenceHealth();
  await db.shutdown();
  if (health.ok) return { ok: true, reason: null };
  const reason =
    health.blocked_reason ??
    health.last_persist_error?.message ??
    (health.unsaved_rows > 0 ? `${health.unsaved_rows} record(s) were refused by the database (see the log)` : "the store is not writable");
  return { ok: false, reason };
}
