/**
 * Quarterly restore rehearsal (FX-86, audit F27). Read-only checks on a RESTORED database: a Neon point-in-time branch
 * created from production (never production itself). Prints a record to paste into docs/restore-log.md.
 *
 *   1. In Neon, create a branch from production at a point in time (owner approval the first time).
 *   2. RESTORE_DATABASE_URL=<that branch's connection string> RESTORE_POINT=<the ISO time you restored to> \
 *        node tests/ts-runner.cjs ./scripts/restore-rehearsal.ts [--started <ISO time you started the restore>]
 *   3. Delete the branch.
 *
 * Checks: every migration in the repo is applied; every core table and document collection is readable; workspace,
 * order and inventory totals; the newest write in the restored data (how close to RESTORE_POINT it is, i.e. how much
 * would be lost). Rehearse on a PGlite copy with `--target pglite:<dir>` instead of RESTORE_DATABASE_URL.
 */
import fs from "fs";
import { createNeonSqlClient, type SqlClient } from "@/infrastructure/store/sql-client";
import { MIGRATIONS_DIR } from "@/infrastructure/store/migrations";
import { CORE_TABLES, STORE_SCHEMA } from "@/infrastructure/store/store-schema";

async function open(): Promise<{ client: SqlClient; label: string }> {
  const i = process.argv.indexOf("--target");
  if (i !== -1 && process.argv[i + 1]?.startsWith("pglite:")) {
    const dir = process.argv[i + 1].slice("pglite:".length);
    const { createPgliteClient } = await import("@/infrastructure/store/pglite-client");
    return { client: createPgliteClient(dir), label: `PGlite at ${dir}` };
  }
  const url = process.env.RESTORE_DATABASE_URL;
  if (!url) throw new Error("Set RESTORE_DATABASE_URL to the restored branch (never the production database), or pass --target pglite:<dir>.");
  // A Neon branch has its own endpoint host: anything on production's host (direct or pooled) is refused
  const host = (u: string | undefined) => {
    try {
      return u ? new URL(u).hostname.replace(/-pooler(?=\.)/, "") : "";
    } catch {
      return "";
    }
  };
  const prodHosts = [process.env.DATABASE_URL, process.env.DATABASE_URL_POOLED].map(host).filter(Boolean);
  if (prodHosts.includes(host(url))) throw new Error("RESTORE_DATABASE_URL points at the production database. Use the restored branch.");
  return { client: createNeonSqlClient(url), label: "RESTORE_DATABASE_URL" };
}

class RolledBack extends Error {}

async function main() {
  const t0 = Date.now();
  const startedArg = process.argv.indexOf("--started");
  const restoreStarted = startedArg !== -1 ? Date.parse(process.argv[startedArg + 1]) : NaN;
  const { client, label } = await open();
  const checks: Array<{ check: string; pass: boolean; detail: string }> = [];
  const add = (check: string, pass: boolean, detail: string) => checks.push({ check, pass, detail });
  try {
    // One READ ONLY transaction on one connection: the rehearsal can't change anything, whatever it is pointed at.
    // It's always rolled back.
    await client.transaction(async (tx) => {
    await tx.query("SET TRANSACTION READ ONLY");
    const expected = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
    const applied = new Set((await tx.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name));
    const missing = expected.filter((m) => !applied.has(m));
    add("migrations applied", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${expected.length} of ${expected.length}`);

    let rows = 0;
    const unreadable: string[] = [];
    for (const { table } of Object.values(CORE_TABLES)) {
      // A savepoint per table, so one unreadable table doesn't abort the rest of the transaction
      await tx.query("SAVEPOINT t");
      try {
        rows += Number((await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${STORE_SCHEMA}.${table}`)).rows[0].n);
        await tx.query("RELEASE SAVEPOINT t");
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT t");
        unreadable.push(table);
      }
    }
    add("core tables readable", unreadable.length === 0, unreadable.length ? `unreadable: ${unreadable.join(", ")}` : `${Object.keys(CORE_TABLES).length} tables, ${rows} rows`);

    const docs = (await tx.query<{ collection: string; n: string }>(`SELECT collection, count(*)::text AS n FROM ${STORE_SCHEMA}.documents GROUP BY collection ORDER BY collection`)).rows;
    add("document collections readable", true, `${docs.length} collections, ${docs.reduce((n, d) => n + Number(d.n), 0)} documents`);

    const tenants = Number((await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${STORE_SCHEMA}.tenants`)).rows[0].n);
    add("workspaces present", tenants > 0, `${tenants} workspaces`);
    const orders = (await tx.query<{ n: string; total: string }>(`SELECT count(*)::text AS n, coalesce(sum((data->>'grand_total')::numeric), 0)::text AS total FROM ${STORE_SCHEMA}.orders`)).rows[0];
    add("orders and revenue", true, `${orders.n} orders, ৳${orders.total} in grand totals`);
    const stock = (await tx.query<{ total: string }>(`SELECT coalesce(sum((data->>'quantity_on_hand')::numeric), 0)::text AS total FROM ${STORE_SCHEMA}.inventory_items`)).rows[0];
    add("inventory on hand", true, `${stock.total} units`);

    const newest = (await tx.query<{ at: string | null }>(`SELECT max(row_updated_at)::text AS at FROM ${STORE_SCHEMA}.documents`)).rows[0].at;
    const point = Date.parse(process.env.RESTORE_POINT ?? "");
    const lossMin = newest && Number.isFinite(point) ? Math.round((point - Date.parse(newest)) / 60_000) : null;
    add("newest write vs restore point", lossMin === null || lossMin <= 60, newest ? `newest write ${newest}${lossMin !== null ? `, ${lossMin} min before the restore point` : ""}` : "no writes found");
    throw new RolledBack(); // never commit anything
    }).catch((err: unknown) => {
      if (!(err instanceof RolledBack)) throw err;
    });
  } finally {
    await client.close();
  }
  const record = {
    rehearsed_at: new Date().toISOString(),
    target: label,
    restore_point: process.env.RESTORE_POINT ?? null,
    minutes_from_restore_start_to_verified: Number.isFinite(restoreStarted) ? Math.round((Date.now() - restoreStarted) / 60_000) : null,
    verify_seconds: Math.round((Date.now() - t0) / 1000),
    pass: checks.every((c) => c.pass),
    checks,
  };
  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  process.exit(record.pass ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`Restore rehearsal failed to run: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
