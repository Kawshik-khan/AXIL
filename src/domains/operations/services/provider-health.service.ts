/**
 * CommerceOS Phase 8: Provider Health & Resiliency Engine
 * Tracks health, latency, error rates, circuit breakers, and automatic failovers
 * for payment gateways, couriers, and messaging channels.
 */

import { db } from "@/infrastructure/db";
import { ProviderHealth, ProviderIncident, ProviderStatus, ProviderType } from "@/types/operations";
import { CourierProviderName, PaymentMethod } from "@/types/commerce";
import { randomSuffix } from "@/lib/ids";

export class ProviderHealthService {
  /**
   * Returns all provider health entries for a tenant
   */
  public getProviders(tenantId: string): ProviderHealth[] {
    return db.getProviderHealthList(tenantId);
  }

  /**
   * Returns a key-value mapping of provider status by provider ID
   */
  public getProviderHealthMap(tenantId: string): Record<string, ProviderStatus> {
    const list = db.getProviderHealthList(tenantId);
    const map: Record<string, ProviderStatus> = {};
    for (const p of list) {
      map[p.provider_id] = p.status;
    }
    return map;
  }

  /**
   * Records a provider call telemetry event and updates health metrics
   */
  public recordCall(
    tenantId: string,
    providerId: string,
    params: {
      success: boolean;
      latencyMs: number;
      errorCode?: string;
    }
  ): ProviderHealth {
    let ph = db.getProviderHealth(tenantId, providerId);
    const now = new Date().toISOString();

    if (!ph) {
      ph = {
        id: `ph_${tenantId}_${providerId}`, // one row per workspace and provider; the id was shared across tenants
        tenant_id: tenantId,
        provider_id: providerId,
        provider_name: providerId.toUpperCase(),
        provider_type: providerId.includes("steadfast") || providerId.includes("pathao") || providerId.includes("redx") ? "COURIER" : "PAYMENT_GATEWAY",
        status: "HEALTHY",
        latency_ms: params.latencyMs,
        success_rate_percent: params.success ? 100 : 0,
        consecutive_failures: params.success ? 0 : 1,
        circuit_breaker_open: false,
        last_checked_at: now,
      };
    } else {
      // Exponential moving average for latency
      ph.latency_ms = Math.round(ph.latency_ms * 0.7 + params.latencyMs * 0.3);

      if (params.success) {
        ph.consecutive_failures = 0;
        ph.success_rate_percent = Math.min(100, Math.round(ph.success_rate_percent * 0.9 + 10));
        if (ph.status === "DEGRADED" && ph.consecutive_failures === 0) {
          ph.status = "HEALTHY";
        }
      } else {
        ph.consecutive_failures += 1;
        ph.success_rate_percent = Math.max(0, Math.round(ph.success_rate_percent * 0.8));

        // Circuit breaker threshold
        if (ph.consecutive_failures >= 5) {
          ph.status = "UNAVAILABLE";
          ph.circuit_breaker_open = true;

          // Auto-record incident if not already active
          this.triggerIncident(tenantId, providerId, `Circuit breaker opened after ${ph.consecutive_failures} consecutive failures. Error: ${params.errorCode || "TIMEOUT"}`);
        } else if (ph.consecutive_failures >= 2) {
          ph.status = "DEGRADED";
        }
      }
      ph.last_checked_at = now;
    }

    db.upsertProviderHealth(ph);
    return ph;
  }

  /**
   * Triggers an active incident and activates failover if configured
   */
  public triggerIncident(
    tenantId: string,
    providerId: string,
    message: string
  ): ProviderIncident {
    const existingIncidents = db.getProviderIncidents(tenantId).filter(
      (i) => i.provider_id === providerId && i.status === "ACTIVE"
    );
    if (existingIncidents.length > 0) {
      return existingIncidents[0];
    }

    const ph = db.getProviderHealth(tenantId, providerId);
    const incident: ProviderIncident = {
      id: `inc_${providerId}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      provider_id: providerId,
      provider_name: ph?.provider_name || providerId,
      provider_type: ph?.provider_type || "COURIER",
      status: "ACTIVE",
      severity: ph?.status === "UNAVAILABLE" ? "CRITICAL" : "HIGH",
      message,
      failover_active: true,
      started_at: new Date().toISOString(),
    };

    db.createProviderIncident(incident);
    return incident;
  }

  /**
   * Resolves an incident and resets circuit breaker
   */
  public resolveIncident(tenantId: string, incidentId: string): ProviderIncident {
    const incident = db.updateProviderIncident(tenantId, incidentId, {
      status: "RESOLVED",
      failover_active: false,
      resolved_at: new Date().toISOString(),
    });

    const ph = db.getProviderHealth(tenantId, incident.provider_id);
    if (ph) {
      ph.status = "HEALTHY";
      ph.consecutive_failures = 0;
      ph.circuit_breaker_open = false;
      ph.last_checked_at = new Date().toISOString();
      db.upsertProviderHealth(ph);
    }

    return incident;
  }

  /**
   * Selects an optimal alternate courier when a provider is degraded or down
   */
  public getAlternateCourier(
    tenantId: string,
    failingCourier: CourierProviderName
  ): CourierProviderName {
    const courierRanks: CourierProviderName[] = ["STEADFAST", "PATHAO", "REDX"];
    for (const courier of courierRanks) {
      if (courier === failingCourier) continue;
      const ph = db.getProviderHealth(tenantId, courier.toLowerCase());
      if (!ph || (ph.status !== "UNAVAILABLE" && !ph.circuit_breaker_open)) {
        return courier;
      }
    }
    // Default fallback
    return failingCourier === "STEADFAST" ? "PATHAO" : "STEADFAST";
  }
}

export const providerHealthService = new ProviderHealthService();
