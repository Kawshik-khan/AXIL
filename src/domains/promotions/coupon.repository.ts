/**
 * Phase E: Dedicated Database-Native Coupon Repository with OCC
 *
 * Implements query-on-demand point lookups, bounded keyset pagination,
 * and parameterized SQL mutations with Optimistic Concurrency Control (OCC)
 * on the commerceos.coupons table.
 */

import { db } from "@/infrastructure/db";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { StoreConflictError } from "@/infrastructure/store/pg-store";
import type { Coupon } from "@/types/commerce";
import {
  decodeCursor,
  encodeCursor,
  type CursorPaginatedResult,
} from "@/lib/cursor-pagination";

function parseJsonData<T>(raw: unknown): T {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

export interface CouponMutationOptions {
  expectedVersion?: number;
  tx?: { query: SqlClient["query"] };
}

export interface CouponPaginationOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

export class CouponRepository {
  /** SQL only when coupons is left out of memory (zero-hydration); otherwise the in-memory store is the source of truth. */
  private getClient(): SqlClient | null {
    return db.isCollectionHydrated("coupons") ? null : db.getSqlClient();
  }

  /**
   * Point query by normalized coupon code.
   * Leverages the unique index on commerceos.coupons(tenant_id, code).
   */
  async findByCode(tenantId: string, code: string): Promise<Coupon | null> {
    const normalized = code.trim().toUpperCase();
    const client = this.getClient();
    if (!client) {
      return db.findCouponByCode(tenantId, normalized) || null;
    }

    const res = await client.query<{ data: Coupon | string }>(
      `SELECT data FROM commerceos.coupons WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
      [tenantId, normalized]
    );

    if (res.rowCount === 0 || !res.rows[0]) return null;
    return parseJsonData<Coupon>(res.rows[0].data);
  }

  /**
   * Point query by coupon ID.
   */
  async findById(tenantId: string, id: string): Promise<Coupon | null> {
    const client = this.getClient();
    if (!client) {
      if (!db.isCollectionHydrated("coupons")) return null;
      return (db.data.coupons || []).find((c) => c.tenant_id === tenantId && c.id === id) || null;
    }

    const res = await client.query<{ data: Coupon | string }>(
      `SELECT data FROM commerceos.coupons WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );

    if (res.rowCount === 0 || !res.rows[0]) return null;
    return parseJsonData<Coupon>(res.rows[0].data);
  }

  /**
   * Keyset (Cursor) Pagination for Coupons.
   * Bounded retrieval avoiding memory scans.
   */
  async listWithCursor(
    tenantId: string,
    options?: CouponPaginationOptions
  ): Promise<CursorPaginatedResult<Coupon>> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const client = this.getClient();

    if (!client) {
      let list = db.isCollectionHydrated("coupons") ? (db.data.coupons || []) : [];
      list = list.filter((c) => c.tenant_id === tenantId);
      if (options?.status) {
        list = list.filter((c) => c.status === options.status);
      }
      list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

      let startIndex = 0;
      if (options?.cursor) {
        const decoded = decodeCursor(options.cursor);
        if (decoded) {
          startIndex = list.findIndex(
            (c) =>
              c.created_at < decoded.c ||
              (c.created_at === decoded.c && c.id < decoded.i)
          );
          if (startIndex === -1) startIndex = list.length;
        }
      }

      const paged = list.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < list.length;
      const last = paged[paged.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.created_at || new Date().toISOString(), last.id) : null;

      return {
        items: paged,
        pagination: {
          next_cursor: nextCursor,
          has_more: hasMore,
          limit,
        },
        total: list.length,
      };
    }

    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (options?.status) {
      conditions.push(`(data->>'status') = $${paramIndex}`);
      params.push(options.status);
      paramIndex++;
    }

    if (options?.cursor) {
      const decoded = decodeCursor(options.cursor);
      if (decoded) {
        conditions.push(`(created_at, id) < ($${paramIndex}::timestamptz, $${paramIndex + 1})`);
        params.push(decoded.c, decoded.i);
        paramIndex += 2;
      }
    }

    params.push(limit + 1);
    const sql = `
      SELECT id, created_at, data
      FROM commerceos.coupons
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${paramIndex}
    `;

    const res = await client.query<{ id: string; created_at: string; data: Coupon | string }>(sql, params);
    const hasMore = res.rows.length > limit;
    const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
    const items = rows.map((r) => parseJsonData<Coupon>(r.data));

    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

    return {
      items,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
    };
  }

  /**
   * Bounded async iterator for batch processing.
   */
  async *iterateByCursor(
    tenantId: string,
    options?: { batchSize?: number; status?: string }
  ): AsyncGenerator<Coupon[], void, unknown> {
    let cursor: string | null = null;
    const limit = options?.batchSize ?? 50;

    while (true) {
      const page = await this.listWithCursor(tenantId, {
        limit,
        cursor: cursor ?? undefined,
        status: options?.status,
      });

      if (page.items.length > 0) {
        yield page.items;
      }

      if (!page.pagination.has_more || !page.pagination.next_cursor) {
        break;
      }
      cursor = page.pagination.next_cursor;
    }
  }

  /**
   * Parameterized INSERT into commerceos.coupons.
   */
  async create(tenantId: string, coupon: Coupon, options?: { tx?: { query: SqlClient["query"] } }): Promise<Coupon> {
    const client = options?.tx ?? this.getClient();
    const normalized = coupon.code.trim().toUpperCase();
    const finalCoupon: Coupon = {
      ...coupon,
      tenant_id: tenantId,
      code: normalized,
      created_at: coupon.created_at || new Date().toISOString(),
    };

    if (!client) {
      return db.createCoupon(finalCoupon);
    }

    await client.query(
      `INSERT INTO commerceos.coupons (id, tenant_id, created_at, data, version)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, version = commerceos.coupons.version + 1`,
      [
        finalCoupon.id,
        tenantId,
        finalCoupon.created_at,
        JSON.stringify(finalCoupon),
      ]
    );

    // Sync in-memory store if hydrated
    if (db.isCollectionHydrated("coupons")) {
      const idx = (db.data.coupons || []).findIndex((c) => c.tenant_id === tenantId && c.id === finalCoupon.id);
      if (idx !== -1) {
        db.data.coupons[idx] = finalCoupon;
      } else {
        db.data.coupons.push(finalCoupon);
      }
    }

    return finalCoupon;
  }

  /**
   * Parameterized atomic UPDATE with Optimistic Concurrency Control (OCC).
   */
  async update(
    tenantId: string,
    id: string,
    updates: Partial<Coupon>,
    options?: CouponMutationOptions
  ): Promise<Coupon> {
    const client = options?.tx ?? this.getClient();

    if (!client) {
      const existing = (db.data.coupons || []).find((c) => c.tenant_id === tenantId && c.id === id);
      if (!existing) {
        throw new Error(`Coupon not found: ${id}`);
      }
      Object.assign(existing, updates);
      return existing;
    }

    // Read current row to merge & check version
    const currRes = await client.query<{ data: Coupon | string; version: string }>(
      `SELECT data, version::text AS version FROM commerceos.coupons WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id]
    );

    if (currRes.rowCount === 0 || !currRes.rows[0]) {
      throw new Error(`Coupon not found: ${id}`);
    }

    const currentVersion = Number(currRes.rows[0].version || "1");
    if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      throw new StoreConflictError([{ collection: "coupons", id }]);
    }

    const currentData = parseJsonData<Coupon>(currRes.rows[0].data);
    const mergedData: Coupon = {
      ...currentData,
      ...updates,
      id,
      tenant_id: tenantId,
    };

    const updateRes = await client.query<{ data: Coupon | string; version: string }>(
      `UPDATE commerceos.coupons
       SET data = $1::jsonb,
           version = version + 1,
           row_updated_at = now()
       WHERE tenant_id = $2 AND id = $3 AND version = $4
       RETURNING data, version::text AS version`,
      [
        JSON.stringify(mergedData),
        tenantId,
        id,
        currentVersion,
      ]
    );

    if (updateRes.rowCount === 0 || !updateRes.rows[0]) {
      throw new StoreConflictError([{ collection: "coupons", id }]);
    }

    // Sync in-memory if hydrated
    if (db.isCollectionHydrated("coupons")) {
      const idx = (db.data.coupons || []).findIndex((c) => c.tenant_id === tenantId && c.id === id);
      if (idx !== -1) {
        db.data.coupons[idx] = mergedData;
      }
    }

    return parseJsonData<Coupon>(updateRes.rows[0].data);
  }

  /**
   * Atomic usage increment in database.
   */
  async incrementUsage(
    tenantId: string,
    code: string,
    options?: { tx?: { query: SqlClient["query"] } }
  ): Promise<Coupon | null> {
    const normalized = code.trim().toUpperCase();
    const client = options?.tx ?? this.getClient();

    if (!client) {
      db.incrementCouponUsage(tenantId, normalized);
      return db.findCouponByCode(tenantId, normalized) || null;
    }

    const res = await client.query<{ data: Coupon | string }>(
      `UPDATE commerceos.coupons
       SET data = jsonb_set(
         data,
         '{usage_count}',
         to_jsonb(COALESCE((data->>'usage_count')::int, 0) + 1)
       ),
       version = version + 1,
       row_updated_at = now()
       WHERE tenant_id = $1 AND code = $2
       RETURNING data`,
      [tenantId, normalized]
    );

    if (res.rowCount === 0 || !res.rows[0]) return null;
    const updated = parseJsonData<Coupon>(res.rows[0].data);

    if (db.isCollectionHydrated("coupons")) {
      const idx = (db.data.coupons || []).findIndex((c) => c.tenant_id === tenantId && c.code === normalized);
      if (idx !== -1) {
        db.data.coupons[idx] = updated;
      }
    }

    return updated;
  }
}

export const couponRepository = new CouponRepository();
