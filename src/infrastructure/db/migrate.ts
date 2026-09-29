/**
 * CommerceOS — database migration command (FIX_IMPLEMENTATION_PLAN FX-41 step 4, ADR-108).
 *
 *   npm run db:migrate                                   Neon, from DATABASE_URL (asks nothing, applies pending files)
 *   node tests/ts-runner.cjs ./src/infrastructure/db/migrate.ts --pglite <dir>   a local PGlite database (rehearsal)
 *
 * Each file in migrations/ runs as one batch in one transaction with its _migrations row (see store/migrations.ts).
 * migrations/legacy/ (the drifted 001-005 schema and its seed data) is not run.
 */
import { runMigrations } from "@/infrastructure/store/migrations";
import { createNeonSqlClient, type SqlClient } from "@/infrastructure/store/sql-client";

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const pgliteIndex = process.argv.indexOf("--pglite");
  let client: SqlClient;
  if (pgliteIndex !== -1) {
    const dir = process.argv[pgliteIndex + 1];
    if (!dir) throw new Error("--pglite needs a directory.");
    const { createPgliteClient } = await import("@/infrastructure/store/pglite-client");
    client = createPgliteClient(dir);
    out(`Target: PGlite at ${dir}`);
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local or export it).");
    client = createNeonSqlClient(url);
    out("Target: DATABASE_URL");
  }
  try {
    const result = await runMigrations(client, undefined, (line) => out(`  ${line}`));
    out(result.applied.length ? `Applied ${result.applied.length} migration(s).` : "Database is up to date.");
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
