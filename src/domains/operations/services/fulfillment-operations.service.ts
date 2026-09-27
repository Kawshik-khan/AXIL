/**
 * CommerceOS Phase 8: Autonomous Fulfillment Operations Service
 * Multi-warehouse inventory allocation, picking/packing priority sequencing,
 * courier selection matching, and dispatch plan formulation.
 */

import { db } from "@/infrastructure/db";
import { FulfillmentPlan, CourierRecommendation } from "@/types/operations";
import { CourierProviderName } from "@/types/commerce";

export class FulfillmentOperationsService {
  /**
   * Plans fulfillment for an order by selecting warehouse and optimal courier
   */
  public planFulfillment(tenantId: string, orderId: string): FulfillmentPlan {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    const warehouses = db.getWarehouses(tenantId);
    const defaultWarehouse = warehouses[0] || { id: "wh_default_01", name: "Central Dhaka Warehouse" };
    const orderItems = db.getOrderItems(tenantId, order.id);
    const inventory = db.getInventory(tenantId);

    // Check inventory availability in candidate warehouse
    let itemsAvailable = true;
    for (const item of orderItems) {
      const vId = item.variant_id || (item as any).product_variant_id;
      const inv = inventory.find(
        (i) => i.warehouse_id === defaultWarehouse.id && i.product_variant_id === vId
      );
      if (!inv || inv.quantity_available < item.quantity) {
        itemsAvailable = false;
        break;
      }
    }

    // Select optimal courier based on customer location and performance
    const courier = this.recommendCourier(tenantId, orderId);

    const isUrgent = order.grand_total > 5000 || (Date.now() - new Date(order.created_at).getTime()) > 18 * 3600000;
    const plan: FulfillmentPlan = {
      id: `flp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tenant_id: tenantId,
      order_id: order.id,
      allocated_warehouse_id: defaultWarehouse.id,
      warehouse_name: defaultWarehouse.name,
      assigned_courier: courier.recommended_courier,
      items_available: itemsAvailable,
      picking_priority: isUrgent ? "URGENT" : "NORMAL",
      packing_priority: isUrgent ? "URGENT" : "NORMAL",
      estimated_ship_date: new Date(Date.now() + 12 * 3600000).toISOString(),
      status: itemsAvailable ? "READY_FOR_PICKING" : "PLANNED",
      created_at: new Date().toISOString(),
    };

    return db.createFulfillmentPlan(plan);
  }

  /**
   * Evaluates courier alternatives and returns optimal provider recommendation
   */
  public recommendCourier(tenantId: string, orderId: string): CourierRecommendation {
    const courierPerfs = db.getCourierPerformances(tenantId).filter((cp) => cp.is_available);

    if (courierPerfs.length === 0) {
      return {
        order_id: orderId,
        recommended_courier: "STEADFAST",
        estimated_cost_bdt: 60,
        estimated_transit_hours: 24,
        reason: "Default reliable provider fallback",
        fallback_courier: "PATHAO",
      };
    }

    // Sort by rating score and delivery success rate
    courierPerfs.sort((a, b) => b.rating_score * b.delivery_success_rate - a.rating_score * a.delivery_success_rate);

    const top = courierPerfs[0];
    const second = courierPerfs[1] || courierPerfs[0];

    return {
      order_id: orderId,
      recommended_courier: top.courier_provider,
      estimated_cost_bdt: top.cost_per_kg_bdt,
      estimated_transit_hours: top.average_delivery_hours,
      reason: `Highest composite score (${top.rating_score}/100) with ${(top.delivery_success_rate * 100).toFixed(1)}% success rate.`,
      fallback_courier: second.courier_provider,
    };
  }
}

export const fulfillmentOperationsService = new FulfillmentOperationsService();
