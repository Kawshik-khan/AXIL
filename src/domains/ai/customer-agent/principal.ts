/**
 * The customer agent acts as the conversation's customer, never as a staff member (ADR-111, FX-72, audit F02).
 *
 * - The workspace and channel come from the channel that received the signed webhook; the customer from the identity
 *   the provider authenticated (PSID, IGSID, WhatsApp wa_id, Telegram user id, widget visitor id). Nothing in a message
 *   can change them.
 * - Each tool runs with a request context holding only the permissions its capability needs.
 * - Orders are visible only if they were placed in this chat, or belong to the chat's own customer (not for anonymous
 *   website visitors). A phone number typed in the chat never links anyone.
 */
import { db } from "@/infrastructure/db";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";
import type { Order } from "@/types/commerce";
import type { ChannelType, Conversation } from "@/types/social";

/**
 * How sure we are who the customer is:
 * - VERIFIED_PHONE: WhatsApp, whose sender id is a phone number WhatsApp has verified;
 * - CHANNEL: a stable account id (Messenger, Instagram, Telegram) that proves "same account as before", not a phone;
 * - ANONYMOUS: a website visitor id, or a channel we can't vouch for.
 */
export type Assurance = "ANONYMOUS" | "CHANNEL" | "VERIFIED_PHONE";

export interface CustomerAgentPrincipal {
  tenantId: string;
  tenantName: string;
  channelId: string;
  channelType: ChannelType;
  conversationId: string;
  /** The channel identity the provider authenticated, when the store has one for this customer and channel. */
  identityId?: string;
  customerId?: string;
  assurance: Assurance;
}

const ASSURANCE: Partial<Record<ChannelType, Assurance>> = {
  WHATSAPP: "VERIFIED_PHONE",
  FACEBOOK_MESSENGER: "CHANNEL",
  INSTAGRAM: "CHANNEL",
  TELEGRAM: "CHANNEL",
};

/**
 * The principal for a conversation in a workspace. The conversation is looked up by workspace, never trusted as given.
 * None for a workspace that isn't active or a channel that isn't connected: the agent doesn't act for them at all.
 */
export function principalFor(tenantId: string, conversationId: string): CustomerAgentPrincipal | undefined {
  const conversation: Conversation | undefined = db.findConversationById(tenantId, conversationId);
  const tenant = db.findTenantById(tenantId);
  if (!conversation || !tenant || tenant.status !== "ACTIVE") return undefined;
  const channel = db.findConnectedChannelById(tenantId, conversation.channel_id);
  if (!channel || channel.status !== "ACTIVE") return undefined;
  const identities = conversation.customer_id
    ? db.getCustomerIdentities(tenantId, conversation.customer_id).filter((i) => i.channel_id === conversation.channel_id)
    : [];
  const identity = identities[0];
  // A chat linked to a customer by a phone or email the sender supplied, on a channel that doesn't verify phones, proves
  // nothing about who they are (ADR-111): its customer's other orders stay hidden.
  const linkedByClaim =
    conversation.channel_type !== "WHATSAPP" &&
    identities.some((i) => ["PHONE_MATCH", "EMAIL_MATCH"].includes(String(i.metadata?.resolution_strategy ?? "")));
  const assurance = linkedByClaim ? "ANONYMOUS" : ASSURANCE[conversation.channel_type] ?? "ANONYMOUS";
  return {
    tenantId,
    tenantName: tenant.name,
    channelId: conversation.channel_id,
    channelType: conversation.channel_type,
    conversationId: conversation.id,
    identityId: identity?.id,
    customerId: conversation.customer_id || undefined,
    assurance,
  };
}

/** What each capability may do. Nothing here moves money, changes prices or reads other customers' data. */
const CAPABILITIES = {
  catalog: [PERMISSIONS.PRODUCTS_READ, PERMISSIONS.INVENTORY_READ],
  orders_read: [PERMISSIONS.ORDERS_READ, PERMISSIONS.SHIPMENTS_READ, PERMISSIONS.PAYMENTS_READ],
  orders_create: [PERMISSIONS.ORDERS_CREATE, PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.CUSTOMERS_CREATE],
  knowledge: [PERMISSIONS.AI_KNOWLEDGE_READ],
  handoff: [PERMISSIONS.SOCIAL_CONVERSATION_ASSIGN, PERMISSIONS.SOCIAL_MESSAGE_SEND],
  send: [PERMISSIONS.SOCIAL_MESSAGE_SEND], // the reply itself, through the normal outbound path (FX-76)
} as const satisfies Record<string, readonly Permission[]>;

export type Capability = keyof typeof CAPABILITIES;

/** A request context for one capability, attributed to this conversation in audit logs. */
export function capabilityContext(pr: CustomerAgentPrincipal, capability: Capability): RequestContext {
  const now = new Date().toISOString();
  const tenant = db.findTenantById(pr.tenantId);
  return {
    requestId: `agent_${pr.conversationId}`,
    traceId: `agent_${pr.conversationId}`,
    user: { id: `svc_customer_agent:${pr.conversationId}`, email: "customer-agent@service.local", name: "Customer agent", status: "ACTIVE" },
    // The workspace as it is now (a suspended one fails service checks instead of passing as ACTIVE)
    tenant: {
      id: pr.tenantId,
      name: tenant?.name ?? pr.tenantName,
      slug: tenant?.slug ?? pr.tenantId,
      currency: tenant?.currency ?? "BDT",
      timezone: tenant?.timezone ?? "Asia/Dhaka",
      language: tenant?.language ?? "bn",
      status: tenant?.status ?? "SUSPENDED",
    },
    role: "SERVICE",
    permissions: [...CAPABILITIES[capability]],
    timestamp: now,
  };
}

/**
 * Whether this chat may see an order: it was placed in this chat, or it belongs to the chat's own customer and the
 * chat isn't anonymous. The customer link comes from the provider-authenticated identity, never from a typed phone.
 */
export function canSeeOrder(pr: CustomerAgentPrincipal, order: Pick<Order, "tenant_id" | "customer_id" | "source_conversation_id">): boolean {
  if (order.tenant_id !== pr.tenantId) return false;
  if (order.source_conversation_id && order.source_conversation_id === pr.conversationId) return true;
  return pr.assurance !== "ANONYMOUS" && Boolean(pr.customerId) && order.customer_id === pr.customerId;
}

/** This chat's orders, newest first. */
export function visibleOrders(pr: CustomerAgentPrincipal, limit = 5): Order[] {
  return db
    .getAllOrders(pr.tenantId)
    .filter((o) => canSeeOrder(pr, o))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
