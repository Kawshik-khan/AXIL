/**
 * Postgres test mode (ADR-108): `COMMERCEOS_TEST_PG=1 node tests/ts-runner.cjs ./tests/<suite>.ts` runs an existing
 * suite with the store persisted to an in-memory PGlite database (real Postgres, migration 006, every constraint).
 * When the suite ends, the store is flushed, reloaded from Postgres into a fresh reader and compared with memory
 * record by record; any difference, refused row or persistence error fails the run.
 */
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import { runMigrations } from "@/infrastructure/store/migrations";
import { PgStorePersistence } from "@/infrastructure/store/pg-store";
import { countRecords, diffStores } from "@/infrastructure/store/canonical";
import type { CommerceDatabase } from "@/infrastructure/db";

type StoreGlobal = typeof globalThis & { __commerceosDbFactory?: (store: typeof CommerceDatabase) => CommerceDatabase };

const out = (line: string) => process.stdout.write(`${line}\n`);

export async function installPostgresTestStore(): Promise<void> {
  // Child processes a suite spawns (persistence tests) keep testing the JSON file.
  delete process.env.COMMERCEOS_TEST_PG;
  const client = createPgliteClient();
  await runMigrations(client);
  (globalThis as StoreGlobal).__commerceosDbFactory = (Store) => new Store({ backend: "pg", client, persist: true });
  const { db } = await import("@/infrastructure/db");
  await db.ready();
  out("[postgres] store persisted to PGlite (migration 006)");

  let verified: Promise<boolean> | null = null;
  const verify = () =>
    (verified ??= (async () => {
      await db.flush();
      const health = db.getPersistenceHealth();
      const reader = new PgStorePersistence(client);
      const loaded = await reader.load();
      const expected = db.data as unknown as Record<string, unknown>;
      const diffs = diffStores(expected, loaded);
      const unsaved = db.getUnsavedRows();
      const { rows, collections } = countRecords(expected);
      if (diffs.length === 0 && unsaved.length === 0 && health.ok) {
        out(`[postgres] round trip OK: ${rows} records in ${collections} collections reloaded identically`);
        return true;
      }
      process.stderr.write(`[postgres] round trip FAILED (health ok=${health.ok}, blocked=${health.blocked_code ?? "-"}, error=${health.last_persist_error?.message ?? "-"})\n`);
      for (const r of unsaved.slice(0, 20)) process.stderr.write(`  unsaved ${r.collection}/${r.id} ${r.op}: ${r.reason} ${r.constraint ?? ""}\n`);
      for (const d of diffs.slice(0, 20)) process.stderr.write(`  ${JSON.stringify(d)}\n`);
      return false;
    })().catch((err: unknown) => {
      process.stderr.write(`[postgres] round trip crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
      return false;
    }));

  const realExit = process.exit.bind(process);
  process.exit = ((code?: number | string | null) => {
    void verify().then((ok) => realExit(ok ? (code ?? 0) : 1));
    return undefined as never;
  }) as typeof process.exit;
  process.once("beforeExit", () => {
    void verify().then((ok) => realExit(ok ? (process.exitCode ?? 0) : 1));
  });
}
