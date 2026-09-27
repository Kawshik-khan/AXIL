import { db } from "@/infrastructure/db";
import { PlatformIncidentRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { NotFoundError } from "@/lib/errors";
import crypto from "crypto";

export class PlatformIncidentService {
  /**
   * Lists all operational incidents.
   */
  public static listIncidents(context: PlatformContext): PlatformIncidentRecord[] {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    return db.getPlatformIncidents();
  }

  /**
   * Declares a new platform incident.
   */
  public static declareIncident(
    input: {
      title: string;
      severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
      affected_components: string[];
      impact_summary?: string;
    },
    context: PlatformContext
  ): PlatformIncidentRecord {
    PlatformAuthorizationService.assertCan(context, "platform.manage");

    const now = new Date().toISOString();
    const incident: PlatformIncidentRecord = {
      id: `inc_${crypto.randomUUID().substring(0, 10)}`,
      title: input.title,
      severity: input.severity,
      status: "INVESTIGATING",
      affected_components: input.affected_components,
      impact_summary: input.impact_summary,
      owner: context.platformUser.name,
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    db.savePlatformIncident(incident);

    PlatformAuditService.record(
      {
        action: "incident.declare",
        resource_type: "platform_incident",
        resource_id: incident.id,
        reason: `Declared incident: ${incident.title}`,
        after_state: { title: incident.title, severity: incident.severity },
        result: "SUCCESS",
      },
      context
    );

    return incident;
  }

  /**
   * Updates an incident status (INVESTIGATING, MITIGATING, RESOLVED, CLOSED).
   */
  public static updateIncidentStatus(
    id: string,
    status: PlatformIncidentRecord["status"],
    notes: string,
    context: PlatformContext
  ): PlatformIncidentRecord {
    PlatformAuthorizationService.assertCan(context, "platform.manage");

    const incident = db.findPlatformIncidentById(id);
    if (!incident) throw new NotFoundError(`Incident "${id}" not found.`);

    const now = new Date().toISOString();
    const beforeState = { status: incident.status };

    incident.status = status;
    incident.updated_at = now;
    if (status === "RESOLVED" || status === "CLOSED") {
      incident.resolved_at = now;
    }

    db.savePlatformIncident(incident);

    PlatformAuditService.record(
      {
        action: "incident.update_status",
        resource_type: "platform_incident",
        resource_id: incident.id,
        reason: notes || `Status updated to ${status}`,
        before_state: beforeState,
        after_state: { status, resolved_at: incident.resolved_at },
        result: "SUCCESS",
      },
      context
    );

    return incident;
  }
}
