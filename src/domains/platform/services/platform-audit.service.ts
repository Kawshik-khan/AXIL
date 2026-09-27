import { db } from "@/infrastructure/db";
import { PlatformAuditLogRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import crypto from "crypto";

export interface CreateAuditEntryInput {
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string;
  target_tenant_id?: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILED" | "BLOCKED";
  error_message?: string;
  impersonation_session_id?: string;
}

export class PlatformAuditService {
  /**
   * Appends an immutable audit record to the platform audit ledger.
   * Strips out sensitive credentials, tokens, and private keys before recording.
   */
  public static record(input: CreateAuditEntryInput, context: PlatformContext): PlatformAuditLogRecord {
    const sanitizedBefore = input.before_state ? this.sanitize(input.before_state) : null;
    const sanitizedAfter = input.after_state ? this.sanitize(input.after_state) : null;

    const logRecord: PlatformAuditLogRecord = {
      id: `aud_plat_${crypto.randomUUID().substring(0, 12)}`,
      actor_id: context.platformUser.id,
      effective_actor_id: input.impersonation_session_id ? context.platformUser.id : undefined,
      platform_role: context.platformRole,
      target_tenant_id: input.target_tenant_id,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      reason: input.reason,
      before_state: sanitizedBefore,
      after_state: sanitizedAfter,
      result: input.result,
      error_message: input.error_message,
      request_id: context.requestId,
      correlation_id: context.traceId,
      impersonation_session_id: input.impersonation_session_id,
      created_at: new Date().toISOString(),
    };

    return db.appendPlatformAuditLog(logRecord);
  }

  /**
   * Queries audit logs with pagination and multi-parameter filtering.
   */
  public static query(filters?: {
    actorId?: string;
    tenantId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): { logs: PlatformAuditLogRecord[]; total: number } {
    return db.getPlatformAuditLogs(filters);
  }

  /**
   * Generates a tamper-evident audit report with cryptographic checksum.
   */
  public static exportAuditLedger(filters?: {
    tenantId?: string;
    limit?: number;
  }): { export_id: string; checksum_sha256: string; record_count: number; records: PlatformAuditLogRecord[] } {
    const { logs } = db.getPlatformAuditLogs({
      tenantId: filters?.tenantId,
      limit: filters?.limit || 1000,
      offset: 0,
    });

    const serialized = JSON.stringify(logs);
    const checksum = crypto.createHash("sha256").update(serialized).digest("hex");

    return {
      export_id: `exp_${crypto.randomUUID().substring(0, 10)}`,
      checksum_sha256: checksum,
      record_count: logs.length,
      records: logs,
    };
  }

  /**
   * Sanitizes payloads by redacting sensitive secrets, keys, and passwords.
   */
  private static sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ["password", "secret", "token", "key", "authorization", "apiKey", "password_hash"];
    const cleaned: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
        cleaned[k] = "[REDACTED]";
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        cleaned[k] = this.sanitize(v as Record<string, unknown>);
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  }
}
