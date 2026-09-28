/**
 * CommerceOS — Order Repository
 * Authoritative data access for orders and order items via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute, withTransaction } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Order, OrderItem, OrderStatus } from '@/types/commerce';

export class OrderRepository extends BaseRepository<any> {
  constructor() {
    super('orders', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(
    tenantId: string,
    id: string
  ): Promise<(Order & { customer_name: string; customer_phone: string }) | null> {
    if (!this.isNeonConfigured()) {
      return db.findOrderById(tenantId, id) || null;
    }

    const order = await queryOne<any>(
      `SELECT 
        o.*,
        c.full_name as customer_name,
        c.phone as customer_phone
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id AND o.tenant_id = c.tenant_id
      WHERE o.tenant_id = $1 AND o.id = $2 LIMIT 1`,
      [tenantId, id]
    );
    if (!order) return null;

    const items = await query<OrderItem>(
      `SELECT * FROM order_items WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, id]
    );

    return {
      ...order,
      subtotal: Number(order.subtotal),
      delivery_charge: Number(order.delivery_charge),
      discount: Number(order.discount),
      total: Number(order.total),
      items,
    };
  }

  async listOrders(
    tenantId: string,
    options?: {
      status?: string;
      payment_status?: string;
      customer_id?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ orders: (Order & { customer_name: string; customer_phone: string })[]; total: number }> {
    if (!this.isNeonConfigured()) {
      return db.getOrders(tenantId, { ...options, limit: options?.limit ?? 50 });
    }

    let whereSQL = `o.tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (options?.status) {
      whereSQL += ` AND o.status = $${idx++}`;
      params.push(options.status);
    }
    if (options?.payment_status) {
      whereSQL += ` AND o.payment_status = $${idx++}`;
      params.push(options.payment_status);
    }
    if (options?.customer_id) {
      whereSQL += ` AND o.customer_id = $${idx++}`;
      params.push(options.customer_id);
    }
    if (options?.search) {
      whereSQL += ` AND (o.order_number ILIKE $${idx} OR c.full_name ILIKE $${idx} OR c.phone ILIKE $${idx})`;
      params.push(`%${options.search}%`);
      idx++;
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE ${whereSQL}`,
      params
    );
    const total = parseInt(countRes[0]?.count || '0', 10);

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const orders = await query<any>(
      `SELECT 
        o.*,
        c.full_name as customer_name,
        c.phone as customer_phone
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id AND o.tenant_id = c.tenant_id
      WHERE ${whereSQL}
      ORDER BY o.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return {
      orders: orders.map((o) => ({
        ...o,
        subtotal: Number(o.subtotal),
        delivery_charge: Number(o.delivery_charge),
        discount: Number(o.discount),
        total: Number(o.total),
        items: o.items || [],
      })),
      total,
    };
  }

  async createOrder(order: Order, items?: OrderItem[]): Promise<Order> {
    const orderItems = items || order.items || [];
    if (!this.isNeonConfigured()) {
      return db.createOrder(order, orderItems);
    }

    const ord = order as any;
    return withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orders (
          id, tenant_id, order_number, customer_id, status,
          subtotal, delivery_charge, discount, total,
          payment_method, payment_status, delivery_address, delivery_zone,
          courier_provider, notes, tags, source, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          ord.id,
          ord.tenant_id,
          ord.order_number,
          ord.customer_id,
          ord.status,
          ord.subtotal,
          ord.delivery_charge,
          ord.discount,
          ord.total,
          ord.payment_method,
          ord.payment_status,
          JSON.stringify(ord.delivery_address || {}),
          ord.delivery_zone || 'INSIDE_DHAKA',
          ord.courier_provider || null,
          ord.notes || null,
          JSON.stringify(ord.tags || []),
          ord.source || 'MANUAL',
          JSON.stringify(ord.metadata || {}),
          ord.created_at || new Date().toISOString(),
          ord.updated_at || new Date().toISOString(),
        ]
      );

      for (const item of orderItems) {
        const itm = item as any;
        await client.query(
          `INSERT INTO order_items (
            id, tenant_id, order_id, product_variant_id,
            product_title, variant_title, sku, quantity, unit_price, total_price
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            itm.id,
            ord.tenant_id,
            ord.id,
            itm.product_variant_id || itm.variant_id,
            itm.product_name || itm.title || '',
            itm.variant_title || '',
            itm.sku || '',
            itm.quantity,
            itm.unit_price,
            itm.total_price || itm.unit_price * itm.quantity,
          ]
        );
      }

      db.createOrder(order, orderItems);
      return { ...order, items: orderItems };
    });
  }

  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    status: OrderStatus
  ): Promise<Order | null> {
    if (!this.isNeonConfigured()) {
      return db.updateOrderStatus(tenantId, orderId, status) || null;
    }
    const updated = await queryOne<Order>(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE tenant_id = $2 AND id = $3 RETURNING *`,
      [status, tenantId, orderId]
    );
    db.updateOrderStatus(tenantId, orderId, status);
    return updated;
  }
}

export const orderRepository = new OrderRepository();
