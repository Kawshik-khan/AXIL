/**
 * CommerceOS Phase 6: Authoritative Idempotency Service
 * Guarantees that any side-effecting action or webhook is processed exactly once
 * per (tenant_id, idempotency_key, operation).
 */

import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { IdempotencyRecord } from "@/types/automation";

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  status?: "PROCESSING" | "COMPLETED" | "FAILED";
  cachedResponse?: Record<string, unknown>;
  record?: IdempotencyRecord;
}

export class IdempotencyService {
  private static readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Generates a deterministic hash of the request payload
   */
  public static hashPayload(payload: unknown): string {
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload || {});
    return crypto.createHash("sha256").update(serialized).digest("hex");
  }

  /**
   * Checks or reserves an idempotency lock for the specified operation
   */
  public static acquireLock(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    payload?: unknown,
    ttlMs: number = this.DEFAULT_TTL_MS
  ): IdempotencyCheckResult {
    const existing = db.getIdempotencyRecord(tenantId, idempotencyKey, operation);
    const now = new Date();

    if (existing) {
      // Check expiration
      if (new Date(existing.expires_at) < now) {
        // Expired record, re-open for processing
        db.updateIdempotencyRecord(tenantId, existing.id, {
          status: "PROCESSING",
          request_hash: this.hashPayload(payload),
          response_data: undefined,
          expires_at: new Date(now.getTime() + ttlMs).toISOString(),
        });
        return { isDuplicate: false, status: "PROCESSING" };
      }

      if (existing.status === "COMPLETED") {
        return {
          isDuplicate: true,
          status: "COMPLETED",
          cachedResponse: existing.response_data,
          record: existing,
        };
      }

      if (existing.status === "PROCESSING") {
        return {
          isDuplicate: true,
          status: "PROCESSING",
          record: existing,
        };
      }

      // If previous attempt failed, allow retry by updating status back to PROCESSING
      db.updateIdempotencyRecord(tenantId, existing.id, {
        status: "PROCESSING",
        request_hash: this.hashPayload(payload),
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
      return { isDuplicate: false, status: "PROCESSING" };
    }

    // Create new record
    const record: IdempotencyRecord = {
      id: `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      operation,
      request_hash: this.hashPayload(payload),
      status: "PROCESSING",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    };

    db.createIdempotencyRecord(record);
    return { isDuplicate: false, status: "PROCESSING", record };
  }

  /**
   * Marks the idempotent operation as successfully completed and caches the result
   */
  public static markCompleted(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    responseData: Record<string, unknown>
  ): void {
    const existing = db.getIdempotencyRecord(tenantId, idempotencyKey, operation);
    if (!existing) return;

    db.updateIdempotencyRecord(tenantId, existing.id, {
      status: "COMPLETED",
      response_data: responseData,
    });
  }

  /**
   * Marks the operation as failed so it can be retried or inspected
   */
  public static markFailed(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    errorDetails?: Record<string, unknown>
  ): void {
    const existing = db.getIdempotencyRecord(tenantId, idempotencyKey, operation);
    if (!existing) return;

    db.updateIdempotencyRecord(tenantId, existing.id, {
      status: "FAILED",
      response_data: errorDetails,
    });
  }

  /**
   * Helper to execute an operation idempotently
   */
  public static async executeIdempotent<T extends Record<string, unknown>>(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    payload: unknown,
    executeFn: () => Promise<T>
  ): Promise<{ data: T; isCached: boolean }> {
    const check = this.acquireLock(tenantId, idempotencyKey, operation, payload);

    if (check.isDuplicate && check.status === "COMPLETED" && check.cachedResponse) {
      return { data: check.cachedResponse as T, isCached: true };
    }

    if (check.isDuplicate && check.status === "PROCESSING") {
      throw new Error(`Operation '${operation}' with key '${idempotencyKey}' is already processing.`);
    }

    try {
      const result = await executeFn();
      this.markCompleted(tenantId, idempotencyKey, operation, result);
      return { data: result, isCached: false };
    } catch (err) {
      this.markFailed(tenantId, idempotencyKey, operation, {
        error: err instanceof Error ? err.message : "Unknown error",
      });
      throw err;
    }
  }
}
