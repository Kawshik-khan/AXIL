/**
 * CommerceOS Phase 9: ERP Adapter Framework
 * Interfaces for enterprise ERP platforms (SAP, NetSuite, Odoo) with schema mapping and validation.
 */

import { db } from "@/infrastructure/db";
import { dataMappingService } from "./data-mapping.service";
import { conflictResolutionService } from "./conflict-resolution.service";
import { syncEngineService } from "./sync-engine.service";
import { IntegrationSyncRecord } from "@/types/enterprise";

export interface ExternalERPProduct {
  mat_nr: string;
  desc_text: string;
  cost_val: number;
  tax_rate_pct?: number;
  updated_ts?: string;
}

export class ErpAdapterService {
  /**
   * Ingests and synchronizes external ERP master catalog records
   */
  public async syncProducts(params: {
    organizationId: string;
    integrationId: string;
    tenantId: string;
    erpProducts: ExternalERPProduct[];
  }): Promise<IntegrationSyncRecord> {
    // Ensure default mapping exists
    const mapping = dataMappingService.createMapping(params.organizationId, params.integrationId, "PRODUCT", [
      { source_field: "mat_nr", target_field: "sku", data_type: "STRING", transformation: "UPPERCASE", is_required: true },
      { source_field: "desc_text", target_field: "title", data_type: "STRING", transformation: "TRIM", is_required: true },
      { source_field: "cost_val", target_field: "cost_price", data_type: "NUMBER", transformation: "PARSE_NUMBER", is_required: true },
    ]);

    return syncEngineService.executeSync({
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      entityType: "PRODUCT",
      syncType: "INCREMENTAL",
      direction: "INBOUND",
      items: params.erpProducts as unknown as Array<Record<string, unknown>>,
      processItemFn: async (rawItem) => {
        const canonical = dataMappingService.transformInbound(mapping, rawItem);
        const sku = canonical.sku as string;

        // Check for existing variant in Commerce Core
        const existingVariant = db.getAllProductVariants(params.tenantId).find((v) => v.sku === sku);
        if (existingVariant) {
          // Check conflict on cost_price
          const evalRes = conflictResolutionService.evaluateConflict({
            organizationId: params.organizationId,
            integrationId: params.integrationId,
            entityType: "PRODUCT_VARIANT",
            entityId: existingVariant.id,
            commerceosData: { cost_price: existingVariant.cost_price, title: existingVariant.title },
            externalData: { cost_price: canonical.cost_price, title: canonical.title },
            conflictField: "cost_price",
            configuredStrategy: "COMMERCEOS_WINS",
          });

          // Safe non-overwriting update
          db.updateProductVariant(params.tenantId, existingVariant.id, {
            cost_price: Number(evalRes.resolvedData.cost_price),
          });

          return { success: true, conflict: evalRes.hasConflict };
        }

        // Add new product variant if not exists
        const products = db.getAllProducts(params.tenantId);
        if (products.length > 0) {
          db.createProductVariant(params.tenantId, {
            product_id: products[0].id,
            sku,
            title: canonical.title as string,
            price: Number(canonical.cost_price) * 1.35, // mark up from cost
            status: "ACTIVE",
            attributes: { erp_synced: "true" },
          });
        }

        return { success: true };
      },
    });
  }

  /**
   * Synchronizes stock levels from ERP master warehouse records
   */
  public async syncInventory(params: {
    organizationId: string;
    integrationId: string;
    tenantId: string;
    warehouseId: string;
    inventoryUpdates: Array<{ sku: string; on_hand_qty: number }>;
  }): Promise<IntegrationSyncRecord> {
    return syncEngineService.executeSync({
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      entityType: "INVENTORY",
      direction: "INBOUND",
      items: params.inventoryUpdates as unknown as Array<Record<string, unknown>>,
      processItemFn: async (item) => {
        const sku = item.sku as string;
        const qty = Number(item.on_hand_qty);

        const variant = db.getAllProductVariants(params.tenantId).find((v) => v.sku === sku);
        if (!variant) return { success: false };

        const invItem = db.findInventoryItem(params.tenantId, params.warehouseId, variant.id);
        if (invItem) {
          invItem.quantity_on_hand = qty;
          invItem.quantity_available = Math.max(0, qty - invItem.quantity_reserved);
          invItem.updated_at = new Date().toISOString();
        }
        return { success: true };
      },
    });
  }
}

export const erpAdapterService = new ErpAdapterService();
