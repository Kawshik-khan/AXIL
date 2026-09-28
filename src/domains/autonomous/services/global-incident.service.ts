import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 10: Global Incident Service
 * Incident detection, classification, cross-domain diagnosis, and resolution.
 */

import { db } from "@/infrastructure/db";

export interface AutonomousIncident {
  id: string;
  tenant_id: string;
  title: string;
  severity: "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" | "P3_LOW";
  status: "DETECTED" | "INVESTIGATING" | "MITIGATING" | "RESOLVED" | "POSTMORTEM";
  affected_domains: string[];
  affected_services: string[];
  root_cause?: string;
  timeline: Array<{ timestamp: string; event: string; actor: string }>;
  resolution?: { description: string; resolved_by: string; resolved_at: string };
  postmortem?: { summary: string; action_items: string[]; created_at: string };
  detected_at: string;
  resolved_at?: string;
}

export class GlobalIncidentService {
  /** Create a new incident. */
  createIncident(incident: AutonomousIncident): AutonomousIncident {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    incident.status = "DETECTED";
    incident.detected_at = new Date().toISOString();
    incident.timeline = [{ timestamp: incident.detected_at, event: "Incident detected", actor: "system" }];
    // Store as enterprise incident
    db.data.enterprise_incidents.push({
      id: incident.id,
      tenant_id: incident.tenant_id,
      organization_id: "org_apex_holding",
      title: incident.title,
      severity: incident.severity.replace("P0_", "").replace("P1_", "").replace("P2_", "").replace("P3_", "") as any,
      status: incident.status as any,
      category: "AUTONOMOUS_PLATFORM",
      affected_entities: incident.affected_domains.map((d) => ({ entity_type: "DOMAIN", entity_id: d })),
      timeline: incident.timeline,
      root_cause: incident.root_cause,
      created_at: incident.detected_at,
      updated_at: incident.detected_at,
    } as any);
    return incident;
  }

  /** Update incident status. */
  updateIncident(tenantId: string, incidentId: string, update: {
    status?: string;
    root_cause?: string;
    resolution?: { description: string; resolved_by: string };
  }): void {
    const incident = db.data.enterprise_incidents.find(
      (i) => i.id === incidentId && ((i as any).tenant_id === tenantId || (i as any).organization_id === tenantId)
    );
    if (!incident) throw new AppError("NOT_FOUND", `Incident not found: ${incidentId}`, 404);
    if (update.status) (incident as any).status = update.status;
    if (update.root_cause) (incident as any).root_cause = update.root_cause;
    if (update.resolution) {
      (incident as any).resolution = { ...update.resolution, resolved_at: new Date().toISOString() };
      (incident as any).status = "RESOLVED";
      (incident as any).resolved_at = new Date().toISOString();
    }
    (incident as any).updated_at = new Date().toISOString();
  }

  /** Get active incidents. */
  getActiveIncidents(tenantId: string): any[] {
    return db.data.enterprise_incidents.filter(
      (i) => ((i as any).tenant_id === tenantId || (i as any).organization_id === tenantId) && i.status !== "RESOLVED" && i.status !== "POSTMORTEM"
    );
  }

  /** Cross-domain incident diagnosis: identify affected services across domains. */
  diagnoseImpact(tenantId: string, incidentId: string): {
    affected_domains: string[];
    affected_objectives: string[];
    affected_workflows: string[];
    blast_radius: "ISOLATED" | "DOMAIN" | "CROSS_DOMAIN" | "PLATFORM_WIDE";
  } {
    const incident = db.data.enterprise_incidents.find(
      (i) => i.id === incidentId && ((i as any).tenant_id === tenantId || (i as any).organization_id === tenantId)
    );
    if (!incident) throw new AppError("NOT_FOUND", `Incident not found: ${incidentId}`, 404);

    const affectedDomains = (incident as any).affected_entities?.map((e: any) => e.entity_id) || [];
    const affectedObjectives = db.data.business_objectives
      .filter((o) => o.tenant_id === tenantId && o.allowed_domains.some((d) => affectedDomains.includes(d)))
      .map((o) => o.id);
    const affectedWorkflows = db.data.autonomous_workflow_runs
      .filter((w) => w.tenant_id === tenantId && w.domains_involved.some((d) => affectedDomains.includes(d)))
      .map((w) => w.id);

    return {
      affected_domains: affectedDomains,
      affected_objectives: affectedObjectives,
      affected_workflows: affectedWorkflows,
      blast_radius: affectedDomains.length > 3 ? "PLATFORM_WIDE" : affectedDomains.length > 1 ? "CROSS_DOMAIN" : "DOMAIN",
    };
  }
}
