/**
 * One-time fix for stock that was put in another tenant's warehouse (FX-36 M11). Moves each such row to its own
 * workspace's default warehouse (created if needed; quantities merged when a row already exists there).
 *
 *   1. Stop `npm run dev` (the script refuses while the app owns the store).
 *   2. Dry run:   node tests/ts-runner.cjs ./scripts/fix-warehouse-tenancy.ts
 *   3. Apply:     node tests/ts-runner.cjs ./scripts/fix-warehouse-tenancy.ts --apply   (backs up first)
 */
import path from "path";
import { db } from "@/infrastructure/db";
import { applyWarehouseTenancyFix, planWarehouseTenancyFix } from "@/infrastructure/db/warehouse-tenancy-fix";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const apply = process.argv.includes("--apply");

  const plan = planWarehouseTenancyFix(db.data);
  out(`inventory rows in another tenant's warehouse: ${plan.inventory_items_moved}`);
  out(`stock movements in another tenant's warehouse: ${plan.stock_movements_repointed}`);
  out(`workspaces affected: ${plan.tenants_affected.length}`);
  const total = plan.inventory_items_moved + plan.stock_movements_repointed;

  if (!apply || total === 0) {
    out(total ? "Dry run only. Re-run with --apply to fix these (a backup is taken first)." : "Nothing to change.");
    return exitStore(0);
  }

  const backupFile = backupStore("before-warehouse-fix");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

  const result = applyWarehouseTenancyFix(db.data, (tenantId) => db.ensureDefaultWarehouse(tenantId));
  db.markDirty(); // direct changes to db.data (FX-20)
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(`Not saved: ${saved.reason}.\n`);
    return exitStore(1);
  }
  out(`Applied: ${result.inventory_items_moved} moved, ${result.inventory_items_merged} merged, ${result.stock_movements_repointed} movements repointed.`);
  return exitStore(0);
})();
