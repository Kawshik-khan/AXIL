/**
 * Backfill: copy the JSON store into Postgres (FIX_IMPLEMENTATION_PLAN FX-43 step 1, ADR-108).
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the JSON store).
 *   2. Dry run (default): loads the whole store into an in-memory Postgres (PGlite) with the real schema and every
 *      constraint, lists anything the database refuses, and verifies the copy. Nothing leaves this machine.
 *        node tests/ts-runner.cjs ./scripts/migrate-json-to-pg.ts
 *   3. Apply (after `npm run db:migrate` on the target):
 *        node tests/ts-runner.cjs ./scripts/migrate-json-to-pg.ts --apply [--replace] [--target neon|pglite:<dir>]
 *      Everything is written in ONE transaction (a failure leaves the target unchanged), then verified.
 *
 * --replace            overwrite a target that already holds store rows (the final backfill after a rehearsal)
 * --skip-unstorable    leave out records without a usable id (listed by the dry run) instead of stopping
 *
 * The JSON file is only read (never locked or written). After the cutover (DATA_BACKEND=pg), keep it for 7 days as the rollback source.
 */
import "./lib/read-json-store";
import { db } from "@/infrastructure/db";
import { backfillStore, verifyStore } from "@/infrastructure/store/backfill";
import { runMigrations } from "@/infrastructure/store/migrations";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import { openTarget } from "./lib/pg-target";
import { printRows, printVerifyReport } from "./lib/report";
import { openStore } from "./lib/store-session";

const out = (line: string) => process.stdout.write(`${line}\n`);
const apply = process.argv.includes("--apply");
const replace = process.argv.includes("--replace");
const skipUnstorable = process.argv.includes("--skip-unstorable");
/** Set once the backfill transaction has committed, so a later failure isn't reported as "nothing changed". */
let written = false;

void (async () => {
  await openStore();
  const source = db.data as unknown as Record<string, unknown>;

  out("Rehearsal on an in-memory Postgres (migration 006, all constraints):");
  const rehearsal = createPgliteClient();
  await runMigrations(rehearsal);
  const trial = await backfillStore(source, rehearsal, { replace: true, onRejected: "row-by-row" });
  out(`  ${trial.rows} records in ${trial.collections} collections loaded in ${trial.ms} ms (${trial.report.mode})`);
  printRows("Records Postgres refuses", trial.report.rejected);
  printRows("Records without a usable id (can't be stored)", trial.unwritable);
  const trialReport = await verifyStore(source, rehearsal);
  printVerifyReport(trialReport);
  await rehearsal.close();

  if (trial.report.rejected.length > 0) {
    out("Fix the refused records first (each line names the constraint). Nothing was written anywhere.");
    process.exit(1);
  }
  if (trial.unwritable.length > 0 && !skipUnstorable) {
    out("Fix the records without a usable id, or re-run with --skip-unstorable to leave them out. Nothing was written.");
    process.exit(1);
  }
  if (!trialReport.pass) process.exit(1);
  if (!apply) {
    out("Dry run only. Run `npm run db:migrate` on the target, then re-run with --apply.");
    await db.shutdown();
    process.exit(0);
  }

  const { client, label } = await openTarget();
  let pass = false;
  try {
    out(`Writing to ${label} ...`);
    const result = await backfillStore(source, client, { replace, onRejected: "throw" });
    written = true;
    out(`  ${result.rows} records written in ${result.ms} ms (one transaction)`);
    const report = await verifyStore(source, client);
    printVerifyReport(report);
    pass = report.pass;
  } finally {
    await client.close();
  }
  await db.shutdown();
  process.exit(pass ? 0 : 1);
})().catch((err: unknown) => {
  const why = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    written
      ? `The backfill was written, but verification did not complete: ${why}. Run scripts/verify-migration.ts.\n`
      : `Backfill failed, nothing was changed: ${why}\n`
  );
  process.exit(1);
});
