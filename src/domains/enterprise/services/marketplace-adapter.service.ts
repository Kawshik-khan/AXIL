import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Marketplace Adapter Framework
 * Ingests external orders (Daraz, Amazon, Shopify) and normalizes into Commerce Core canonical models.
 */

import { db } from "@/infrastructure/db";
import { OrderItem } from "@/types/commerce";
import { dataMappingService } from "./data-mapping.service";
import { syncEngineService } from "./sync-engine.service";
import { IntegrationSyncRecord } from "@/types/enterprise";

export interface ExternalMarketplaceOrder {
  marketplace_order_id: string;
  channel: "DARAZ" | "AMAZON" | "SHOPIFY";
  customer_phone: string;
  customer_name: string;
  shipping_address: string;
  items: Array<{ sku: string; quantity: number; unit_price: number }>;
  payment_method: "COD" | "PREPAID";
  total_val: number;
}

export class MarketplaceAdapterService {
  /**
   * Syncs external marketplace orders into Commerce Core
   */
  public async ingestMarketplaceOrders(params: {
    organizationId: string;
    integrationId: string;
    tenantId: string;
    rawOrders: ExternalMarketplaceOrder[];
  }): Promise<IntegrationSyncRecord> {
    return syncEngineService.executeSync({
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      entityType: "ORDER",
      direction: "INBOUND",
      items: params.rawOrders as unknown as Array<Record<string, unknown>>,
      processItemFn: async (rawItem: Record<string, unknown>) => {
        const extOrder = rawItem as unknown as ExternalMarketplaceOrder;

        // Verify customer exists or create
        let customer = db.findCustomerByPhone(params.tenantId, extOrder.customer_phone);
        if (!customer) {
          customer = db.createCustomer({
            id: `cust_mp_${Date.now()}_${randomSuffix()}`,
            tenant_id: params.tenantId,
            first_name: extOrder.customer_name || "Marketplace",
            last_name: "Customer",
            phone: extOrder.customer_phone,
            status: "ACTIVE",
            source: "WEBSITE",
            total_orders: 0,
            total_spent: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }

        const orderId = `ord_mp_${extOrder.channel.toLowerCase()}_${extOrder.marketplace_order_id}`;

        // Map items to variants
        const orderItems: OrderItem[] = extOrder.items.map((item) => {
          const variant = db.getAllProductVariants(params.tenantId).find((v) => v.sku === item.sku);
          return {
            id: `oi_mp_${randomSuffix()}`,
            tenant_id: params.tenantId,
            order_id: orderId,
            product_id: variant?.product_id || "prod_unknown",
            variant_id: variant?.id || "var_unknown",
            product_name_snapshot: variant?.title || item.sku,
            sku_snapshot: item.sku,
            unit_price: item.unit_price,
            quantity: item.quantity,
            discount: 0,
            tax: 0,
            line_total: item.quantity * item.unit_price,
          };
        });

        // Create canonical order in Commerce Core
        db.createOrder(
          {
            id: orderId,
            tenant_id: params.tenantId,
            order_number: `${extOrder.channel}-${extOrder.marketplace_order_id}`,
            customer_id: customer.id,
            status: "CONFIRMED",
            currency: "BDT",
            subtotal: extOrder.total_val,
            discount_total: 0,
            shipping_total: 0,
            tax_total: 0,
            grand_total: extOrder.total_val,
            payment_method: "COD",
            payment_status: extOrder.payment_method === "PREPAID" ? "PAID" : "PENDING",
            fulfillment_status: "UNFULFILLED",
            shipping_address_snapshot: {
              address_line_1: extOrder.shipping_address || "Marketplace delivery address",
              phone: extOrder.customer_phone,
            },
            notes: `Ingested from ${extOrder.channel} (ID: ${extOrder.marketplace_order_id})`,
            source: "WEBSITE",
            items: orderItems,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          orderItems
        );

        return { success: true };
      },
    });
  }
}

export const marketplaceAdapterService = new MarketplaceAdapterService();
