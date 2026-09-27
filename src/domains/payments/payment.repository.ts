/**
 * CommerceOS — Payment Repository
 * Authoritative data access for payments and refunds via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Payment, PaymentStatus } from '@/types/commerce';

export class PaymentRepository extends BaseRepository<any> {
  constructor() {
    super('payments', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(tenantId: string, id: string): Promise<Payment | null> {
    if (!this.isNeonConfigured()) {
      return db.findPaymentById(tenantId, id) || null;
    }
    return queryOne<Payment>(
      `SELECT * FROM payments WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
  }

  async findByIdempotency(tenantId: string, idempotencyKey: string): Promise<Payment | null> {
    if (!this.isNeonConfigured()) {
      return db.findPaymentByIdempotency(tenantId, idempotencyKey) || null;
    }
    return queryOne<Payment>(
      `SELECT * FROM payments WHERE tenant_id = $1 AND raw_response->>'idempotency_key' = $2 LIMIT 1`,
      [tenantId, idempotencyKey]
    );
  }

  async listPayments(tenantId: string, orderId?: string): Promise<Payment[]> {
    if (!this.isNeonConfigured()) {
      return db.getPayments(tenantId, orderId);
    }
    if (orderId) {
      return query<Payment>(
        `SELECT * FROM payments WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC`,
        [tenantId, orderId]
      );
    }
    return query<Payment>(
      `SELECT * FROM payments WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
  }

  async createPayment(payment: Payment): Promise<Payment> {
    if (!this.isNeonConfigured()) {
      return db.createPayment(payment);
    }

    const created = await queryOne<Payment>(
      `INSERT INTO payments (
        id, tenant_id, order_id, provider, transaction_id, amount,
        currency, status, raw_response, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        payment.id,
        payment.tenant_id,
        payment.order_id,
        payment.provider,
        payment.transaction_id || null,
        payment.amount,
        payment.currency || 'BDT',
        payment.status || 'INITIATED',
        JSON.stringify({ idempotency_key: payment.idempotency_key }),
        payment.created_at || new Date().toISOString(),
      ]
    );

    const result: Payment = {
      ...payment,
      ...(created || {}),
      amount: Number(created?.amount ?? payment.amount),
    };

    db.createPayment(result);
    return result;
  }

  async updatePayment(payment: Payment): Promise<Payment> {
    if (!this.isNeonConfigured()) {
      return (db as any).updatePayment ? (db as any).updatePayment(payment) : payment;
    }
    const updated = await queryOne<Payment>(
      `UPDATE payments SET status = $1, transaction_id = $2, verified_at = $3 WHERE tenant_id = $4 AND id = $5 RETURNING *`,
      [
        payment.status,
        payment.transaction_id || null,
        (payment.status as string) === 'CAPTURED' ? new Date().toISOString() : null,
        payment.tenant_id,
        payment.id,
      ]
    );
    if ((db as any).updatePayment) (db as any).updatePayment(payment);
    const result: Payment = {
      ...payment,
      ...(updated || {}),
      amount: Number(updated?.amount ?? payment.amount),
    };
    return result;
  }
}

export const paymentRepository = new PaymentRepository();
