import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { Product, ProductVariant, Category } from "@/types/commerce";
import {
  BulkProductImportRow,
  BulkImportOptions,
  BulkImportResult,
  BulkImportRowError,
  BulkProductRowSchema,
} from "@/types/catalog-import";
import { ProductService } from "./product.service";
import { CategoryService } from "./category.service";
import { CsvParser } from "@/lib/csv-parser";

export class BulkImportService {
  /**
   * Primary Bulk Import Engine with Fault-Tolerant Partial Success Semantics
   */
  public static async importProducts(
    context: RequestContext,
    rawRows: Record<string, any>[],
    options?: BulkImportOptions
  ): Promise<BulkImportResult> {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_CREATE);

    const startTime = Date.now();
    const batchId = `batch_imp_${Date.now()}_${randomSuffix()}`;
    const mode = options?.mode || "upsert";
    const dryRun = Boolean(options?.dry_run);
    const autoCreateCategories = options?.auto_create_categories ?? true;
    const autoGenerateSku = options?.auto_generate_sku_if_missing ?? true;

    const errors: BulkImportRowError[] = [];
    const successfulSkus: string[] = [];
    const createdCategoryNames: string[] = [];
    let importedCount = 0;
    let updatedCount = 0;

    // Resolve tenant primary warehouse
    const tenantWarehouses = db.data.warehouses.filter((w) => w.tenant_id === context.tenant.id);
    const defaultWarehouse =
      (options?.warehouse_id
        ? tenantWarehouses.find((w) => w.id === options.warehouse_id)
        : null) ||
      tenantWarehouses[0] ||
      db.data.warehouses[0];

    // Load existing categories for fast tenant-scoped lookup
    const existingCategories = await CategoryService.listCategories(context);
    const categoryMap = new Map<string, Category>();
    existingCategories.forEach((cat) => {
      categoryMap.set(cat.name.toLowerCase().trim(), cat);
      categoryMap.set(cat.slug.toLowerCase().trim(), cat);
    });

    // In-batch SKU tracker to catch intra-file duplicates
    const seenBatchSkus = new Map<string, number>();

    // Process each row independently to guarantee fault isolation
    for (let i = 0; i < rawRows.length; i++) {
      const rowIndex = i + 1;
      const raw = rawRows[i];

      // 1. Sanitize and normalize raw fields
      const normalized = this.sanitizeRow(raw, autoGenerateSku);

      // 2. Validate with Zod schema
      const parseResult = BulkProductRowSchema.safeParse(normalized);
      if (!parseResult.success) {
        const issue = parseResult.error.issues[0];
        errors.push({
          row_index: rowIndex,
          sku: normalized.sku || "UNKNOWN",
          field: issue.path.join(".") || "row",
          value: issue.path.length > 0 ? (normalized as any)[issue.path[0]] : undefined,
          reason: issue.message,
          raw_data: raw,
        });
        continue;
      }

      const row: BulkProductImportRow = parseResult.data as BulkProductImportRow;

      // 3. Intra-file duplicate SKU check
      const upperSku = row.sku.toUpperCase();
      if (seenBatchSkus.has(upperSku)) {
        errors.push({
          row_index: rowIndex,
          sku: upperSku,
          field: "sku",
          value: upperSku,
          reason: `Duplicate SKU '${upperSku}' encountered in the same file (first seen in row ${seenBatchSkus.get(upperSku)}).`,
          raw_data: raw,
        });
        continue;
      }
      seenBatchSkus.set(upperSku, rowIndex);

      // 4. Category Resolution (Option A: Auto-create category if unrecognized)
      let resolvedCategoryId: string | undefined;
      if (row.category && row.category.trim().length > 0) {
        const catKey = row.category.toLowerCase().trim();
        let cat = categoryMap.get(catKey);

        if (!cat && autoCreateCategories) {
          try {
            if (!dryRun) {
              cat = await CategoryService.createCategory(context, {
                name: row.category.trim(),
                description: `Auto-created during bulk product import (${batchId})`,
              });
              categoryMap.set(catKey, cat);
              categoryMap.set(cat.slug.toLowerCase(), cat);
              if (!createdCategoryNames.includes(cat.name)) {
                createdCategoryNames.push(cat.name);
              }
            } else {
              if (!createdCategoryNames.includes(row.category.trim())) {
                createdCategoryNames.push(row.category.trim());
              }
            }
          } catch (err: any) {
            console.warn(`[BulkImport] Failed to auto-create category '${row.category}':`, err.message);
          }
        }
        if (cat) {
          resolvedCategoryId = cat.id;
        }
      }

      // 5. Database lookup for existing SKU
      const existingProduct = db.findProductBySku(context.tenant.id, upperSku);

      try {
        if (existingProduct) {
          // SKU exists
          if (mode === "create_only") {
            errors.push({
              row_index: rowIndex,
              sku: upperSku,
              field: "sku",
              value: upperSku,
              reason: `SKU '${upperSku}' already exists in catalog. Mode is 'create_only'.`,
              raw_data: raw,
            });
            continue;
          }

          // Execute Update
          if (!dryRun) {
            const updates: Partial<Product> = {
              name: row.title,
              base_price: row.base_price,
              compare_at_price: row.compare_at_price,
              cost_price: row.cost_price,
              description: row.description || existingProduct.description,
              category_id: resolvedCategoryId || existingProduct.category_id,
              status: row.status || existingProduct.status,
            };
            if (row.images && row.images.length > 0) {
              updates.images = row.images;
              updates.primary_image = row.images[0];
            }

            db.updateProduct(context.tenant.id, existingProduct.id, updates);

            // If stock update was provided, adjust inventory item
            if (row.stock !== undefined && row.stock >= 0 && defaultWarehouse) {
              const defaultVariant = db.data.product_variants.find(
                (v) => v.product_id === existingProduct.id && v.tenant_id === context.tenant.id
              );
              if (defaultVariant) {
                const invItem = db.data.inventory_items.find(
                  (i) =>
                    i.product_variant_id === defaultVariant.id &&
                    i.warehouse_id === defaultWarehouse.id &&
                    i.tenant_id === context.tenant.id
                );
                if (invItem) {
                  const delta = row.stock - invItem.quantity_on_hand;
                  invItem.quantity_on_hand = row.stock;
                  invItem.quantity_available = Math.max(0, row.stock - invItem.quantity_reserved);
                  invItem.updated_at = new Date().toISOString();

                  if (delta !== 0) {
                    db.data.stock_movements.push({
                      id: `sm_${Date.now()}_adj_${randomSuffix()}`,
                      tenant_id: context.tenant.id,
                      warehouse_id: defaultWarehouse.id,
                      product_variant_id: defaultVariant.id,
                      type: delta > 0 ? "PURCHASE" : "ADJUSTMENT",
                      quantity: Math.abs(delta),
                      reason: `Bulk import stock synchronization (${batchId})`,
                      actor_user_id: context.user.id,
                      created_at: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }

          updatedCount++;
          successfulSkus.push(upperSku);
        } else {
          // SKU does not exist
          if (mode === "update_only") {
            errors.push({
              row_index: rowIndex,
              sku: upperSku,
              field: "sku",
              value: upperSku,
              reason: `SKU '${upperSku}' does not exist in catalog. Mode is 'update_only'.`,
              raw_data: raw,
            });
            continue;
          }

          // Execute Insert
          if (!dryRun) {
            let baseSlug = ProductService.generateSlug(row.title);
            let candidateSlug = baseSlug;
            let counter = 1;
            while (db.findProductBySlug(context.tenant.id, candidateSlug)) {
              counter++;
              candidateSlug = `${baseSlug}-${counter}`;
            }

            const productId = `prod_${Date.now()}_${randomSuffix()}`;
            const now = new Date().toISOString();

            const newProduct: Product = {
              id: productId,
              tenant_id: context.tenant.id,
              name: row.title,
              slug: candidateSlug,
              description: row.description || "",
              short_description: row.short_description || "",
              category_id: resolvedCategoryId,
              sku: upperSku,
              base_price: row.base_price,
              compare_at_price: row.compare_at_price,
              cost_price: row.cost_price,
              currency: "BDT",
              status: row.status || "ACTIVE",
              images: row.images || [],
              primary_image: row.images?.[0] || "",
              created_at: now,
              updated_at: now,
            };

            db.createProduct(newProduct, row.stock || 0);
          }

          importedCount++;
          successfulSkus.push(upperSku);
        }
      } catch (opErr: any) {
        errors.push({
          row_index: rowIndex,
          sku: upperSku,
          field: "database",
          reason: opErr.message || "Failed to persist product record.",
          raw_data: raw,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // 6. Record Audit Log
    if (!dryRun && (importedCount > 0 || updatedCount > 0)) {
      db.createAuditLog({
        id: `aud_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        actor_user_id: context.user.id,
        action: "PRODUCT_BULK_IMPORT",
        resource_type: "catalog",
        resource_id: batchId,
        metadata: {
          batch_id: batchId,
          total_rows: rawRows.length,
          imported_count: importedCount,
          updated_count: updatedCount,
          failed_count: errors.length,
          mode,
          duration_ms: durationMs,
        },
        created_at: new Date().toISOString(),
      });
    }

    db.markDirty();
    return {
      batch_id: batchId,
      total_rows: rawRows.length,
      imported_count: importedCount,
      updated_count: updatedCount,
      failed_count: errors.length,
      successful_skus: successfulSkus,
      created_categories: createdCategoryNames,
      errors,
      duration_ms: durationMs,
      dry_run: dryRun,
    };
  }

  /**
   * Clean and normalize raw spreadsheet strings, currency symbols, and image lists
   */
  private static sanitizeRow(raw: Record<string, any>, autoGenerateSku: boolean): Record<string, any> {
    // 1. Normalize all keys via CsvParser.normalizeHeader
    const norm: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      norm[CsvParser.normalizeHeader(k)] = v;
    }

    const title = (norm.title || norm.name || norm.product_name || norm.item_name || "").toString().trim();

    let sku = (norm.sku || norm.item_code || norm.product_code || norm.barcode || "").toString().trim();
    if (!sku && autoGenerateSku && title.length > 0) {
      const prefix = title.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "SKU");
      sku = `SKU-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const parseNum = (val: any): number | undefined => {
      if (val === null || val === undefined || val === "") return undefined;
      if (typeof val === "number") return isNaN(val) ? undefined : val;
      // Strip currency signs (৳, $, BDT), commas, whitespace, and unit words (pcs, units)
      const cleaned = val.toString().replace(/[৳$BDT,pcsunits\s]/gi, "").trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? undefined : num;
    };

    const parseIntVal = (val: any): number | undefined => {
      const num = parseNum(val);
      return num !== undefined ? Math.floor(num) : undefined;
    };

    // Images parsing: handle array or comma/pipe/newline-separated URLs
    let images: string[] = [];
    if (Array.isArray(norm.images)) {
      images = norm.images.map((img: any) => String(img).trim()).filter(Boolean);
    } else if (typeof norm.images === "string" && norm.images.trim().length > 0) {
      images = norm.images
        .split(/[,;\n|]/)
        .map((img: string) => img.trim())
        .filter((img: string) => img.startsWith("http://") || img.startsWith("https://"));
    } else if (norm.image && typeof norm.image === "string") {
      images = [norm.image.trim()];
    }

    return {
      title,
      sku,
      base_price: parseNum(norm.base_price ?? norm.price ?? norm.unit_price ?? norm.mrp),
      compare_at_price: parseNum(norm.compare_at_price ?? norm.compare_price ?? norm.old_price),
      cost_price: parseNum(norm.cost_price ?? norm.cost ?? norm.purchase_price),
      stock: parseIntVal(norm.stock ?? norm.quantity ?? norm.qty ?? norm.initial_stock) ?? 0,
      category: (norm.category ?? norm.category_name ?? norm.collection ?? "").toString().trim() || undefined,
      brand: (norm.brand ?? norm.brand_name ?? "").toString().trim() || undefined,
      description: (norm.description ?? norm.desc ?? norm.details ?? "").toString().trim(),
      short_description: (norm.short_description ?? norm.summary ?? "").toString().trim(),
      images,
      status: (norm.status ?? "ACTIVE").toString().toUpperCase(),
      warehouse_code: norm.warehouse_code?.toString().trim() || undefined,
    };
  }
}
