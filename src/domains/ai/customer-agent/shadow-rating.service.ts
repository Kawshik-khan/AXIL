/**
 * Staff rating of the customer agent's shadow drafts (FX-87): during the shadow week staff see the agent's draft for each
 * customer message and mark it usable or not. Going to the pilot needs ≥ 85% usable. The rating is stored on the draft
 * and on the run that produced it, so the rollout numbers come from runs.
 */
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { AuditService } from "@/domains/audit/service";

export type DraftRating = "USABLE" | "NOT_USABLE";

export class ShadowRatingService {
  public static rate(context: RequestContext, conversationId: string, rating: DraftRating, note?: string) {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND); // the people who answer customers rate the drafts
    const tenantId = context.tenant.id;
    const convo = db.findConversationById(tenantId, conversationId);
    if (!convo) throw new NotFoundError(`Conversation '${conversationId}' not found.`);
    const draft = convo.metadata?.agent_shadow_reply as Record<string, unknown> | undefined;
    if (!draft || typeof draft.run_id !== "string") throw new BadRequestError("This conversation has no agent draft to rate.");
    // The pilot gate counts these: a draft is rated once, by one person, on the record
    if (draft.rating) throw new ConflictError("This draft has already been rated.");
    const stamp = { value: rating, by: context.user.id, at: new Date().toISOString(), ...(note ? { note } : {}) };
    db.updateConversation(tenantId, convo.id, { metadata: { ...convo.metadata, agent_shadow_reply: { ...draft, rating: stamp } } });
    const run = db.findAgentRunById(tenantId, draft.run_id);
    if (run) db.updateAgentRun(tenantId, run.id, { metadata: { ...(run.metadata ?? {}), shadow_rating: rating } });
    AuditService.log({ tenantId, actorUserId: context.user.id, action: "AGENT_DRAFT_RATED", resourceType: "agent_run", resourceId: draft.run_id, metadata: { rating, conversation_id: convo.id } });
    return { conversation_id: convo.id, run_id: draft.run_id, rating };
  }
}
