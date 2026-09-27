/**
 * CommerceOS Phase 6: Courier Status Synchronizer & Provider Adapter Service
 * Provides deterministic status normalization for Bangladeshi courier partners
 * (Steadfast, Pathao, RedX, Paperfly, eCourier, Sundarban) into canonical DeliveryStatus,
 * enforces provider circuit breaker checks, and updates CommerceOS canonical state safely.
 */

import { db } from "@/infrastructure/db";
import { CourierProviderName, DeliveryStatus, Shipment } from "@/types/commerce";
import { CourierTrackingResult } from "@/types/automation";
import { ProviderCircuitBreakerService } from "./provider-circuit-breaker.service";
import { IdempotencyService } from "./idempotency.service";

export class CourierSyncService {
  /**
   * Deterministic status mapping table for all supported Bangladeshi courier providers
   */
  public static normalizeCourierStatus(
    provider: CourierProviderName | string,
    rawStatus: string
  ): DeliveryStatus {
    const s = (rawStatus || "").toLowerCase().trim().replace(/[-_\s]+/g, "_");
    const upperProvider = (provider || "").toUpperCase();

    // 1. STEADFAST COURIER
    if (upperProvider === "STEADFAST") {
      if (["pending", "hold", "in_review", "order_placed"].includes(s)) return "PENDING";
      if (["picked_up", "picked", "at_origin_hub"].includes(s)) return "PICKED_UP";
      if (["in_transit", "transit", "received_at_hub", "transferred"].includes(s)) return "IN_TRANSIT";
      if (["out_for_delivery", "assigned_to_rider", "rider_accepted"].includes(s)) return "OUT_FOR_DELIVERY";
      if (["delivered", "partial_delivered"].includes(s)) return "DELIVERED";
      if (["cancelled", "seller_cancelled"].includes(s)) return "CANCELLED";
      if (["return", "returned", "return_in_transit", "rto"].includes(s)) return "RETURNED";
      if (["failed", "delivery_failed", "customer_refused"].includes(s)) return "FAILED";
    }

    // 2. PATHAO COURIER
    if (upperProvider === "PATHAO") {
      if (["pickup_requested", "assigned", "merchant_notified"].includes(s)) return "PENDING";
      if (["picked", "pickup_done", "arrived_hub"].includes(s)) return "PICKED_UP";
      if (["in_transit", "transit_in_progress", "sent_to_hub"].includes(s)) return "IN_TRANSIT";
      if (["out_for_delivery", "dispatched"].includes(s)) return "OUT_FOR_DELIVERY";
      if (["delivered"].includes(s)) return "DELIVERED";
      if (["returned", "return_completed"].includes(s)) return "RETURNED";
      if (["failed", "delivery_failed", "customer_unreachable"].includes(s)) return "FAILED";
      if (["cancelled", "merchant_cancelled"].includes(s)) return "CANCELLED";
    }

    // 3. REDX COURIER
    if (upperProvider === "REDX") {
      if (["ready_to_pick", "pickup_pending"].includes(s)) return "PENDING";
      if (["pickup_completed", "received_at_sorting_hub"].includes(s)) return "PICKED_UP";
      if (["in_transit", "sorting_completed"].includes(s)) return "IN_TRANSIT";
      if (["delivery_in_progress", "assigned_to_agent"].includes(s)) return "OUT_FOR_DELIVERY";
      if (["delivered", "payment_collected"].includes(s)) return "DELIVERED";
      if (["returned", "rto_completed"].includes(s)) return "RETURNED";
      if (["failed", "delivery_attempted"].includes(s)) return "FAILED";
      if (["cancelled"].includes(s)) return "CANCELLED";
    }

    // 4. PAPERFLY
    if (upperProvider === "PAPERFLY") {
      if (["order_created", "assigned"].includes(s)) return "PENDING";
      if (["picked_up", "drop_hub"].includes(s)) return "PICKED_UP";
      if (["in_transit", "linehaul"].includes(s)) return "IN_TRANSIT";
      if (["out_for_delivery", "on_route"].includes(s)) return "OUT_FOR_DELIVERY";
      if (["delivered"].includes(s)) return "DELIVERED";
      if (["returned", "return_to_origin"].includes(s)) return "RETURNED";
      if (["failed", "undelivered"].includes(s)) return "FAILED";
      if (["cancelled"].includes(s)) return "CANCELLED";
    }

    // 5. ECOURIER & SUNDARBAN
    if (["ECOURIER", "SUNDARBAN"].includes(upperProvider)) {
      if (["booking", "pending", "booked"].includes(s)) return "PENDING";
      if (["collected", "received"].includes(s)) return "PICKED_UP";
      if (["in_transit", "dispatch_hub"].includes(s)) return "IN_TRANSIT";
      if (["out_for_delivery"].includes(s)) return "OUT_FOR_DELIVERY";
      if (["delivered"].includes(s)) return "DELIVERED";
      if (["returned", "return_delivered"].includes(s)) return "RETURNED";
      if (["failed"].includes(s)) return "FAILED";
      if (["cancelled"].includes(s)) return "CANCELLED";
    }

    // Fallback standard uppercase check
    const upperRaw = rawStatus.toUpperCase().trim();
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
      ].includes(upperRaw)
    ) {
      return upperRaw as DeliveryStatus;
    }

    return "IN_TRANSIT";
  }

  /**
   * Processes an incoming courier webhook and synchronizes canonical state safely
   */
  public static async processCourierWebhook(
    tenantId: string,
    provider: CourierProviderName,
    payload: {
      tracking_number?: string;
      consignment_id?: string;
      raw_status: string;
      status_details?: string;
      location?: string;
      event_timestamp?: string;
      collected_amount?: number;
    }
  ): Promise<{ success: boolean; shipment?: Shipment; canonical_status: DeliveryStatus; message: string }> {
    const rawStatus = payload.raw_status;
    const canonicalStatus = this.normalizeCourierStatus(provider, rawStatus);

    // Find shipment by tracking number or consignment id
    const shipments = db.getShipments(tenantId);
    const shipment = shipments.find(
      (s) =>
        (payload.tracking_number && s.tracking_number === payload.tracking_number) ||
        (payload.consignment_id && s.consignment_id === payload.consignment_id)
    );

    if (!shipment) {
      return {
        success: false,
        canonical_status: canonicalStatus,
        message: `Shipment with tracking '${payload.tracking_number || payload.consignment_id}' not found for tenant '${tenantId}'.`,
      };
    }

    // Enforce idempotency: prevent processing identical status update twice
    const idempotencyKey = `csync_${shipment.id}_${canonicalStatus}_${rawStatus}`;
    const lock = IdempotencyService.acquireLock(tenantId, idempotencyKey, "COURIER_STATUS_SYNC", payload);
    if (lock.isDuplicate && lock.status === "COMPLETED") {
      return {
        success: true,
        shipment,
        canonical_status: canonicalStatus,
        message: "Status update already processed (idempotent response).",
      };
    }

    // Check circuit breaker
    if (!ProviderCircuitBreakerService.canExecute(tenantId, provider)) {
      throw new Error(`Courier provider ${provider} circuit breaker is OPEN. Deferring sync.`);
    }

    try {
      // Update shipment status in database
      const updated = db.updateShipmentStatus(tenantId, shipment.id, canonicalStatus);

      // If DELIVERED, synchronize order and COD payments
      if (canonicalStatus === "DELIVERED") {
        const order = db.findOrderById(tenantId, shipment.order_id);
        if (order) {
          db.updateOrderStatus(tenantId, order.id, "DELIVERED");
          if (order.payment_method === "COD" && order.payment_status !== "PAID") {
            const payments = db.getPayments(tenantId, order.id);
            for (const p of payments) {
              db.updatePaymentStatus(tenantId, p.id, "PAID");
            }
            db.updateOrderPaymentStatus(tenantId, order.id, "PAID");
          }
        }
      }

      // Record canonical domain event
      db.recordEvent({
        id: `evt_csync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: "shipment.updated",
        version: "1.0",
        tenant_id: tenantId,
        aggregate_type: "shipment",
        aggregate_id: shipment.id,
        actor_id: `courier_${provider.toLowerCase()}`,
        correlation_id: shipment.tracking_number,
        timestamp: new Date().toISOString(),
        payload: {
          order_id: shipment.order_id,
          courier_provider: provider,
          raw_provider_status: rawStatus,
          canonical_status: canonicalStatus,
          status_details: payload.status_details,
          location: payload.location,
        },
      });

      ProviderCircuitBreakerService.recordSuccess(tenantId, provider);
      IdempotencyService.markCompleted(tenantId, idempotencyKey, "COURIER_STATUS_SYNC", {
        shipment_id: shipment.id,
        canonical_status: canonicalStatus,
      });

      return {
        success: true,
        shipment: updated,
        canonical_status: canonicalStatus,
        message: `Shipment status normalized to '${canonicalStatus}' (provider status: '${rawStatus}').`,
      };
    } catch (err) {
      ProviderCircuitBreakerService.recordFailure(tenantId, provider);
      IdempotencyService.markFailed(tenantId, idempotencyKey, "COURIER_STATUS_SYNC");
      throw err;
    }
  }
}
