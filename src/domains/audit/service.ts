import { db, AuditLogRecord } from "@/infrastructure/db";

export interface LogAuditInput {
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  public static log(input: LogAuditInput): AuditLogRecord {
    const id = `aud_${Math.random().toString(36).substring(2, 10)}`;
    const logRecord: AuditLogRecord = {
      id,
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      metadata: input.metadata || {},
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      created_at: new Date().toISOString(),
    };

    return db.createAuditLog(logRecord);
  }

  public static getLogsForTenant(
    tenantId: string,
    limit = 50,
    offset = 0
  ): { logs: AuditLogRecord[]; total: number } {
    return db.getAuditLogsByTenant(tenantId, limit, offset);
  }
}
