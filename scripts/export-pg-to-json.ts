/**
 * Rollback path (FIX_IMPLEMENTATION_PLAN FX-43 step 4, ADR-108): export the Postgres store to a JSON store file.
 *
 *   node tests/ts-runner.cjs ./scripts/export-pg-to-json.ts --out <file> [--target neon|pglite:<dir>]
 *
 * To roll back: stop the app, export, move the export over .data/commerceos.json (keep the old file), unset
 * DATA_BACKEND, start the app. The export never overwrites an existing file. Read-only on Postgres.
 */
import fs from "fs";
import path from "path";
import { PgStorePersistence } from "@/infrastructure/store/pg-store";
import { countRecords } from "@/infrastructure/store/canonical";
import { openTarget } from "./lib/pg-target";

void (async () => {
  const i = process.argv.indexOf("--out");
  const file = i === -1 ? null : process.argv[i + 1];
  if (!file) throw new Error("--out <file> is required.");
  const target = path.resolve(file);
  if (fs.existsSync(target)) throw new Error(`${target} already exists; choose another path.`);
  if (target.startsWith(path.resolve("public") + path.sep)) throw new Error("Never export the store into public/ (it would be served).");
  const { client, label } = await openTarget();
  try {
    const store = await new PgStorePersistence(client).load();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(store), { encoding: "utf-8", flag: "wx", mode: 0o600 });
    const { rows, collections } = countRecords(store);
    process.stdout.write(`Exported ${rows} records in ${collections} collections from ${label} to ${path.relative(process.cwd(), target)}\n`);
    process.stdout.write("It holds password hashes, encrypted credentials and customer data: keep it private and delete it when done.\n");
  } finally {
    await client.close();
  }
  process.exit(0);
})().catch((err: unknown) => {
  process.stderr.write(`Export failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
