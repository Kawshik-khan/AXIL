import { randomSuffix } from "@/lib/ids";
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
    const id = `aud_${randomSuffix()}`;
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

  public static async getLogsForTenant(
    tenantId: string,
    limit = 50,
    offset = 0
  ): Promise<{ logs: AuditLogRecord[]; total: number }> {
    const client = db.isCollectionHydrated("audit_logs") ? null : db.getSqlClient();
    if (client) {
      const [dataResult, countResult] = await Promise.all([
        client.query<{ data: string | AuditLogRecord }>(
          `SELECT data FROM commerceos.audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [tenantId, limit, offset]
        ),
        client.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM commerceos.audit_logs WHERE tenant_id = $1`,
          [tenantId]
        ),
      ]);
      const logs: AuditLogRecord[] = dataResult.rows.map((r) =>
        typeof r.data === "string" ? (JSON.parse(r.data) as AuditLogRecord) : (r.data as AuditLogRecord)
      );
      return {
        logs,
        total: Number(countResult.rows[0]?.total ?? 0),
      };
    }
    return db.getAuditLogsByTenant(tenantId, limit, offset);
  }
}
