/**
 * Migration runner (FIX_IMPLEMENTATION_PLAN FX-41 step 4). Each `.sql` file in the directory runs as ONE batch inside
 * one transaction, together with its `_migrations` row: a file applies completely or not at all. The old runner split
 * files on `;` at line ends, which broke functions and DO blocks and could leave half a file applied.
 *
 * Only files directly in the directory run, in name order; `migrations/legacy/` (the drifted 001-005 schema and its
 * seed data) is kept for reference and never runs.
 */
import fs from "fs";
import path from "path";
import type { SqlClient } from "./sql-client";

export const MIGRATIONS_DIR = path.join(process.cwd(), "src", "infrastructure", "db", "migrations");

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(
  client: SqlClient,
  dir: string = MIGRATIONS_DIR,
  log: (line: string) => void = () => undefined
): Promise<MigrationResult> {
  // Same bookkeeping table as the old runner, so databases it migrated keep their history.
  await client.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    )
  `);
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".sql"))
    .map((f) => f.name)
    .sort();
  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    const applied = await client.transaction(async (tx) => {
      // Two runners at once (two deploys) apply each file once: the second waits here, then sees the row.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('commerceos_migrations'))");
      const done = await tx.query("SELECT 1 FROM _migrations WHERE name = $1", [name]);
      if (done.rows.length > 0) return false;
      await tx.exec(sql);
      await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      return true;
    });
    if (applied) {
      result.applied.push(name);
      log(`applied ${file}`);
    } else {
      result.alreadyApplied.push(name);
      log(`already applied ${file}`);
    }
  }
  return result;
}
