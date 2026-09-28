/**
 * Stock rows that point at another tenant's warehouse (FX-36 M11): product creation and bulk import used to fall back
 * to the first warehouse in the store when a workspace had none. Each such row moves to its own workspace's default
 * warehouse (created if needed); if that warehouse already holds a row for the variant, quantities are merged.
 *
 * `plan` is pure; `apply` changes the given data through the callbacks.
 */
import type { InventoryItem, StockMovement, Warehouse } from "@/types/commerce";

export interface WarehouseTenancyData {
  warehouses: Warehouse[];
  inventory_items: InventoryItem[];
  stock_movements: StockMovement[];
}

export interface WarehouseTenancyReport {
  inventory_items_moved: number;
  inventory_items_merged: number;
  stock_movements_repointed: number;
  tenants_affected: string[];
}

function foreign(data: WarehouseTenancyData, tenantId: string, warehouseId: string): boolean {
  const wh = data.warehouses.find((w) => w.id === warehouseId);
  return !wh || wh.tenant_id !== tenantId;
}

export function planWarehouseTenancyFix(data: WarehouseTenancyData): WarehouseTenancyReport {
  const items = data.inventory_items.filter((i) => foreign(data, i.tenant_id, i.warehouse_id));
  const moves = data.stock_movements.filter((m) => foreign(data, m.tenant_id, m.warehouse_id));
  return {
    inventory_items_moved: items.length,
    inventory_items_merged: 0,
    stock_movements_repointed: moves.length,
    tenants_affected: Array.from(new Set([...items, ...moves].map((x) => x.tenant_id))).sort(),
  };
}

export function applyWarehouseTenancyFix(
  data: WarehouseTenancyData,
  ensureDefaultWarehouse: (tenantId: string) => Warehouse
): WarehouseTenancyReport {
  const report = planWarehouseTenancyFix(data);
  const now = new Date().toISOString();
  for (const item of [...data.inventory_items]) {
    if (!foreign(data, item.tenant_id, item.warehouse_id)) continue;
    const target = ensureDefaultWarehouse(item.tenant_id);
    const existing = data.inventory_items.find(
      (i) => i !== item && i.tenant_id === item.tenant_id && i.warehouse_id === target.id && i.product_variant_id === item.product_variant_id
    );
    if (existing) {
      existing.quantity_on_hand += item.quantity_on_hand;
      existing.quantity_reserved += item.quantity_reserved;
      existing.quantity_available = existing.quantity_on_hand - existing.quantity_reserved;
      existing.updated_at = now;
      data.inventory_items.splice(data.inventory_items.indexOf(item), 1);
      report.inventory_items_merged++;
      report.inventory_items_moved--;
    } else {
      item.warehouse_id = target.id;
      item.updated_at = now;
    }
  }
  for (const move of data.stock_movements) {
    if (foreign(data, move.tenant_id, move.warehouse_id)) move.warehouse_id = ensureDefaultWarehouse(move.tenant_id).id;
  }
  return report;
}
