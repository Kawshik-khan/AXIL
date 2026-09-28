import { AppError, IntegrationNotConfiguredError } from "@/lib/errors";
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
  ): never {
    void actor;
    const exception = db.getShipmentExceptions(tenantId).find((se) => se.id === shipmentExceptionId);
    if (!exception) throw new AppError("NOT_FOUND", `Shipment exception not found: ${shipmentExceptionId}`, 404);

    const oldShipment = db.findShipmentById(tenantId, exception.shipment_id);
    if (!oldShipment) throw new AppError("NOT_FOUND", `Shipment not found: ${exception.shipment_id}`, 404);

    const oldCourier = oldShipment.courier_provider;
    const alternateCourier = providerHealthService.getAlternateCourier(tenantId, oldCourier);

    // No courier API is integrated, so the parcel can't be rebooked automatically. This used to cancel the real
    // shipment, create a booking with an invented tracking number and mark the exception resolved (FX-31).
    throw new IntegrationNotConfiguredError(
      `${alternateCourier} booking`,
      `book the parcel with ${alternateCourier} yourself and record its tracking number; the ${oldCourier} shipment was not changed`
    );
  }
}

export const courierOperationsService = new CourierOperationsService();
