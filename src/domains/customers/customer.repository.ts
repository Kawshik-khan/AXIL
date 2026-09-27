/**
 * CommerceOS — Customer Repository
 * Authoritative data access for customers and addresses via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Customer, CustomerAddress } from '@/types/commerce';

export class CustomerRepository extends BaseRepository<Customer & Record<string, unknown>> {
  constructor() {
    super('customers', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    if (!this.isNeonConfigured()) {
      return db.findCustomerById(tenantId, id) || null;
    }
    const customer = await queryOne<Customer>(
      `SELECT * FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    return customer;
  }

  async findByPhone(tenantId: string, phone: string): Promise<Customer | null> {
    if (!this.isNeonConfigured()) {
      return db.findCustomerByPhone(tenantId, phone) || null;
    }
    return queryOne<Customer>(
      `SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, phone]
    );
  }

  async findByEmail(tenantId: string, email: string): Promise<Customer | null> {
    if (!this.isNeonConfigured()) {
      return db.findCustomerByEmail(tenantId, email) || null;
    }
    return queryOne<Customer>(
      `SELECT * FROM customers WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
      [tenantId, email]
    );
  }

  async listCustomers(
    tenantId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ): Promise<{ customers: Customer[]; total: number }> {
    if (!this.isNeonConfigured()) {
      return db.getCustomers(tenantId, options);
    }

    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (options?.search) {
      whereSQL += ` AND (full_name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`;
      params.push(`%${options.search}%`);
      idx++;
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM customers WHERE ${whereSQL}`,
      params
    );
    const total = parseInt(countRes[0]?.count || '0', 10);

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const customers = await query<Customer>(
      `SELECT * FROM customers WHERE ${whereSQL} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return { customers, total };
  }

  async createCustomer(customer: Customer): Promise<Customer> {
    if (!this.isNeonConfigured()) {
      return db.createCustomer(customer);
    }

    const created = await queryOne<Customer>(
      `INSERT INTO customers (
        id, tenant_id, full_name, email, phone, district, default_address, tags, total_orders, total_spent, is_blacklisted, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        customer.id,
        customer.tenant_id,
        customer.full_name || customer.name || null,
        customer.email || null,
        customer.phone,
        customer.district || null,
        JSON.stringify(customer.default_address || null),
        JSON.stringify(customer.tags || []),
        customer.total_orders || 0,
        customer.total_spent || 0,
        customer.is_blacklisted || false,
        customer.created_at || new Date().toISOString(),
        customer.updated_at || new Date().toISOString(),
      ]
    );

    db.createCustomer(customer);
    return created || customer;
  }

  async updateCustomer(tenantId: string, id: string, updates: Partial<Customer>): Promise<Customer | null> {
    if (!this.isNeonConfigured()) {
      return db.updateCustomer(tenantId, id, updates) || null;
    }
    const updated = await this.update(tenantId, id, updates);
    if (updated) {
      db.updateCustomer(tenantId, id, updates);
    }
    return updated;
  }
}

export const customerRepository = new CustomerRepository();
