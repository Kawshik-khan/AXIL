/**
 * Verify a backfill (FIX_IMPLEMENTATION_PLAN FX-43 step 2, ADR-108): compares the JSON store with Postgres and prints
 * PASS/FAIL per check — row counts per tenant for every collection, SUM(grand_total) of orders and SUM(quantity_on_hand)
 * of inventory computed by Postgres, order sequences, and every record deep-equal (all of them, not a sample).
 *
 *   node tests/ts-runner.cjs ./scripts/verify-migration.ts [--target neon|pglite:<dir>]
 *
 * Read-only on both sides. Stop the app first (the script refuses while the app owns the JSON file).
 */
import "./lib/read-json-store";
import { db } from "@/infrastructure/db";
import { verifyStore } from "@/infrastructure/store/backfill";
import { openTarget } from "./lib/pg-target";
import { printVerifyReport } from "./lib/report";
import { openStore } from "./lib/store-session";

void (async () => {
  await openStore();
  const { client, label } = await openTarget();
  let pass = false;
  try {
    process.stdout.write(`Comparing the JSON store with ${label}:\n`);
    const report = await verifyStore(db.data as unknown as Record<string, unknown>, client);
    printVerifyReport(report);
    pass = report.pass;
  } finally {
    await client.close();
  }
  await db.shutdown();
  process.exit(pass ? 0 : 1);
})().catch((err: unknown) => {
  process.stderr.write(`Verification failed to run: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
