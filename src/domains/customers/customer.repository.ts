/**
 * CommerceOS — Customer Repository
 * Authoritative data access for customers and customer addresses.
 *
 * Implements high-performance Keyset (Cursor) Pagination over Neon PostgreSQL (commerceos schema)
 * with seamless fallback to in-memory store for offline test execution.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { db } from '@/infrastructure/db';
import type { SqlClient, SqlExecutor } from '@/infrastructure/store/sql-client';
import { StoreConflictError } from '@/infrastructure/store/pg-store';
import { orderRepository } from '@/domains/orders/order.repository';
import { randomSuffix } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { NotFoundError } from '@/lib/errors';
import { Customer, CustomerAddress } from '@/types/commerce';
import {
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  sliceForCursor,
  pageLimit,
  pageOffset,
  type CursorPaginatedResult,
} from '@/lib/cursor-pagination';

function parseJsonData<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

export class CustomerRepository extends BaseRepository<Customer> {
  constructor() {
    super('customers', 'id');
  }

  /** SQL only when customers is left out of memory (zero-hydration); otherwise the in-memory store is the source of truth. */
  private getClient(): SqlClient | null {
    return db.isCollectionHydrated("customers") ? null : db.getSqlClient();
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    const client = this.getClient();
    if (!client) {
      return db.findCustomerById(tenantId, id) || null;
    }

    const rowRes = await client.query<{ data: Customer | string }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;
    return (await this.withAddresses(client, tenantId, [parseJsonData<Customer>(row.data)]))[0];
  }

  /** Customers with their addresses, as db.findCustomerById / db.getCustomers return them. */
  private async withAddresses(client: SqlExecutor, tenantId: string, customers: Customer[]): Promise<Customer[]> {
    if (customers.length === 0) return [];
    const res = await client.query<{ customer_id: string; data: CustomerAddress | string }>(
      `SELECT customer_id, data FROM commerceos.customer_addresses WHERE tenant_id = $1 AND customer_id = ANY($2::text[]) ORDER BY seq`,
      [tenantId, customers.map((c) => c.id)]
    );
    const byCustomer = new Map<string, CustomerAddress[]>();
    for (const r of res.rows) {
      const list = byCustomer.get(r.customer_id) ?? [];
      list.push(parseJsonData<CustomerAddress>(r.data));
      byCustomer.set(r.customer_id, list);
    }
    return customers.map((c) => ({ ...c, addresses: byCustomer.get(c.id) ?? [] }));
  }

  /**
   * One page of customers, newest first, with addresses: db.getCustomers, in SQL under zero-hydration (search on
   * first name, last name, phone or email).
   */
  async listCustomers(
    tenantId: string,
    options: { search?: string; limit: number; offset?: number }
  ): Promise<{ customers: Customer[]; total: number }> {
    const client = this.getClient();
    if (!client) return db.getCustomers(tenantId, options);
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1`;
    const q = options.search?.toLowerCase().trim().slice(0, 200);
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const p = `$${params.length}`;
      where += ` AND (lower(data->>'first_name') LIKE ${p} OR lower(data->>'last_name') LIKE ${p} OR phone LIKE ${p} OR email_key LIKE ${p})`;
    }
    const countRes = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM commerceos.customers WHERE ${where}`, params);
    params.push(pageLimit(options.limit), pageOffset(options.offset));
    const rowsRes = await client.query<{ data: Customer | string }>(
      `SELECT data FROM commerceos.customers WHERE ${where}
       ORDER BY created_at DESC NULLS LAST, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const customers = await this.withAddresses(client, tenantId, rowsRes.rows.map((r) => parseJsonData<Customer>(r.data)));
    return { customers, total: Number(countRes.rows[0]?.n ?? 0) };
  }

  async findByPhone(tenantId: string, phone: string): Promise<Customer | null> {
    const client = this.getClient();
    if (!client) {
      return db.findCustomerByPhone(tenantId, phone) || null;
    }

    const rowRes = await client.query<{ data: Customer | string }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, phone]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;
    return parseJsonData<Customer>(row.data);
  }

  async findAllByPhone(tenantId: string, phone: string): Promise<Customer[]> {
    const client = this.getClient();
    if (client) {
      const rowRes = await client.query<{ data: Customer | string }>(
        `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND phone = $2`,
        [tenantId, phone]
      );
      return rowRes.rows.map((r) => parseJsonData<Customer>(r.data));
    }
    return db.getAllCustomers(tenantId).filter((c) => c.phone === phone && Boolean(phone));
  }

  async findByIds(tenantId: string, ids: string[]): Promise<Customer[]> {
    if (!ids.length) return [];
    const client = this.getClient();
    if (client) {
      const rowRes = await client.query<{ data: Customer | string }>(
        `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, ids]
      );
      return rowRes.rows.map((r) => parseJsonData<Customer>(r.data));
    }
    return ids.map((id) => db.findCustomerById(tenantId, id)).filter(Boolean) as Customer[];
  }

  async existsById(tenantId: string, id: string): Promise<boolean> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM commerceos.customers WHERE tenant_id = $1 AND id = $2) AS exists`,
        [tenantId, id]
      );
      return Boolean(res.rows[0]?.exists);
    }
    return Boolean(db.findCustomerById(tenantId, id));
  }

  async findByEmail(tenantId: string, email: string): Promise<Customer | null> {
    const client = this.getClient();
    if (!client) {
      const match = db.getAllCustomers(tenantId).find((c) => c.email?.toLowerCase() === email.toLowerCase());
      return match || null;
    }

    const normalized = email.trim().toLowerCase();
    const rowRes = await client.query<{ data: Customer | string }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND email_key = $2 LIMIT 1`,
      [tenantId, normalized]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;
    return parseJsonData<Customer>(row.data);
  }

  async countByTenant(tenantId: string, status?: string): Promise<number> {
    const client = this.getClient();
    if (client) {
      const sql = status
        ? `SELECT count(*)::text AS total FROM commerceos.customers WHERE tenant_id = $1 AND status = $2`
        : `SELECT count(*)::text AS total FROM commerceos.customers WHERE tenant_id = $1`;
      const params = status ? [tenantId, status] : [tenantId];
      const res = await client.query<{ total: string }>(sql, params);
      return Number(res.rows[0]?.total ?? 0);
    }
    const all = db.getAllCustomers(tenantId);
    return status ? all.filter((c) => c.status === status).length : all.length;
  }

  /**
   * Keyset (Cursor) Pagination for Customers.
   * Avoids scanning and discarding rows; queries index (created_at DESC, id DESC).
   */
  async listWithCursor(
    tenantId: string,
    options?: {
      search?: string;
      limit?: number;
      cursor?: string;
    }
  ): Promise<CursorPaginatedResult<Customer>> {
    const limit = options?.limit ?? 20;
    const client = this.getClient();

    if (!client) {
      let list = db.getAllCustomers(tenantId);
      if (options?.search) {
        const q = options.search.toLowerCase().trim();
        list = list.filter(
          (c) =>
            `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.email?.toLowerCase().includes(q)
        );
      }
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return sliceForCursor(list, limit, options?.cursor);
    }

    const params: unknown[] = [tenantId];
    let whereSQL = `tenant_id = $1`;
    let nextIdx = 2;

    if (options?.search) {
      whereSQL += ` AND (phone ILIKE $${nextIdx} OR email_key ILIKE $${nextIdx} OR data->>'first_name' ILIKE $${nextIdx} OR data->>'last_name' ILIKE $${nextIdx})`;
      params.push(`%${options.search}%`);
      nextIdx++;
    }

    const decoded = decodeCursor(options?.cursor);
    const keyset = buildKeysetClause(decoded, nextIdx);
    whereSQL += keyset.sqlClause;
    params.push(...keyset.params);
    nextIdx = keyset.nextParamIndex;

    const fetchLimit = limit + 1;
    const querySQL = `
      SELECT id, created_at, data
      FROM commerceos.customers
      WHERE ${whereSQL}
      ORDER BY created_at DESC, id DESC
      LIMIT $${nextIdx}
    `;
    params.push(fetchLimit);

    const rowsRes = await client.query<{ id: string; created_at: string; data: Customer | string }>(
      querySQL,
      params
    );
    const rows = rowsRes.rows;

    const hasMore = rows.length > limit;
    const pagedRows = hasMore ? rows.slice(0, limit) : rows;

    const customers: Customer[] = pagedRows.map((r) => parseJsonData<Customer>(r.data));

    let nextCursor: string | null = null;
    if (hasMore && pagedRows.length > 0) {
      const last = pagedRows[pagedRows.length - 1];
      const lastCreatedAt = last.created_at || (parseJsonData<Customer>(last.data) as any)?.created_at || new Date().toISOString();
      nextCursor = encodeCursor(lastCreatedAt, last.id);
    }

    return {
      items: customers,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
    };
  }

  /**
   * Bounded cursor iteration over customers for batch/analytics workloads (ADR-109, Phase D).
   * Streams customers in chunks without loading all customers into Node.js memory.
   */
  async *iterateByCursor(
    tenantId: string,
    options?: { batchSize?: number; search?: string }
  ): AsyncIterable<Customer[]> {
    const limit = Math.min(Math.max(options?.batchSize ?? 100, 1), 1000);
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const page = await this.listWithCursor(tenantId, {
        limit,
        cursor: cursor ?? undefined,
        search: options?.search,
      });

      if (page.items.length > 0) {
        yield page.items;
      }

      cursor = page.pagination.next_cursor;
      hasMore = page.pagination.has_more && Boolean(cursor);
    }
  }

  /**
   * Semantic customer anonymization (P0 - Zero-Hydration write path).
   * Atomically anonymizes customer PII in commerceos.customers.
   */
  async anonymize(tenantId: string, customerId: string, tx?: SqlExecutor): Promise<boolean> {
    const executor = tx || this.getClient();
    if (executor) {
      const res = await executor.query(
        `UPDATE commerceos.customers
         SET data = (data - 'email' - 'notes') || jsonb_build_object(
           'first_name', 'Erased',
           'last_name', 'customer',
           'phone', '',
           'addresses', '[]'::jsonb,
           'updated_at', now()::text
         ),
         row_updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, customerId]
      );
      if (res.rowCount === 0) return false;
    }
    if (db.isCollectionHydrated("customers")) {
      const memCust = db.data.customers.find((c) => c.tenant_id === tenantId && c.id === customerId);
      if (memCust) {
        Object.assign(memCust, {
          first_name: "Erased",
          last_name: "customer",
          phone: "",
          notes: undefined,
          addresses: [],
          updated_at: new Date().toISOString(),
        });
        delete (memCust as { email?: string }).email;
      }
    }
    return true;
  }

  /**
   * Semantic repository mutation for updating a customer (Phase D - Write-Path Decoupling).
   * Executes parameterized atomic UPDATE with optional optimistic concurrency control via version.
   */
  async update(
    tenantId: string,
    customerId: string,
    updates: Partial<Customer>,
    options?: { expectedVersion?: number; tx?: SqlExecutor }
  ): Promise<Customer | null> {
    const executor = options?.tx || this.getClient();
    if (executor) {
      let sql = `UPDATE commerceos.customers
                 SET data = data || $3::jsonb,
                     version = version + 1,
                     row_updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`;
      const params: unknown[] = [tenantId, customerId, JSON.stringify(updates)];
      if (options?.expectedVersion !== undefined) {
        sql += ` AND version = $4`;
        params.push(options.expectedVersion);
      }
      sql += ` RETURNING data, version::text AS version`;

      const res = await executor.query<{ data: Customer | string; version: string }>(sql, params);
      if (res.rowCount === 0) {
        if (options?.expectedVersion !== undefined) {
          const check = await executor.query<{ version: string }>(
            `SELECT version::text AS version FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
            [tenantId, customerId]
          );
          if (check.rowCount && check.rows[0].version !== String(options.expectedVersion)) {
            throw new StoreConflictError([{ collection: "customers", id: customerId }]);
          }
        }
        return null;
      }
      const updated = parseJsonData<Customer>(res.rows[0].data);
      if (db.isCollectionHydrated("customers")) {
        const idx = db.data.customers.findIndex((c) => c.tenant_id === tenantId && c.id === customerId);
        if (idx !== -1) {
          db.data.customers[idx] = { ...db.data.customers[idx], ...updates, updated_at: new Date().toISOString() };
        }
      }
      return updated;
    }

    // In-memory fallback
    const memCust = db.findCustomerById(tenantId, customerId);
    if (!memCust) return null;
    Object.assign(memCust, updates, { updated_at: new Date().toISOString() });
    return memCust;
  }
}

export const customerRepository = new CustomerRepository();
