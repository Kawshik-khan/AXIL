import { db } from "@/infrastructure/db";
import { Order, PaymentMethod, CustomerSource } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { OrderService } from "@/domains/orders/order.service";
import { ProductService } from "@/domains/catalog/product.service";
import { MessageService } from "../messages/message.service";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";
import { loadCustomerRows } from "@/infrastructure/db/tenant-rows";

export interface CreateSocialOrderPayload {
  conversation_id: string;
  items: Array<{ variant_id: string; quantity: number }>;
  delivery_address: {
    division?: string;
    district: string;
    upazila?: string;
    area?: string;
    address_line_1: string;
    postal_code?: string;
  };
  /** Ignored: derived from the district. */
  delivery_zone?: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
  payment_method: PaymentMethod;
  coupon_code?: string;
  notes?: string;
  /** Used when the conversation's customer has no phone on record. */
  customer_phone?: string;
  /** The open ticket whose draft this order confirms. */
  escalation_id?: string;
}

export class SocialOrderService {
  /**
   * Create an authoritative order from a social conversation using Commerce Core OrderService.
   * Price, discounts, shipping fee, stock reservations are 100% computed by Commerce Core.
   */
  public static async createOrderFromConversation(
    context: RequestContext,
    payload: CreateSocialOrderPayload
  ): Promise<Order> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_CREATE);

    const conversation = db.findConversationById(context.tenant.id, payload.conversation_id);
    if (!conversation) {
      throw new NotFoundError(`Conversation '${payload.conversation_id}' not found.`);
    }

    if (payload.escalation_id) {
      // Confirming the agent's draft resolves its ticket, so it needs the same permission as resolving one
      RbacService.assertCan(context, PERMISSIONS.SUPPORT_WRITE);
      const ticket = db.findAgentHitlEscalation(context.tenant.id, payload.escalation_id);
      if (!ticket || ticket.conversation_id !== conversation.id) throw new NotFoundError("Order draft", payload.escalation_id);
      if (!HitlEscalationService.draftIsOpen(context.tenant.id, ticket)) throw new ConflictError("This order draft was already handled. Check the customer's recent orders.");
    }

    await loadCustomerRows(context.tenant.id, [conversation.customer_id]); // zero-hydration: the customer and identities read here
    const customer = db.findCustomerById(context.tenant.id, conversation.customer_id);
    if (!customer) {
      throw new BadRequestError(`Customer record for conversation '${payload.conversation_id}' not found.`);
    }

    // Determine canonical customer source
    const source: CustomerSource = conversation.channel_type === "WEBSITE_CHAT" ? "WEBSITE" : "SOCIAL";

    // 1. Delegate to Commerce Core OrderService (Zero duplicated business logic)
    const order = await OrderService.createOrder(context, {
      customer: {
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone || payload.customer_phone || "",
        email: customer.email,
      },
      delivery_address: payload.delivery_address,
      items: payload.items,
      payment_method: payload.payment_method,
      coupon_code: payload.coupon_code,
      notes: payload.notes ? `[Social Commerce] ${payload.notes}` : `[Social Commerce Order] Ingress via ${conversation.channel_type}`,
      source,
    });

    // 2. Associate order in conversation metadata and tags
    const currentTags = new Set(conversation.tags);
    currentTags.add("ORDER_CREATED");
    db.updateConversation(context.tenant.id, conversation.id, {
      tags: Array.from(currentTags),
      metadata: {
        ...conversation.metadata,
        last_order_id: order.id,
        last_order_number: order.order_number,
      },
    });

    if (payload.escalation_id) {
      // Every open ticket of this chat that carries a draft is done, and the quote behind it can't be confirmed again
      for (const ticket of db.getAgentHitlEscalations(context.tenant.id)) {
        if (ticket.conversation_id !== conversation.id || ticket.status === "RESOLVED" || !ticket.order_draft) continue;
        HitlEscalationService.resolveEscalation(context.tenant.id, { escalationId: ticket.id, resolutionType: "DRAFT_APPROVED", userId: context.user.id });
      }
      for (const quote of db.getConversationQuotes(context.tenant.id, conversation.id)) {
        if (quote.status === "QUOTED") db.updateQuote(context.tenant.id, quote.id, { status: "STALE" });
      }
    }

    // 3. Insert system event / internal note in thread recording order creation
    await MessageService.createInternalNote(
      context,
      conversation.id,
      `🛍️ Order created successfully! Order Number: ${order.order_number}, Total: ৳${order.grand_total}, Status: ${order.status}`
    );

    return order;
  }

  /**
   * Search real-time canonical product catalog with live inventory and pricing
   */
  public static async searchProductsForConversation(
    context: RequestContext,
    query: string
  ) {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    return ProductService.listProducts(context, {
      search: query,
      status: "ACTIVE",
      limit: 10,
    });
  }
}
