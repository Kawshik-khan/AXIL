/**
 * One-time cleanup of values older code made up (FX-36 M5, M15): random "+8801700…" phones on social customers, and
 * outside-Dhaka orders stored as "Chittagong" by the old order form (flagged, excluded from RTO geography).
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the store).
 *   2. Dry run:   node tests/ts-runner.cjs ./scripts/fix-fabricated-data.ts
 *   3. Apply:     node tests/ts-runner.cjs ./scripts/fix-fabricated-data.ts --apply   (backs up first)
 */
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { fixFabricatedData } from "@/infrastructure/db/fabricated-data-fix";
import { assertNoOtherStoreWriter } from "./lib/store-guard";

assertNoOtherStoreWriter();

const out = (line: string) => process.stdout.write(`${line}\n`);
const apply = process.argv.includes("--apply");

const preview = fixFabricatedData(db.data, { apply: false });
out(`social customers with a made-up phone: ${preview.customers_phone_cleared}`);
out(`orders stored as "Chittagong" by the old form: ${preview.orders_address_flagged}`);
const total = preview.customers_phone_cleared + preview.orders_address_flagged;
if (!apply || total === 0) {
  out(total ? "Dry run only. Re-run with --apply to fix these (a backup is taken first)." : "Nothing to change.");
  process.exit(0);
}

const dataFile = path.join(db.getPersistenceHealth().data_dir, "commerceos.json");
const backupDir = path.join(path.dirname(path.dirname(dataFile)), ".backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `commerceos.json.before-fabricated-data-fix.${Date.now()}.bak`);
fs.copyFileSync(dataFile, backupFile);
out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

fixFabricatedData(db.data, { apply: true });
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
