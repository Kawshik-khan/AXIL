import { db } from "@/infrastructure/db";
import { Order, PaymentMethod, CustomerSource } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { OrderService } from "@/domains/orders/order.service";
import { ProductService } from "@/domains/catalog/product.service";
import { MessageService } from "../messages/message.service";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export interface CreateSocialOrderPayload {
  conversation_id: string;
  items: Array<{ variant_id: string; quantity: number }>;
  delivery_address: {
    division: string;
    district: string;
    upazila?: string;
    area?: string;
    address_line_1: string;
    postal_code?: string;
  };
  delivery_zone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
  payment_method: PaymentMethod;
  coupon_code?: string;
  notes?: string;
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
        phone: customer.phone,
        email: customer.email,
      },
      delivery_address: payload.delivery_address,
      delivery_zone: payload.delivery_zone,
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
