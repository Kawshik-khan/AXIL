import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise Incident Management Service
 * Incident lifecycle tracking (DETECTED -> TRIAGED -> INVESTIGATING -> MITIGATING -> RESOLVED -> POSTMORTEM)
 */

import { db } from "@/infrastructure/db";
import {
  EnterpriseIncident,
  IncidentSeverity,
  IncidentStatus,
} from "@/types/enterprise";

export class EnterpriseIncidentService {
  /**
   * Logs a new enterprise operational or integration incident
   */
  public createIncident(
    orgId: string,
    params: {
      title: string;
      domain: EnterpriseIncident["domain"];
      severity: IncidentSeverity;
      impactedEntities: EnterpriseIncident["impacted_entities"];
      rootCause?: string;
      mitigationPlan?: string;
      assignedUserId?: string;
    }
  ): EnterpriseIncident {
    const incident: EnterpriseIncident = {
      id: `inc_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      title: params.title,
      domain: params.domain,
      severity: params.severity,
      status: "DETECTED",
      impacted_entities: params.impactedEntities,
      root_cause: params.rootCause,
      mitigation_plan: params.mitigationPlan,
      assigned_to_user_id: params.assignedUserId,
      detected_at: new Date().toISOString(),
    };

    return db.createEnterpriseIncident(incident);
  }

  /**
   * Advances the incident status along its lifecycle
   */
  public transitionStatus(
    orgId: string,
    incidentId: string,
    nextStatus: IncidentStatus,
    notes?: string
  ): EnterpriseIncident {
    const updates: Partial<EnterpriseIncident> = { status: nextStatus };
    if (nextStatus === "MITIGATING") {
      updates.mitigated_at = new Date().toISOString();
    } else if (nextStatus === "RESOLVED") {
      updates.resolved_at = new Date().toISOString();
      if (notes) updates.postmortem_notes = notes;
    }

    return db.updateEnterpriseIncident(orgId, incidentId, updates);
  }
}

export const enterpriseIncidentService = new EnterpriseIncidentService();
