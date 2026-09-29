import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { OrderLifecycleService } from "@/domains/orders/order-lifecycle.service";
import {
  Shipment,
  CourierProviderName,
  DeliveryStatus,
} from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError, ValidationError, ConflictError } from "@/lib/errors";

export class ShippingService {
  /**
   * Normalization layer: maps diverse Bangladeshi courier statuses into canonical DeliveryStatus
   */
  public static mapCourierStatus(
    courier: CourierProviderName,
    rawExternalStatus: string
  ): DeliveryStatus {
    const s = rawExternalStatus.toLowerCase().trim();

    // Steadfast status mapping
    if (courier === "STEADFAST") {
      if (s === "pending" || s === "hold") return "PENDING";
      if (s === "in_transit" || s === "picked_up") return "IN_TRANSIT";
      if (s === "out_for_delivery") return "OUT_FOR_DELIVERY";
      if (s === "delivered") return "DELIVERED";
      if (s === "cancelled") return "CANCELLED";
      if (s === "return" || s === "returned") return "RETURNED";
    }

    // Pathao status mapping
    if (courier === "PATHAO") {
      if (s === "pickup_requested" || s === "assigned") return "PENDING";
      if (s === "picked") return "PICKED_UP";
      if (s === "in_transit") return "IN_TRANSIT";
      if (s === "delivered") return "DELIVERED";
      if (s === "returned") return "RETURNED";
      if (s === "failed") return "FAILED";
    }

    // RedX status mapping
    if (courier === "REDX") {
      if (s === "ready_to_pick") return "PENDING";
      if (s === "pickup_completed") return "PICKED_UP";
      if (s === "delivery_in_progress") return "OUT_FOR_DELIVERY";
      if (s === "delivered") return "DELIVERED";
      if (s === "returned") return "RETURNED";
    }

    // Fallback standard uppercase check
    if (
      [
        "PENDING",
        "PICKED_UP",
        "IN_TRANSIT",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "FAILED",
        "RETURNED",
        "CANCELLED",
      ].includes(rawExternalStatus.toUpperCase())
    ) {
      return rawExternalStatus.toUpperCase() as DeliveryStatus;
    }

    return "IN_TRANSIT";
  }

  public static async listShipments(
    context: RequestContext,
    orderId?: string
  ): Promise<Shipment[]> {
    RbacService.assertCan(context, PERMISSIONS.SHIPMENTS_READ);
    return db.getShipments(context.tenant.id, orderId);
  }

  public static async createShipment(
    context: RequestContext,
    payload: {
      order_id: string;
      courier_provider: CourierProviderName;
      tracking_number?: string;
      shipping_cost?: number;
      consignment_id?: string;
    }
  ): Promise<Shipment> {
    RbacService.assertCan(context, PERMISSIONS.SHIPMENTS_CREATE);

    const order = db.findOrderById(context.tenant.id, payload.order_id);
    if (!order) {
      throw new NotFoundError(`Order '${payload.order_id}' not found.`);
    }

    // No courier API is integrated, so CommerceOS can't book the parcel: the merchant books it with the courier and
    // records the courier's tracking number. This used to invent TRK-/CSG- numbers that no courier knew (FX-31).
    const trackingNumber = payload.tracking_number?.trim();
    if (!trackingNumber) {
      throw new ValidationError(
        `Enter the tracking number from ${payload.courier_provider}: booking with the courier isn't integrated yet, so CommerceOS can't create one.`
      );
    }

    // Only orders on their way to fulfilment can be shipped (FX-35)
    if (!["CONFIRMED", "PROCESSING", "READY_TO_SHIP"].includes(order.status)) {
      throw new ConflictError(`A ${order.status} order can't be shipped.`, { status: order.status });
    }

    const shipmentId = `shp_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    const newShipment: Shipment = {
      id: shipmentId,
      tenant_id: context.tenant.id,
      order_id: payload.order_id,
      courier_provider: payload.courier_provider,
      consignment_id: payload.consignment_id?.trim() || undefined,
      tracking_number: trackingNumber,
      booking_mode: "MANUAL",
      status: "PENDING",
      shipping_cost: payload.shipping_cost || order.shipping_total,
      shipped_at: now,
      created_at: now,
      updated_at: now,
    };

    const created = db.createShipment(newShipment);

    // The booking moves the order to READY_TO_SHIP through the lifecycle (FX-35)
    if (order.status !== "READY_TO_SHIP") {
      OrderLifecycleService.advance(context.tenant.id, order.id, "READY_TO_SHIP", { type: "SYSTEM", id: context.user.id }, `Shipment ${trackingNumber} booked`);
    }
    db.updateOrderFulfillmentStatus(context.tenant.id, order.id, "FULFILLED");

    db.recordEvent({
      id: `evt_${Date.now()}_shipment_created_${randomSuffix()}`,
      type: "shipment.created",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "shipment",
      aggregate_id: shipmentId,
      actor_id: context.user.id,
      correlation_id: trackingNumber,
      timestamp: now,
      payload: {
        order_id: order.id,
        courier: payload.courier_provider,
        tracking_number: trackingNumber,
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "SHIPMENT_CREATED",
      resource_type: "shipment",
      resource_id: shipmentId,
      metadata: { courier: payload.courier_provider, tracking: trackingNumber },
      created_at: now,
    });

    return created;
  }

  public static async updateDeliveryStatus(
    context: RequestContext,
    shipmentId: string,
    targetStatus: DeliveryStatus
  ): Promise<Shipment> {
    RbacService.assertCan(context, PERMISSIONS.SHIPMENTS_UPDATE);

    const shipment = db.findShipmentById(context.tenant.id, shipmentId);
    if (!shipment) {
      throw new NotFoundError(`Shipment '${shipmentId}' not found.`);
    }

    // The order follows the shipment, through the lifecycle, before the shipment changes: a delivery on a cancelled
    // order is a 409 and an exception to review, not a revived order (FX-35). COD is marked paid there too.
    const orderTarget =
      targetStatus === "DELIVERED" ? "DELIVERED" : ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(targetStatus) ? "SHIPPED" : null;
    if (orderTarget) {
      const order = db.findOrderById(context.tenant.id, shipment.order_id);
      if (order && order.status !== orderTarget && !(orderTarget === "SHIPPED" && order.status === "DELIVERED")) {
        // Moving the order (and marking COD paid) is an order change, not only a shipment one (security review)
        RbacService.assertCan(context, PERMISSIONS.ORDERS_UPDATE);
        OrderLifecycleService.advance(context.tenant.id, order.id, orderTarget, { type: "SYSTEM", id: context.user.id }, `Shipment ${shipment.tracking_number} is ${targetStatus}`);
      }
    }

    const updated = db.updateShipmentStatus(context.tenant.id, shipmentId, targetStatus);
    if (!updated) {
      throw new NotFoundError(`Could not update shipment '${shipmentId}'.`);
    }

    db.recordEvent({
      id: `evt_${Date.now()}_shipment_updated_${randomSuffix()}`,
      type: "shipment.updated",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "shipment",
      aggregate_id: shipmentId,
      actor_id: context.user.id,
      correlation_id: shipment.tracking_number,
      timestamp: new Date().toISOString(),
      payload: {
        order_id: shipment.order_id,
        status: targetStatus,
      },
    });

    return updated;
  }
}
