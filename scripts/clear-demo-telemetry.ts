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
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { cleanDemoTelemetry } from "@/infrastructure/db/demo-telemetry-cleanup";
import { assertNoOtherStoreWriter } from "./lib/store-guard";

assertNoOtherStoreWriter();

const out = (line: string) => process.stdout.write(`${line}\n`);
const apply = process.argv.includes("--apply");

const preview = cleanDemoTelemetry(db.data, { apply: false });
for (const [key, count] of Object.entries(preview)) out(`${key.padEnd(30)} ${count}`);
const total = Object.values(preview).reduce((a, b) => a + b, 0);

if (!apply) {
  out(total ? "Dry run only. Re-run with --apply to change these (a backup is taken first)." : "Nothing to change.");
  process.exit(0);
}
if (total === 0) {
  out("Nothing to change.");
  process.exit(0);
}

const dataFile = path.join(db.getPersistenceHealth().data_dir, "commerceos.json");
const backupDir = path.join(path.dirname(path.dirname(dataFile)), ".backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `commerceos.json.before-demo-telemetry-cleanup.${Date.now()}.bak`);
fs.copyFileSync(dataFile, backupFile);
out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

cleanDemoTelemetry(db.data, { apply: true });
db.markDirty(); // direct changes to db.data (FX-20)
void (async () => {
  await db.flush();
  const health = db.getPersistenceHealth();
  if (!health.ok) {
    process.stderr.write(`Not saved: ${health.blocked_reason ?? health.last_persist_error?.message ?? "the store is not writable"}.\n`);
    process.exit(1);
  }
  out(`Applied: ${total} change(s).`);
  process.exit(0);
})();
