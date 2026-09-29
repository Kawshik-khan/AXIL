import { createNeonSqlClient, storeConnectionString, type SqlClient } from "@/infrastructure/store/sql-client";

/**
 * The Postgres database a script works on: `--target neon` (default; DATABASE_URL_POOLED or DATABASE_URL) or
 * `--target pglite:<dir>` (a local PGlite database, for rehearsals without touching Neon).
 */
export async function openTarget(): Promise<{ client: SqlClient; label: string }> {
  const i = process.argv.indexOf("--target");
  const spec = i === -1 ? "neon" : process.argv[i + 1] ?? "";
  if (spec.startsWith("pglite:") && spec.length > "pglite:".length) {
    const dir = spec.slice("pglite:".length);
    const { createPgliteClient } = await import("@/infrastructure/store/pglite-client");
    return { client: createPgliteClient(dir), label: `PGlite at ${dir}` };
  }
  if (spec === "neon") {
    const url = storeConnectionString();
    if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set.");
    return { client: createNeonSqlClient(url), label: "DATABASE_URL" };
  }
  throw new Error("--target must be `neon` or `pglite:<dir>`.");
}
