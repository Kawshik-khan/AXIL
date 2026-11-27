import type { InventoryItem, Product, ProductStatus } from "@/types/commerce";

export const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const satisfies readonly ProductStatus[];
export type ListedStatus = (typeof PRODUCT_STATUSES)[number];

export const STATUS_LABELS: Record<ListedStatus, string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

export const STATUS_NOTES: Record<ListedStatus, string> = {
  ACTIVE: "Customers can order these",
  DRAFT: "Hidden until published",
  ARCHIVED: "Kept for old orders",
};

export type StockRow = InventoryItem & { product_name: string; sku: string; variant_title: string };

/** Stock of one product: available units summed over its variants' inventory rows. */
export interface ProductStock {
  available: number;
  /** Variants at or below their reorder point (but not out). */
  low: number;
  /** Variants with nothing available. */
  out: number;
  tracked: boolean;
}

export type StockLevel = "untracked" | "out" | "low" | "ok";

export function formatTaka(amount: number | null | undefined): string {
  return `৳${Math.round(amount ?? 0).toLocaleString("en-BD")}`;
}

/** Whole-percent discount when the compare-at price is above the price, else null. */
export function discountPercent(product: Pick<Product, "base_price" | "compare_at_price">): number | null {
  const was = product.compare_at_price;
  if (!was || was <= product.base_price || product.base_price <= 0) return null;
  return Math.round(((was - product.base_price) / was) * 100);
}

export function photoOf(product: Product): string | undefined {
  return product.primary_image || product.images?.[0] || undefined;
}

/** Inventory rows grouped by variant id, so each product can sum its own variants. */
export function stockByVariant(rows: StockRow[]): Map<string, StockRow[]> {
  const map = new Map<string, StockRow[]>();
  for (const row of rows) {
    const list = map.get(row.product_variant_id);
    if (list) list.push(row);
    else map.set(row.product_variant_id, [row]);
  }
  return map;
}

export function stockOf(product: Product, byVariant: Map<string, StockRow[]> | null): ProductStock | null {
  if (!byVariant) return null;
  const stock: ProductStock = { available: 0, low: 0, out: 0, tracked: false };
  for (const variant of product.variants ?? []) {
    const rows = byVariant.get(variant.id);
    if (!rows) continue;
    stock.tracked = true;
    const available = rows.reduce((sum, r) => sum + r.quantity_available, 0);
    const reorder = rows.reduce((sum, r) => sum + r.reorder_point, 0);
    stock.available += available;
    if (available <= 0) stock.out += 1;
    else if (available <= reorder) stock.low += 1;
  }
  return stock;
}

export function stockLevel(stock: ProductStock): StockLevel {
  if (!stock.tracked) return "untracked";
  if (stock.available <= 0) return "out";
  if (stock.low > 0 || stock.out > 0) return "low";
  return "ok";
}

/** Variants that need restocking, out of stock first, then by fewest units left. */
export function restockList(rows: StockRow[]): StockRow[] {
  const byVariant = stockByVariant(rows);
  const merged: StockRow[] = [];
  for (const list of byVariant.values()) {
    const available = list.reduce((sum, r) => sum + r.quantity_available, 0);
    const reorder = list.reduce((sum, r) => sum + r.reorder_point, 0);
    if (available <= reorder) merged.push({ ...list[0], quantity_available: available, reorder_point: reorder });
  }
  return merged.sort((a, b) => a.quantity_available - b.quantity_available);
}
