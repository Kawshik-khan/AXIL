import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Procurement Operations Service
 * Manages supplier catalog, automated replenishment drafting, purchase order lifecycle,
 * MOQ constraints, lead-time optimization, and supplier performance tracking.
 */

import { db } from "@/infrastructure/db";
import {
  Supplier,
  SupplierProduct,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  ProcurementRecommendation,
} from "@/types/operations";
import { inventoryOperationsService } from "./inventory-operations.service";

export class ProcurementService {
  /**
   * Generates replenishment recommendations based on stockout risks and supplier constraints
   */
  public generateReplenishmentRecommendations(tenantId: string): ProcurementRecommendation[] {
    const risks = inventoryOperationsService.evaluateStockoutRisks(tenantId);
    const criticalOrHigh = risks.filter((r) => r.risk_level === "CRITICAL" || r.risk_level === "HIGH" || r.risk_level === "MEDIUM");
    const suppliers = db.getSuppliers(tenantId).filter((s) => s.status === "ACTIVE");
    const supplierProducts = db.getSupplierProducts(tenantId);
    const recommendations: ProcurementRecommendation[] = [];

    for (const risk of criticalOrHigh) {
      // Find eligible suppliers for this variant
      const eligibleSPs = supplierProducts.filter((sp) => sp.product_variant_id === risk.variant_id);
      if (eligibleSPs.length === 0) continue;

      // Select preferred or lowest cost supplier
      eligibleSPs.sort((a, b) => {
        if (a.is_preferred && !b.is_preferred) return -1;
        if (!a.is_preferred && b.is_preferred) return 1;
        return a.cost_price - b.cost_price;
      });

      const chosenSP = eligibleSPs[0];
      const chosenSupplier = suppliers.find((s) => s.id === chosenSP.supplier_id);
      if (!chosenSupplier) continue;

      // Adhere to MOQ constraints
      const rawQty = risk.recommended_reorder_quantity;
      const orderQty = Math.max(rawQty, chosenSP.moq);
      const estCost = orderQty * chosenSP.cost_price;

      const rec: ProcurementRecommendation = {
        id: `prec_${risk.variant_id}_${Date.now()}`,
        tenant_id: tenantId,
        product_variant_id: risk.variant_id,
        sku: risk.sku,
        product_name: risk.product_name,
        current_stock: risk.current_available,
        forecasted_demand_30d: Math.round(risk.daily_sales_velocity * 30),
        recommended_quantity: orderQty,
        recommended_order_quantity: orderQty,
        recommended_supplier_id: chosenSupplier.id,
        supplier_id: chosenSupplier.id,
        supplier_name: chosenSupplier.name,
        unit_cost: chosenSP.cost_price,
        estimated_cost: estCost,
        reason: `Forward stockout risk (${risk.days_of_supply_remaining} days supply). MOQ: ${chosenSP.moq} units.`,
        priority: risk.risk_level === "CRITICAL" ? "URGENT" : risk.risk_level === "HIGH" ? "HIGH" : "MEDIUM",
        status: "PENDING",
        created_at: new Date().toISOString(),
      };

      db.createProcurementRecommendation(rec);
      recommendations.push(rec);
    }

    return recommendations;
  }

  /**
   * Drafts a new Purchase Order for a supplier with MOQ validation
   */
  public createPurchaseOrderDraft(
    tenantId: string,
    params: {
      supplierId: string;
      items: Array<{ variantId: string; quantity: number }>;
      notes?: string;
    }
  ): PurchaseOrder {
    const supplier = db.findSupplierById(tenantId, params.supplierId);
    if (!supplier) throw new AppError("NOT_FOUND", `Supplier not found: ${params.supplierId}`, 404);

    const supplierProducts = db.getSupplierProducts(tenantId, params.supplierId);
    const variants = db.getAllProductVariants(tenantId);
    const poItems: PurchaseOrderItem[] = [];
    let totalAmount = 0;
    const poId = `po_${Date.now()}_${randomSuffix()}`;

    for (const item of params.items) {
      const sp = supplierProducts.find((p) => p.product_variant_id === item.variantId);
      if (!sp) throw new Error(`Supplier ${supplier.name} does not provide variant ${item.variantId}`);

      const variant = variants.find((v) => v.id === item.variantId);
      const orderQty = Math.max(item.quantity, sp.moq);
      const subtotal = orderQty * sp.cost_price;
      totalAmount += subtotal;

      poItems.push({
        id: `poi_${randomSuffix()}`,
        purchase_order_id: poId,
        product_variant_id: item.variantId,
        sku: sp.supplier_sku || variant?.sku || "SKU",
        product_name: variant?.title || "Product Item",
        quantity_ordered: orderQty,
        quantity_received: 0,
        unit_cost: sp.cost_price,
        subtotal,
      });
    }

    const expectedDate = new Date(Date.now() + supplier.lead_time_days * 86400000).toISOString();
    const poNumber = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const po: PurchaseOrder = {
      id: poId,
      tenant_id: tenantId,
      po_number: poNumber,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      status: "PENDING_APPROVAL",
      items: poItems,
      total_amount: totalAmount,
      currency: "BDT",
      expected_delivery_date: expectedDate,
      notes: params.notes || "Autonomous operational replenishment draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createPurchaseOrder(po);
  }

  /**
   * Advances purchase order through state machine transitions
   */
  public transitionPurchaseOrderStatus(
    tenantId: string,
    poId: string,
    targetStatus: PurchaseOrderStatus,
    actor: string
  ): PurchaseOrder {
    const po = db.findPurchaseOrderById(tenantId, poId);
    if (!po) throw new AppError("NOT_FOUND", `Purchase order not found: ${poId}`, 404);

    const validTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
      DRAFT: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
      PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
      APPROVED: ["SENT", "CANCELLED"],
      SENT: ["ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
      ACKNOWLEDGED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
      PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
      RECEIVED: [],
      CANCELLED: [],
    };

    if (!validTransitions[po.status].includes(targetStatus)) {
      throw new Error(`Invalid PurchaseOrder transition from ${po.status} to ${targetStatus}`);
    }

    const updates: Partial<PurchaseOrder> = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };

    if (targetStatus === "APPROVED") {
      updates.approved_by = actor;
      updates.approved_at = new Date().toISOString();
    } else if (targetStatus === "SENT") {
      updates.sent_at = new Date().toISOString();
    } else if (targetStatus === "RECEIVED") {
      updates.received_at = new Date().toISOString();

      // On receipt, automatically adjust stock in default warehouse
      const defaultWh = db.getWarehouses(tenantId)[0];
      if (defaultWh) {
        for (const item of po.items) {
          const qtyToReceive = item.quantity_ordered - item.quantity_received;
          if (qtyToReceive > 0) {
            db.adjustStock(tenantId, {
              warehouse_id: defaultWh.id,
              product_variant_id: item.product_variant_id,
              quantity_delta: qtyToReceive,
              type: "PURCHASE",
              reason: `Received Purchase Order ${po.po_number}`,
              actor_user_id: actor,
              reference_type: "PURCHASE_ORDER",
              reference_id: po.id,
              allow_overselling: true,
            });
            item.quantity_received = item.quantity_ordered;
          }
        }
        updates.items = po.items;
      }
    }

    return db.updatePurchaseOrder(tenantId, poId, updates);
  }
}

export const procurementService = new ProcurementService();
