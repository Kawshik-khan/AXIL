/**
 * One-time removal of the made-up measurements that older demo seeds wrote (FX-30 follow-up): provider health for
 * bKash/Nagad/Steadfast/Pathao, an 11-dimension platform health record, SLO values, courier performance, model
 * evaluation metrics and demo objective progress. Seeded records are matched by id or exact seed values; anything
 * created or changed since is left alone.
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the store).
 *   2. Dry run:   node tests/ts-runner.cjs ./scripts/clear-demo-telemetry.ts
 *   3. Apply:     node tests/ts-runner.cjs ./scripts/clear-demo-telemetry.ts --apply   (backs up first)
 */
import path from "path";
import { db } from "@/infrastructure/db";
import { cleanDemoTelemetry } from "@/infrastructure/db/demo-telemetry-cleanup";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const apply = process.argv.includes("--apply");

  const preview = cleanDemoTelemetry(db.data, { apply: false });
  for (const [key, count] of Object.entries(preview)) out(`${key.padEnd(30)} ${count}`);
  const total = Object.values(preview).reduce((a, b) => a + b, 0);

  if (!apply) {
    out(total ? "Dry run only. Re-run with --apply to change these (a backup is taken first)." : "Nothing to change.");
    return exitStore(0);
  }
  if (total === 0) {
    out("Nothing to change.");
    return exitStore(0);
  }

  const backupFile = backupStore("before-demo-telemetry-cleanup");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

  cleanDemoTelemetry(db.data, { apply: true });
  db.markDirty(); // direct changes to db.data (FX-20)
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(`Not saved: ${saved.reason}.\n`);
    return exitStore(1);
  }
  out(`Applied: ${total} change(s).`);
  return exitStore(0);
})();
