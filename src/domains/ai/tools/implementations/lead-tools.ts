/**
 * CommerceOS Phase 4: Lead Capture Tools
 * Captures high-intent sales leads and wholesale inquiries.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { LeadService } from "@/domains/social/leads/lead.service";

const CreateLeadInputSchema = z.object({
  title: z.string().describe("Summary of lead or inquiry (e.g. Wholesale inquiry)"),
  contact_name: z.string().optional().describe("Customer name"),
  phone: z.string().optional().describe("Customer contact phone"),
  email: z.string().email().optional(),
  estimated_quantity: z.number().int().positive().optional(),
  estimated_value: z.number().positive().optional(),
  notes: z.string().optional().describe("Details of the inquiry or requested items"),
});

export class CreateLeadTool implements IAgentTool<z.infer<typeof CreateLeadInputSchema>> {
  public readonly name = "create_lead";
  public readonly description = "Capture qualified sales lead or wholesale inquiry into CommerceOS CRM.";
  public readonly category = "LEAD";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.SOCIAL_LEAD_CREATE;
  public readonly requiresConfirmation = false;
  public readonly schema = CreateLeadInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Lead title" },
          contact_name: { type: "string", description: "Customer name" },
          phone: { type: "string", description: "Phone number" },
          email: { type: "string", description: "Email address" },
          estimated_quantity: { type: "number", description: "Quantity requested" },
          notes: { type: "string", description: "Inquiry details" },
        },
        required: ["title"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(
    context: RequestContext,
    input: z.infer<typeof CreateLeadInputSchema>,
    options?: { conversationId?: string; idempotencyKey?: string }
  ) {
    const lead = await LeadService.createLead(context, {
      customer_id: context.user?.id || "cust_inquiry",
      conversation_id: options?.conversationId,
      intent: input.title,
      estimated_value: input.estimated_value || (input.estimated_quantity ? input.estimated_quantity * 500 : undefined),
      notes: `${input.contact_name ? `Contact: ${input.contact_name} ` : ""}${input.phone ? `Phone: ${input.phone} ` : ""}${input.notes || ""}`.trim(),
      source: "FACEBOOK",
    });

    return {
      lead_id: lead.id,
      intent: lead.intent,
      status: lead.status,
      estimated_value: lead.estimated_value,
      message: "Lead successfully recorded in CommerceOS. Our sales team has been notified.",
    };
  }
}
