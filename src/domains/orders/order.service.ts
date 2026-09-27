import { db } from "@/infrastructure/db";
import { Order, OrderItem, OrderStatus, PaymentMethod, CustomerSource } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { PricingService } from "@/domains/pricing/pricing.service";
import { CustomerService } from "@/domains/customers/customer.service";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { OrderStateMachine } from "@/domains/orders/order-state-machine";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class OrderService {
  public static async listOrders(
    context: RequestContext,
    options?: {
      status?: string;
      payment_status?: string;
      customer_id?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ orders: (Order & { customer_name: string; customer_phone: string })[]; total: number }> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_READ);
    return db.getOrders(context.tenant.id, options);
  }

  public static async getOrderById(
    context: RequestContext,
    orderId: string
  ): Promise<Order & { customer_name: string; customer_phone: string }> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_READ);
    const order = db.findOrderById(context.tenant.id, orderId);
    if (!order) {
      throw new NotFoundError(`Order '${orderId}' not found.`);
    }
    return order;
  }

  public static async createOrder(
    context: RequestContext,
    payload: {
      customer: {
        first_name: string;
        last_name: string;
        phone: string;
        email?: string;
      };
      delivery_address: {
        division: string;
        district: string;
        upazila?: string;
        area?: string;
        address_line_1: string;
        postal_code?: string;
      };
      delivery_zone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
      items: Array<{ variant_id: string; quantity: number }>;
      payment_method: PaymentMethod;
      coupon_code?: string;
      notes?: string;
      source?: CustomerSource;
      warehouse_id?: string;
    }
  ): Promise<Order> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_CREATE);

    if (!payload.items || payload.items.length === 0) {
      throw new BadRequestError("An order must contain at least one item.");
    }
    if (!payload.customer || !payload.customer.phone) {
      throw new BadRequestError("Customer phone number is required.");
    }

    // 1. Resolve or create customer profile
    let customer = await CustomerService.getCustomerByPhone(context, payload.customer.phone);
    if (!customer) {
      customer = await CustomerService.createCustomer(context, {
        first_name: payload.customer.first_name || "Guest",
        last_name: payload.customer.last_name || "Customer",
        phone: payload.customer.phone,
        email: payload.customer.email,
        source: payload.source || "MANUAL",
        address: payload.delivery_address,
      });
    }

    // 2. Perform authoritative server-side price calculation
    const pricing = await PricingService.calculateOrderPricing(
      context.tenant.id,
      payload.items,
      payload.delivery_zone,
      payload.coupon_code
    );

    // 3. Resolve warehouse for inventory allocation
    const warehouseId =
      payload.warehouse_id ||
      db.getWarehouses(context.tenant.id)[0]?.id ||
      "wh_dhaka_main";

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const orderNumber = db.generateOrderNumber(context.tenant.id);
    const now = new Date().toISOString();

    // 4. Atomically reserve inventory for all items
    const reservations: string[] = [];
    try {
      for (const item of payload.items) {
        const res = await InventoryService.reserveStock(context, {
          order_id: orderId,
          warehouse_id: warehouseId,
          product_variant_id: item.variant_id,
          quantity: item.quantity,
        });
        reservations.push(res.id);
      }
    } catch (err: any) {
      // Rollback any partially created reservations if one fails
      for (const resId of reservations) {
        await InventoryService.releaseReservation(context, resId);
      }
      throw new BadRequestError(`Inventory reservation failed: ${err.message}`);
    }

    // 5. Construct order items with snapshots
    const orderItems: OrderItem[] = pricing.items.map((computed, idx) => ({
      id: `item_${orderId}_${idx + 1}`,
      tenant_id: context.tenant.id,
      order_id: orderId,
      product_id: computed.product_id,
      variant_id: computed.variant_id,
      product_name_snapshot: computed.product_name_snapshot,
      sku_snapshot: computed.sku_snapshot,
      unit_price: computed.unit_price,
      quantity: computed.quantity,
      discount: computed.discount,
      tax: computed.tax,
      line_total: computed.line_total,
    }));

    // 6. Construct and persist order
    const newOrder: Order = {
      id: orderId,
      tenant_id: context.tenant.id,
      order_number: orderNumber,
      customer_id: customer.id,
      status: "PENDING",
      currency: "BDT",
      subtotal: pricing.subtotal,
      discount_total: pricing.discount_total,
      shipping_total: pricing.shipping_total,
      tax_total: pricing.tax_total,
      grand_total: pricing.grand_total,
      payment_method: payload.payment_method,
      payment_status: payload.payment_method === "COD" ? "PENDING" : "UNPAID",
      fulfillment_status: "UNFULFILLED",
      shipping_address_snapshot: {
        country: "Bangladesh",
        division: payload.delivery_address.division,
        district: payload.delivery_address.district,
        upazila: payload.delivery_address.upazila,
        area: payload.delivery_address.area,
        address_line_1: payload.delivery_address.address_line_1,
        postal_code: payload.delivery_address.postal_code,
        phone: customer.phone,
      },
      coupon_code: pricing.applied_coupon,
      notes: payload.notes,
      source: payload.source || "MANUAL",
      created_at: now,
      updated_at: now,
    };

    const createdOrder = db.createOrder(newOrder, orderItems);

    // 7. Increment coupon usage if used
    if (pricing.applied_coupon) {
      db.incrementCouponUsage(context.tenant.id, pricing.applied_coupon);
    }

    // 8. Create canonical domain event
    db.recordEvent({
      id: `evt_${Date.now()}_order_created`,
      type: "order.created",
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "order",
      aggregate_id: orderId,
      actor_id: context.user.id,
      correlation_id: orderNumber,
      timestamp: now,
      payload: {
        order_number: orderNumber,
        grand_total: newOrder.grand_total,
        customer_phone: customer.phone,
        item_count: orderItems.length,
      },
    });

    // 9. Audit logging
    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "ORDER_CREATED",
      resource_type: "order",
      resource_id: orderId,
      metadata: {
        order_number: orderNumber,
        grand_total: newOrder.grand_total,
        payment_method: newOrder.payment_method,
      },
      created_at: now,
    });

    return createdOrder;
  }

  public static async transitionOrderStatus(
    context: RequestContext,
    orderId: string,
    targetStatus: OrderStatus,
    reason?: string
  ): Promise<Order> {
    RbacService.assertCan(context, PERMISSIONS.ORDERS_UPDATE);

    const order = await this.getOrderById(context, orderId);

    // Validate state machine rule
    OrderStateMachine.assertTransition(order.status, targetStatus);

    // If cancelling, release all active reservations for this order
    if (targetStatus === "CANCELLED") {
      const reservations = db.getInventory(context.tenant.id); // Triggers db lookup
      // In db data, find reservations matching order_id
      const allRes = (db as any).data.inventory_reservations.filter(
        (r: any) => r.tenant_id === context.tenant.id && r.order_id === orderId && r.status === "ACTIVE"
      );
      for (const res of allRes) {
        db.releaseReservation(context.tenant.id, res.id);
      }
    }

    // If transitioning to SHIPPED or DELIVERED, commit reservations if not committed yet
    if (targetStatus === "SHIPPED" || targetStatus === "DELIVERED") {
      const activeRes = (db as any).data.inventory_reservations.filter(
        (r: any) => r.tenant_id === context.tenant.id && r.order_id === orderId && r.status === "ACTIVE"
      );
      for (const res of activeRes) {
        db.commitReservation(context.tenant.id, res.id, context.user.id);
      }
    }

    const updated = db.updateOrderStatus(context.tenant.id, orderId, targetStatus);
    if (!updated) {
      throw new NotFoundError(`Order '${orderId}' not found.`);
    }

    // Record domain event
    db.recordEvent({
      id: `evt_${Date.now()}_order_${targetStatus.toLowerCase()}`,
      type: `order.${targetStatus.toLowerCase()}`,
      version: "1.0",
      tenant_id: context.tenant.id,
      aggregate_type: "order",
      aggregate_id: orderId,
      actor_id: context.user.id,
      correlation_id: order.order_number,
      timestamp: new Date().toISOString(),
      payload: {
        order_number: order.order_number,
        previous_status: order.status,
        new_status: targetStatus,
        reason: reason || "User initiated transition",
      },
    });

    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: `ORDER_STATUS_${targetStatus}`,
      resource_type: "order",
      resource_id: orderId,
      metadata: { previous: order.status, next: targetStatus, reason },
      created_at: new Date().toISOString(),
    });

    return updated;
  }
}
