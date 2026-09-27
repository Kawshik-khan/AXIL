import { db } from "@/infrastructure/db";
import { ConversationAssignment, Conversation } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

export class AssignmentService {
  public static async getHistory(
    context: RequestContext,
    conversationId: string
  ): Promise<ConversationAssignment[]> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_READ);
    return db.getAssignmentHistory(context.tenant.id, conversationId);
  }

  /**
   * Deterministic team routing engine (Sales, Support, Orders, Returns, Finance)
   * Extension point for Phase 4 AI Intent Router!
   */
  public static determineTeamRoute(
    intent?: string
  ): "SALES" | "SUPPORT" | "ORDERS" | "RETURNS" | "FINANCE" | "GENERAL" {
    switch (intent) {
      case "PRICE_QUERY":
      case "PRODUCT_QUERY":
        return "SALES";
      case "ORDER_STATUS_QUERY":
        return "ORDERS";
      case "RETURN_QUERY":
        return "RETURNS";
      case "PAYMENT_QUERY":
        return "FINANCE";
      default:
        return "SUPPORT";
    }
  }
}
