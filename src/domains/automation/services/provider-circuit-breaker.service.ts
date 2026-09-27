/**
 * CommerceOS Phase 6: Provider Circuit Breaker Service
 * Prevents cascade failures and retry storms by managing circuit states
 * (NORMAL -> DEGRADED -> OPEN -> HALF_OPEN -> NORMAL) for external providers and n8n instances.
 */

import { CircuitBreakerState } from "@/types/automation";

interface ProviderCircuitStats {
  providerKey: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  trippedAt?: number;
  totalRequests: number;
  totalFailures: number;
}

export class ProviderCircuitBreakerService {
  private static readonly FAILURE_THRESHOLD = 3;
  private static readonly DEGRADED_THRESHOLD = 1;
  private static readonly COOLDOWN_PERIOD_MS = 30000; // 30 seconds
  private static readonly RECOVERY_SUCCESS_THRESHOLD = 2;

  // In-memory circuit state index: `${tenantId}:${providerKey}`
  private static states: Map<string, ProviderCircuitStats> = new Map();

  private static getKey(tenantId: string, providerKey: string): string {
    return `${tenantId}:${providerKey.toUpperCase()}`;
  }

  private static getOrCreateStats(tenantId: string, providerKey: string): ProviderCircuitStats {
    const key = this.getKey(tenantId, providerKey);
    let stats = this.states.get(key);
    if (!stats) {
      stats = {
        providerKey,
        state: "NORMAL",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        totalRequests: 0,
        totalFailures: 0,
      };
      this.states.set(key, stats);
    }
    return stats;
  }

  /**
   * Evaluates if a request is permitted to execute against the provider
   */
  public static canExecute(tenantId: string, providerKey: string): boolean {
    const stats = this.getOrCreateStats(tenantId, providerKey);
    const now = Date.now();

    if (stats.state === "NORMAL" || stats.state === "DEGRADED") {
      return true;
    }

    if (stats.state === "OPEN") {
      // Check if cooldown has elapsed to allow test probe in HALF_OPEN
      if (stats.trippedAt && now - stats.trippedAt >= this.COOLDOWN_PERIOD_MS) {
        stats.state = "HALF_OPEN";
        return true;
      }
      return false;
    }

    if (stats.state === "HALF_OPEN") {
      // In half open, allow limited probing
      return true;
    }

    return true;
  }

  /**
   * Records a successful operation
   */
  public static recordSuccess(tenantId: string, providerKey: string): CircuitBreakerState {
    const stats = this.getOrCreateStats(tenantId, providerKey);
    const now = Date.now();

    stats.totalRequests++;
    stats.consecutiveFailures = 0;
    stats.consecutiveSuccesses++;
    stats.lastSuccessAt = now;

    if (stats.state === "HALF_OPEN") {
      if (stats.consecutiveSuccesses >= this.RECOVERY_SUCCESS_THRESHOLD) {
        stats.state = "NORMAL";
        stats.trippedAt = undefined;
      }
    } else if (stats.state === "DEGRADED") {
      if (stats.consecutiveSuccesses >= this.RECOVERY_SUCCESS_THRESHOLD) {
        stats.state = "NORMAL";
      }
    }

    return stats.state;
  }

  /**
   * Records a failed operation
   */
  public static recordFailure(tenantId: string, providerKey: string, isPermanent = false): CircuitBreakerState {
    const stats = this.getOrCreateStats(tenantId, providerKey);
    const now = Date.now();

    stats.totalRequests++;
    stats.totalFailures++;
    stats.consecutiveSuccesses = 0;
    stats.consecutiveFailures++;
    stats.lastFailureAt = now;

    // Permanent errors (like 400 Bad Request or 401 Auth) don't trip network circuit breaker
    if (isPermanent) {
      return stats.state;
    }

    if (stats.state === "HALF_OPEN") {
      // Immediate trip back to OPEN if probe failed
      stats.state = "OPEN";
      stats.trippedAt = now;
    } else if (stats.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      stats.state = "OPEN";
      stats.trippedAt = now;
    } else if (stats.consecutiveFailures >= this.DEGRADED_THRESHOLD) {
      stats.state = "DEGRADED";
    }

    return stats.state;
  }

  /**
   * Returns current state for a provider
   */
  public static getState(tenantId: string, providerKey: string): CircuitBreakerState {
    const stats = this.getOrCreateStats(tenantId, providerKey);
    // Refresh HALF_OPEN state if cooldown expired
    if (stats.state === "OPEN" && stats.trippedAt && Date.now() - stats.trippedAt >= this.COOLDOWN_PERIOD_MS) {
      stats.state = "HALF_OPEN";
    }
    return stats.state;
  }

  /**
   * Resets the circuit breaker
   */
  public static reset(tenantId: string, providerKey: string): void {
    const key = this.getKey(tenantId, providerKey);
    this.states.delete(key);
  }

  /**
   * Retrieves summary for all tracked providers for a tenant
   */
  public static getAllProviderStates(tenantId: string): Record<string, { state: CircuitBreakerState; failures: number }> {
    const prefix = `${tenantId}:`;
    const result: Record<string, { state: CircuitBreakerState; failures: number }> = {};

    for (const [key, stats] of this.states.entries()) {
      if (key.startsWith(prefix)) {
        result[stats.providerKey] = {
          state: stats.state,
          failures: stats.consecutiveFailures,
        };
      }
    }

    return result;
  }
}
