import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Lead, LeadStatus, ConversationSource } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { SocialEventService } from "../events/social-event.service";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class LeadService {
  public static async listLeads(
    context: RequestContext,
    options?: { status?: string; assigned_to?: string; limit?: number; offset?: number }
  ) {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_LEAD_READ);
    return db.getLeads(context.tenant.id, options);
  }

  public static async getLeadById(
    context: RequestContext,
    leadId: string
  ): Promise<Lead> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_LEAD_READ);
    const lead = db.findLeadById(context.tenant.id, leadId);
    if (!lead) {
      throw new NotFoundError(`Lead '${leadId}' not found.`);
    }
    return lead;
  }

  public static async createLead(
    context: RequestContext,
    payload: {
      customer_id: string;
      conversation_id?: string;
      source?: ConversationSource;
      intent?: string;
      assigned_to?: string;
      estimated_value?: number;
      notes?: string;
    }
  ): Promise<Lead> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_LEAD_CREATE);

    const customer = db.findCustomerById(context.tenant.id, payload.customer_id);
    if (!customer) {
      throw new BadRequestError(`Customer '${payload.customer_id}' not found.`);
    }

    const leadId = `led_${Date.now()}_${randomSuffix()}`;
    const newLead: Lead = {
      id: leadId,
      tenant_id: context.tenant.id,
      customer_id: payload.customer_id,
      conversation_id: payload.conversation_id,
      source: payload.source || "OTHER",
      status: "NEW",
      intent: payload.intent,
      assigned_to: payload.assigned_to || context.user.id,
      estimated_value: payload.estimated_value,
      notes: payload.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const created = db.createLead(newLead);

    SocialEventService.emit({
      tenantId: context.tenant.id,
      eventType: "lead.created",
      aggregateType: "lead",
      aggregateId: leadId,
      actor: { type: "USER", id: context.user.id },
      payload: {
        leadId,
        customerId: payload.customer_id,
        conversationId: payload.conversation_id,
        intent: payload.intent,
      },
    });

    return created;
  }

  public static async updateStatus(
    context: RequestContext,
    leadId: string,
    status: LeadStatus,
    notes?: string
  ): Promise<Lead> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_LEAD_UPDATE);
    const existing = await this.getLeadById(context, leadId);

    const updated = db.updateLead(context.tenant.id, leadId, {
      status,
      notes: notes || existing.notes,
    });

    if (status === "CONVERTED") {
      SocialEventService.emit({
        tenantId: context.tenant.id,
        eventType: "lead.converted",
        aggregateType: "lead",
        aggregateId: leadId,
        actor: { type: "USER", id: context.user.id },
        payload: { leadId, customerId: existing.customer_id },
      });
    }

    return updated;
  }
}
