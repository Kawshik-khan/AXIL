import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Autonomous Courier Operations & Failover Service
 * Ingests courier telemetry, monitors transit exceptions, and executes provider failover
 * when primary courier outages or severe degradation are detected.
 */

import { db } from "@/infrastructure/db";
import { ShipmentException, ShipmentExceptionType } from "@/types/operations";
import { CourierProviderName, Shipment } from "@/types/commerce";
import { providerHealthService } from "./provider-health.service";

export class CourierOperationsService {
  /**
   * Scans active shipments and identifies delayed or stuck parcels
   */
  public detectShipmentExceptions(tenantId: string): ShipmentException[] {
    const shipments = db.getShipments(tenantId);
    const existingExceptions = db.getShipmentExceptions(tenantId);
    const exceptions: ShipmentException[] = [];
    const now = Date.now();

    for (const shipment of shipments) {
      if (shipment.status === "DELIVERED" || shipment.status === "CANCELLED" || shipment.status === "RETURNED") {
        continue;
      }

      const hoursInTransit = (now - new Date(shipment.created_at).getTime()) / 3600000;
      const alreadyLogged = existingExceptions.some((e) => e.shipment_id === shipment.id && e.status !== "RESOLVED");

      if (!alreadyLogged && hoursInTransit > 36) {
        const exc: ShipmentException = {
          id: `se_${shipment.id}_${Date.now()}`,
          tenant_id: tenantId,
          shipment_id: shipment.id,
          order_id: shipment.order_id,
          tracking_number: shipment.tracking_number,
          courier_provider: shipment.courier_provider,
          exception_type: "DELAYED_TRANSIT",
          severity: hoursInTransit > 60 ? "HIGH" : "MEDIUM",
          details: `Shipment ${shipment.tracking_number} in transit for ${Math.round(hoursInTransit)}h without delivery scan.`,
          status: "DETECTED",
          detected_at: new Date().toISOString(),
        };

        db.createShipmentException(exc);
        exceptions.push(exc);
      }
    }

    return exceptions;
  }

  /**
   * Automatically executes failover for an impacted shipment to a healthy alternate courier
   */
  public executeCourierFailover(
    tenantId: string,
    shipmentExceptionId: string,
    actor: string
  ): {
    success: boolean;
    oldCourier: CourierProviderName;
    newCourier: CourierProviderName;
    newShipment: Shipment;
  } {
    const exception = db.getShipmentExceptions(tenantId).find((se) => se.id === shipmentExceptionId);
    if (!exception) throw new AppError("NOT_FOUND", `Shipment exception not found: ${shipmentExceptionId}`, 404);

    const oldShipment = db.findShipmentById(tenantId, exception.shipment_id);
    if (!oldShipment) throw new AppError("NOT_FOUND", `Shipment not found: ${exception.shipment_id}`, 404);

    const oldCourier = oldShipment.courier_provider;
    const alternateCourier = providerHealthService.getAlternateCourier(tenantId, oldCourier);

    // Cancel old shipment in system
    db.updateShipmentStatus(tenantId, oldShipment.id, "CANCELLED");

    // Create new shipment with alternate courier
    const newTracking = `TRK-${alternateCourier.substring(0, 3)}-${Date.now().toString().slice(-8)}`;
    const newShipmentId = `shp_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    const replacementShipment: Shipment = {
      id: newShipmentId,
      tenant_id: tenantId,
      order_id: oldShipment.order_id,
      courier_provider: alternateCourier,
      consignment_id: `CSG-FAILOVER-${Date.now()}`,
      tracking_number: newTracking,
      status: "PENDING",
      shipping_cost: oldShipment.shipping_cost,
      shipped_at: now,
      created_at: now,
      updated_at: now,
    };

    const created = db.createShipment(replacementShipment);

    // Mark exception resolved
    db.updateShipmentException(tenantId, exception.id, {
      status: "RESOLVED",
      recovery_action_taken: `Re-dispatched via alternate courier ${alternateCourier} (${newTracking}) due to ${oldCourier} transit exception.`,
      alternative_courier: alternateCourier,
      resolved_at: now,
    });

    db.createAuditLog({
      id: `aud_failover_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "COURIER_FAILOVER_EXECUTED",
      resource_type: "shipment",
      resource_id: created.id,
      metadata: { old_courier: oldCourier, new_courier: alternateCourier, exception_id: exception.id },
      created_at: now,
    });

    return {
      success: true,
      oldCourier,
      newCourier: alternateCourier,
      newShipment: created,
    };
  }
}

export const courierOperationsService = new CourierOperationsService();
