/**
 * One-time cleanup of values older code made up (FX-36 M5, M15): random "+8801700…" phones on social customers, and
 * outside-Dhaka orders stored as "Chittagong" by the old order form (flagged, excluded from RTO geography).
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the store).
 *   2. Dry run:   node tests/ts-runner.cjs ./scripts/fix-fabricated-data.ts
 *   3. Apply:     node tests/ts-runner.cjs ./scripts/fix-fabricated-data.ts --apply   (backs up first)
 */
import path from "path";
import { db } from "@/infrastructure/db";
import { fixFabricatedData } from "@/infrastructure/db/fabricated-data-fix";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const apply = process.argv.includes("--apply");

  const preview = fixFabricatedData(db.data, { apply: false });
  out(`social customers with a made-up phone: ${preview.customers_phone_cleared}`);
  out(`orders stored as "Chittagong" by the old form: ${preview.orders_address_flagged}`);
  const total = preview.customers_phone_cleared + preview.orders_address_flagged;
  if (!apply || total === 0) {
    out(total ? "Dry run only. Re-run with --apply to fix these (a backup is taken first)." : "Nothing to change.");
    return exitStore(0);
  }

  const backupFile = backupStore("before-fabricated-data-fix");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

  fixFabricatedData(db.data, { apply: true });
  db.markDirty(); // direct changes to db.data (FX-20)
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(`Not saved: ${saved.reason}.\n`);
    return exitStore(1);
  }
  out(`Applied: ${total} change(s).`);
  return exitStore(0);
})();
