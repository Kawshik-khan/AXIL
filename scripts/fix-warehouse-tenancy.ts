/**
 * One-time fix for stock that was put in another tenant's warehouse (FX-36 M11). Moves each such row to its own
 * workspace's default warehouse (created if needed; quantities merged when a row already exists there).
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the store).
 *   2. Dry run:   node tests/ts-runner.cjs ./scripts/fix-warehouse-tenancy.ts
 *   3. Apply:     node tests/ts-runner.cjs ./scripts/fix-warehouse-tenancy.ts --apply   (backs up first)
 */
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { applyWarehouseTenancyFix, planWarehouseTenancyFix } from "@/infrastructure/db/warehouse-tenancy-fix";
import { assertNoOtherStoreWriter } from "./lib/store-guard";

assertNoOtherStoreWriter();

const out = (line: string) => process.stdout.write(`${line}\n`);
const apply = process.argv.includes("--apply");

const plan = planWarehouseTenancyFix(db.data);
out(`inventory rows in another tenant's warehouse: ${plan.inventory_items_moved}`);
out(`stock movements in another tenant's warehouse: ${plan.stock_movements_repointed}`);
out(`workspaces affected: ${plan.tenants_affected.length}`);
const total = plan.inventory_items_moved + plan.stock_movements_repointed;

if (!apply || total === 0) {
  out(total ? "Dry run only. Re-run with --apply to fix these (a backup is taken first)." : "Nothing to change.");
  process.exit(0);
}

const dataFile = path.join(db.getPersistenceHealth().data_dir, "commerceos.json");
const backupDir = path.join(path.dirname(path.dirname(dataFile)), ".backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `commerceos.json.before-warehouse-fix.${Date.now()}.bak`);
fs.copyFileSync(dataFile, backupFile);
out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

const result = applyWarehouseTenancyFix(db.data, (tenantId) => db.ensureDefaultWarehouse(tenantId));
db.markDirty(); // direct changes to db.data (FX-20)
void (async () => {
  await db.flush();
  const health = db.getPersistenceHealth();
  if (!health.ok) {
    process.stderr.write(`Not saved: ${health.blocked_reason ?? health.last_persist_error?.message ?? "the store is not writable"}.\n`);
    process.exit(1);
  }
  out(`Applied: ${result.inventory_items_moved} moved, ${result.inventory_items_merged} merged, ${result.stock_movements_repointed} movements repointed.`);
  process.exit(0);
})();
