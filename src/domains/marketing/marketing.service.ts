import { AppError, BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Marketing Domain Service
 * WhatsApp cart recovery and audience cohort segmentation. Campaigns, broadcasts and attribution were removed
 * (2026-11-26); their stored rows and types remain.
 */

import { db } from "@/infrastructure/db";
import {
  AbandonedCartRecoveryItem,
  Audience,
  MarketingChannelType,
} from "@/types/growth";
import { audienceService } from "@/domains/growth/services/audience.service";
import { contentService } from "@/domains/growth/services/content.service";
import { consentService, frequencyCappingService } from "@/domains/growth/services/consent.service";
import { marketingChannelService } from "@/domains/growth/services/marketing-channel.service";
import { loadCustomerRows } from "@/infrastructure/db/tenant-rows";
import { orderRepository } from "@/domains/orders/order.repository";

export interface EnrichedAbandonedCart extends AbandonedCartRecoveryItem {
  customer?: {
    first_name: string;
    last_name?: string;
    phone: string;
    email?: string;
  };
  formatted_total: string;
  time_ago: string;
}

export interface NudgeResult {
  success: boolean;
  cart_id: string;
  recipient_phone: string;
  channel: MarketingChannelType;
  message_content: string;
  external_message_id?: string;
  error?: string;
  factuality_verification: {
    price_verified: boolean;
    stock_verified: boolean;
    violations: string[];
  };
}

export interface MarketingOverviewMetrics {
  total_recovered_revenue_bdt: number;
  total_abandoned_revenue_bdt: number;
  cart_recovery_rate_pct: number;
  active_abandoned_carts_count: number;
  insights: Array<{
    id: string;
    title: string;
    summary: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
  }>;
}

export class MarketingService {
  /**
   * ============================================================
   * 1. ABANDONED CART RECOVERY CAPABILITY
   * ============================================================
   */

  /**
   * Fetches all abandoned carts enriched with customer information
   */
  public getAbandonedCarts(tenantId: string): EnrichedAbandonedCart[] {
    const carts = db.getAbandonedCarts(tenantId);
    const customersById = new Map(db.getAllCustomers(tenantId).map((c) => [c.id, c])); // O(carts + customers) (FX-23)

    return carts.map((cart) => {
      const cust = customersById.get(cart.customer_id);
      const hoursAgo = Math.max(1, Math.round((Date.now() - new Date(cart.abandoned_at).getTime()) / 3600000));
      const timeAgo = hoursAgo >= 24 ? `${Math.floor(hoursAgo / 24)}d ago` : `${hoursAgo}h ago`;

      return {
        ...cart,
        customer: cust
          ? {
              first_name: cust.first_name,
              last_name: cust.last_name,
              phone: cust.phone,
              email: cust.email,
            }
          : undefined,
        formatted_total: `৳${cart.abandoned_total_bdt.toLocaleString()}`,
        time_ago: timeAgo,
      };
    });
  }

  /**
   * Evaluates and records a new abandoned cart
   */
  public recordAbandonedCart(params: {
    tenantId: string;
    customerId: string;
    cartItems: Array<{ product_id: string; title: string; price: number; quantity: number }>;
    abandonedAt?: string;
  }): AbandonedCartRecoveryItem {
    const { tenantId, customerId, cartItems, abandonedAt } = params;

    const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const cart: AbandonedCartRecoveryItem = {
      id: `acr_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      customer_id: customerId,
      cart_items: cartItems,
      abandoned_total_bdt: total,
      abandoned_at: abandonedAt || new Date().toISOString(),
      recovery_stage: "PENDING",
    };

    return db.insertAbandonedCart(cart);
  }

  /**
   * Triggers an automated WhatsApp recovery nudge with culturally authentic Banglish copy
   * and live stock/price grounding.
   */
  public async sendWhatsAppRecoveryNudge(params: {
    tenantId: string;
    cartId: string;
    customOfferCode?: string;
  }): Promise<NudgeResult> {
    const { tenantId, cartId, customOfferCode } = params;

    const cart = db.getAbandonedCartById(tenantId, cartId);
    if (!cart || cart.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Abandoned cart not found: ${cartId}`, 404);
    }

    if (cart.recovery_stage === "RECOVERED") {
      throw new Error(`Cart ${cartId} is already recovered.`);
    }

    await loadCustomerRows(tenantId, [cart.customer_id]); // zero-hydration: the customer read here
    const customer = db.findCustomerById(tenantId, cart.customer_id);
    if (!customer) {
      throw new AppError("NOT_FOUND", `Customer not found: ${cart.customer_id}`, 404);
    }

    const recipientPhone = customer.phone;
    if (!recipientPhone) {
      throw new Error(`Customer ${customer.id} has no registered phone number.`);
    }

    // 1. Consent Check
    const hasConsent = consentService.hasConsent(tenantId, customer.id, "WHATSAPP");
    if (!hasConsent) {
      return {
        success: false,
        cart_id: cartId,
        recipient_phone: recipientPhone,
        channel: "WHATSAPP",
        message_content: "",
        error: "Customer has opted out of WhatsApp marketing communications.",
        factuality_verification: { price_verified: true, stock_verified: true, violations: [] },
      };
    }

    // 2. Frequency Cap Check
    const freqCheck = frequencyCappingService.checkFrequencyCap(tenantId, customer.id, "WHATSAPP");
    if (freqCheck.capped) {
      return {
        success: false,
        cart_id: cartId,
        recipient_phone: recipientPhone,
        channel: "WHATSAPP",
        message_content: "",
        error: `Frequency cap exceeded: ${freqCheck.reason}`,
        factuality_verification: { price_verified: true, stock_verified: true, violations: [] },
      };
    }

    // 3. Duplicate protection: Ensure no order was placed after cart creation
    const recentOrders = (await orderRepository.listOrders(tenantId, { customer_id: customer.id, limit: 500 })).orders; // newest first
    const cartTime = new Date(cart.abandoned_at).getTime();
    const placedAfter = recentOrders.some((o) => new Date(o.created_at).getTime() >= cartTime);
    if (placedAfter) {
      db.updateAbandonedCart(tenantId, cartId, { recovery_stage: "EXPIRED" });
      return {
        success: false,
        cart_id: cartId,
        recipient_phone: recipientPhone,
        channel: "WHATSAPP",
        message_content: "",
        error: "Customer completed an order after cart abandonment. Nudge suppressed.",
        factuality_verification: { price_verified: true, stock_verified: true, violations: [] },
      };
    }

    // 4. Synthesize Culturally Authentic Banglish Recovery Message
    const primaryItem = cart.cart_items[0];
    const customerName = customer.first_name || "সম্মানিত গ্রাহক";
    const productTitle = primaryItem ? primaryItem.title : "আপনার পছন্দের প্রোডাক্ট";
    const claimedPrice = primaryItem ? primaryItem.price : cart.abandoned_total_bdt;

    const discountText = customOfferCode ? ` এবং '${customOfferCode}' কোড দিয়ে বিশেষ ছাড় পান!` : "";
    const messageBody = `Assalamu Alaikum ${customerName}! Apnar cart-e '${productTitle}' roye geche! Stock khub simito. Ekhoni ৳${claimedPrice.toLocaleString()} mulle order shompurno korun${discountText}: https://commerceos.io/checkout/${cart.id}. Reply STOP to unsubscribe`;

    // 5. Factuality Verification against Commerce Core
    const factuality = contentService.verifyContentFactuality({
      tenantId,
      text: messageBody,
      productId: primaryItem?.product_id,
      claimedPrice,
      offerCode: customOfferCode,
    });

    if (!factuality.is_valid) {
      return {
        success: false,
        cart_id: cartId,
        recipient_phone: recipientPhone,
        channel: "WHATSAPP",
        message_content: messageBody,
        error: `Factuality verification failed: ${factuality.violations.join("; ")}`,
        factuality_verification: {
          price_verified: factuality.price_verified,
          stock_verified: factuality.stock_verified,
          violations: factuality.violations,
        },
      };
    }

    // 6. Dispatch message through WhatsApp adapter
    const dispatchResult = await marketingChannelService.dispatchMessage({
      tenantId,
      channel: "WHATSAPP",
      recipientId: recipientPhone,
      content: messageBody,
    });

    if (!dispatchResult.success) {
      return {
        success: false,
        cart_id: cartId,
        recipient_phone: recipientPhone,
        channel: "WHATSAPP",
        message_content: messageBody,
        error: dispatchResult.error_message || "WhatsApp dispatch failed",
        factuality_verification: { price_verified: true, stock_verified: true, violations: [] },
      };
    }

    // 7. Update status to MESSAGED
    db.updateAbandonedCart(tenantId, cartId, { recovery_stage: "MESSAGED" });

    return {
      success: true,
      cart_id: cartId,
      recipient_phone: recipientPhone,
      channel: "WHATSAPP",
      message_content: messageBody,
      external_message_id: dispatchResult.external_message_id,
      factuality_verification: {
        price_verified: true,
        stock_verified: true,
        violations: [],
      },
    };
  }

  /**
   * Marks an abandoned cart as recovered when an order is completed
   */
  public markCartRecovered(params: {
    tenantId: string;
    cartId: string;
    orderId: string;
  }): AbandonedCartRecoveryItem {
    const { tenantId, cartId, orderId } = params;

    const cart = db.getAbandonedCartById(tenantId, cartId);
    if (!cart || cart.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Cart not found: ${cartId}`, 404);
    }

    // The order must be a real order of this tenant; the request only names it (never invent an id)
    const order = db.findOrderById(tenantId, orderId);
    if (!order) {
      throw new NotFoundError("Order", orderId);
    }
    if (cart.customer_id && order.customer_id !== cart.customer_id) {
      throw new BadRequestError("The order belongs to a different customer than the abandoned cart.", {
        order_id: orderId,
      });
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError("A cancelled order cannot be credited as a cart recovery.", { order_id: orderId });
    }
    if (cart.recovery_stage === "RECOVERED" && cart.recovered_order_id) {
      if (cart.recovered_order_id === orderId) return cart; // repeat of the same credit: don't attribute twice
      throw new ConflictError("This cart is already credited to another order.", {
        recovered_order_id: cart.recovered_order_id,
      });
    }
    const creditedElsewhere = db
      .getAbandonedCarts(tenantId)
      .some((c) => c.id !== cartId && c.recovered_order_id === orderId);
    if (creditedElsewhere) {
      throw new ConflictError("This order is already credited to another abandoned cart.", { order_id: orderId });
    }

    // Recovered revenue is what the order is actually worth, never a value from the request
    const recoveredRevenue = order.grand_total;
    const updated = db.updateAbandonedCart(tenantId, cartId, {
      recovery_stage: "RECOVERED",
      recovered_order_id: orderId,
      recovered_revenue_bdt: recoveredRevenue,
    });

    return updated;
  }

  /**
   * ============================================================
   * 2. AUDIENCE COHORT SEGMENTATION CAPABILITY
   * ============================================================
   */

  /**
   * Audiences with their size counted against the shop's customers now. Sizes come from the same evaluator that
   * creates and refreshes audiences (AudienceService), so the list, the members and a refresh always agree.
   */
  public getAudienceCohorts(tenantId: string): Audience[] {
    const audiences = db.getAudiences(tenantId);
    const members = audienceService.evaluateMembers(tenantId, audiences); // contexts built once for all audiences
    return audiences.map((aud) => ({ ...aud, estimated_size: members.get(aud.id)?.length ?? 0 }));
  }

  /**
   * Evaluates and returns customer members for an audience cohort
   */
  public getAudienceMembers(tenantId: string, audienceId: string) {
    const audience = db.getAudienceById(tenantId, audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Audience not found: ${audienceId}`, 404);
    }
    const members = audienceService.evaluateMembers(tenantId, [audience]).get(audience.id) ?? [];
    return members.map((m) => ({
      id: m.customer.id,
      name: `${m.customer.first_name} ${m.customer.last_name || ""}`.trim(),
      phone: m.customer.phone,
      email: m.customer.email || "N/A",
      total_spend_bdt: m.totalSpend,
      order_count: m.orderCount,
      last_purchase_days_ago: m.lastPurchaseDaysAgo,
      has_abandoned_cart: m.hasAbandonedCart,
    }));
  }

  /**
   * Creates a custom audience cohort
   */
  public createAudienceCohort(params: {
    tenantId: string;
    name: string;
    description: string;
    type: Audience["type"];
    ruleGroups: Audience["rule_groups"];
    userId?: string;
  }): Audience {
    return audienceService.createAudience({
      tenantId: params.tenantId,
      name: params.name,
      description: params.description,
      type: params.type,
      ruleGroups: params.ruleGroups,
      createdBy: params.userId || "OPERATOR",
    });
  }

  /**
   * ============================================================
   * 3. AGGREGATE OVERVIEW & AI COPILOT
   * ============================================================
   */

  /**
   * Retrieves high-level marketing overview KPIs and AI Copilot recommendations
   */
  public getOverviewMetrics(tenantId: string): MarketingOverviewMetrics {
    const carts = db.getAbandonedCarts(tenantId);

    const recoveredCarts = carts.filter((c) => c.recovery_stage === "RECOVERED");
    const activeCarts = carts.filter((c) => c.recovery_stage === "PENDING" || c.recovery_stage === "MESSAGED");

    // Only carts credited to a verified order carry recovered revenue (its grand_total); older records count as 0
    const totalRecovered = recoveredCarts.reduce((sum, c) => sum + (c.recovered_revenue_bdt ?? 0), 0);
    const totalAbandoned = carts.reduce((sum, c) => sum + c.abandoned_total_bdt, 0);

    const recoveryRate = totalAbandoned > 0 ? Number(((totalRecovered / totalAbandoned) * 100).toFixed(1)) : 0;

    const dormant = db.getCustomerLifecycles(tenantId).filter((l) => l.stage === "DORMANT").length;

    // Built from the numbers above; an insight appears only when its data exists (FX-30). These were literal text
    // ("converting at 18.4%", "86 dormant customers", "Eid Winter Drop targets 240 recipients").
    const insights: MarketingOverviewMetrics["insights"] = [];
    if (carts.length > 0) {
      insights.push({
        id: "ins_cart_recovery",
        title: "Cart recovery",
        summary: `${recoveredCarts.length} of ${carts.length} abandoned carts recovered (${recoveryRate}% of abandoned value). ${activeCarts.length} still open.`,
        severity: recoveryRate < 10 && activeCarts.length > 0 ? "MEDIUM" : "LOW",
      });
    }
    if (dormant > 0) {
      insights.push({
        id: "ins_dormant",
        title: `${dormant} dormant customers`,
        summary: `${dormant} customers are in the dormant lifecycle stage and could be re-engaged.`,
        severity: "MEDIUM",
      });
    }
    return {
      total_recovered_revenue_bdt: totalRecovered,
      total_abandoned_revenue_bdt: totalAbandoned,
      cart_recovery_rate_pct: recoveryRate,
      active_abandoned_carts_count: activeCarts.length,
      insights,
    };
  }
}

export const marketingService = new MarketingService();
