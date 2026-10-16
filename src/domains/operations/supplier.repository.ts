/**
 * Phase E: Dedicated Database-Native Supplier & Purchase Order Repository with OCC
 *
 * Provides query-on-demand lookups, bounded keyset pagination, and parameterized
 * SQL mutations with Optimistic Concurrency Control (OCC) for suppliers, supplier products,
 * and purchase orders.
 */

import { db } from "@/infrastructure/db";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { StoreConflictError } from "@/infrastructure/store/pg-store";
import type {
  Supplier,
  SupplierProduct,
  PurchaseOrder,
  PurchaseOrderStatus,
} from "@/types/operations";
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

export interface PurchaseOrderPaginationOptions {
  limit?: number;
  cursor?: string;
  status?: PurchaseOrderStatus;
}

export class SupplierRepository {
  /** SQL only when suppliers is left out of memory (zero-hydration); otherwise the in-memory store is the source of truth. */
  private getClient(): SqlClient | null {
    return db.isCollectionHydrated("suppliers") ? null : db.getSqlClient();
  }

  // ==================== SUPPLIERS ====================

  async findSupplierById(tenantId: string, id: string): Promise<Supplier | null> {
    const client = this.getClient();
    if (!client) {
      return db.findSupplierById(tenantId, id) || null;
    }

    const res = await client.query<{ data: Supplier | string }>(
      `SELECT data FROM commerceos.documents WHERE collection = 'suppliers' AND tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );

    if (res.rowCount === 0 || !res.rows[0]) return null;
    return parseJsonData<Supplier>(res.rows[0].data);
  }

  async listSuppliers(
    tenantId: string,
    options?: { status?: "ACTIVE" | "SUSPENDED" }
  ): Promise<Supplier[]> {
    const client = this.getClient();
    if (!client) {
      const list = db.getSuppliers(tenantId);
      return options?.status ? list.filter((s) => s.status === options.status) : list;
    }

    const conditions = ["collection = 'suppliers'", "tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (options?.status) {
      conditions.push("(data->>'status') = $2");
      params.push(options.status);
    }

    const res = await client.query<{ data: Supplier | string }>(
      `SELECT data FROM commerceos.documents WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params
    );

    return res.rows.map((r) => parseJsonData<Supplier>(r.data));
  }

  async getSupplierProducts(tenantId: string, supplierId?: string): Promise<SupplierProduct[]> {
    const client = this.getClient();
    if (!client) {
      return db.getSupplierProducts(tenantId, supplierId);
    }

    const conditions = ["collection = 'supplier_products'", "tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (supplierId) {
      conditions.push("(data->>'supplier_id') = $2");
      params.push(supplierId);
    }

    const res = await client.query<{ data: SupplierProduct | string }>(
      `SELECT data FROM commerceos.documents WHERE ${conditions.join(" AND ")}`,
      params
    );

    return res.rows.map((r) => parseJsonData<SupplierProduct>(r.data));
  }

  async createSupplierProduct(tenantId: string, sp: SupplierProduct): Promise<SupplierProduct> {
    const client = this.getClient();
    const finalSp: SupplierProduct = {
      ...sp,
      tenant_id: tenantId,
      created_at: sp.created_at || new Date().toISOString(),
      updated_at: sp.updated_at || new Date().toISOString(),
    };

    if (!client) {
      return db.createSupplierProduct(finalSp);
    }

    await client.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version)
       VALUES ('supplier_products', $1, $2, $3::timestamptz, $4::jsonb, 1)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, version = commerceos.documents.version + 1`,
      [finalSp.id, tenantId, finalSp.created_at, JSON.stringify(finalSp)]
    );

    if (db.isCollectionHydrated("supplier_products")) {
      const idx = (db.data.supplier_products || []).findIndex((p) => p.tenant_id === tenantId && p.id === finalSp.id);
      if (idx !== -1) (db.data.supplier_products || [])[idx] = finalSp;
      else (db.data.supplier_products || []).push(finalSp);
    }

    return finalSp;
  }

  async createSupplier(tenantId: string, supplier: Supplier): Promise<Supplier> {
    const client = this.getClient();
    const finalSupplier: Supplier = {
      ...supplier,
      tenant_id: tenantId,
      created_at: supplier.created_at || new Date().toISOString(),
      updated_at: supplier.updated_at || new Date().toISOString(),
    };

    if (!client) {
      return db.createSupplier(finalSupplier);
    }

    await client.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version)
       VALUES ('suppliers', $1, $2, $3::timestamptz, $4::jsonb, 1)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, version = commerceos.documents.version + 1`,
      [finalSupplier.id, tenantId, finalSupplier.created_at, JSON.stringify(finalSupplier)]
    );

    if (db.isCollectionHydrated("suppliers")) {
      const idx = (db.data.suppliers || []).findIndex((s) => s.tenant_id === tenantId && s.id === finalSupplier.id);
      if (idx !== -1) (db.data.suppliers || [])[idx] = finalSupplier;
      else (db.data.suppliers || []).push(finalSupplier);
    }

    return finalSupplier;
  }

  // ==================== PURCHASE ORDERS ====================

  async findPurchaseOrderById(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const client = this.getClient();
    if (!client) {
      return db.findPurchaseOrderById(tenantId, id) || null;
    }

    const res = await client.query<{ data: PurchaseOrder | string }>(
      `SELECT data FROM commerceos.documents WHERE collection = 'purchase_orders' AND tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );

    if (res.rowCount === 0 || !res.rows[0]) return null;
    return parseJsonData<PurchaseOrder>(res.rows[0].data);
  }

  async listPurchaseOrdersWithCursor(
    tenantId: string,
    options?: PurchaseOrderPaginationOptions
  ): Promise<CursorPaginatedResult<PurchaseOrder>> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const client = this.getClient();

    if (!client) {
      let list = db.isCollectionHydrated("purchase_orders") ? (db.data.purchase_orders || []) : [];
      list = list.filter((po) => po.tenant_id === tenantId);
      if (options?.status) {
        list = list.filter((po) => po.status === options.status);
      }
      list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

      let startIndex = 0;
      if (options?.cursor) {
        const decoded = decodeCursor(options.cursor);
        if (decoded) {
          startIndex = list.findIndex(
            (po) =>
              po.created_at < decoded.c ||
              (po.created_at === decoded.c && po.id < decoded.i)
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

    const conditions: string[] = ["collection = 'purchase_orders'", "tenant_id = $1"];
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
        conditions.push(`(coalesce(created_at, (data->>'created_at')::timestamptz), id) < ($${paramIndex}::timestamptz, $${paramIndex + 1})`);
        params.push(decoded.c, decoded.i);
        paramIndex += 2;
      }
    }

    params.push(limit + 1);
    const sql = `
      SELECT id, coalesce(created_at, (data->>'created_at')::timestamptz)::text AS created_at, data
      FROM commerceos.documents
      WHERE ${conditions.join(" AND ")}
      ORDER BY coalesce(created_at, (data->>'created_at')::timestamptz) DESC, id DESC
      LIMIT $${paramIndex}
    `;

    const res = await client.query<{ id: string; created_at: string; data: PurchaseOrder | string }>(sql, params);
    const hasMore = res.rows.length > limit;
    const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
    const items = rows.map((r) => parseJsonData<PurchaseOrder>(r.data));

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

  async createPurchaseOrder(tenantId: string, po: PurchaseOrder): Promise<PurchaseOrder> {
    const client = this.getClient();
    const finalPO: PurchaseOrder = {
      ...po,
      tenant_id: tenantId,
      created_at: po.created_at || new Date().toISOString(),
      updated_at: po.updated_at || new Date().toISOString(),
    };

    if (!client) {
      return db.createPurchaseOrder(finalPO);
    }

    await client.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version)
       VALUES ('purchase_orders', $1, $2, $3::timestamptz, $4::jsonb, 1)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, version = commerceos.documents.version + 1`,
      [finalPO.id, tenantId, finalPO.created_at, JSON.stringify(finalPO)]
    );

    if (db.isCollectionHydrated("purchase_orders")) {
      const idx = (db.data.purchase_orders || []).findIndex((p) => p.tenant_id === tenantId && p.id === finalPO.id);
      if (idx !== -1) (db.data.purchase_orders || [])[idx] = finalPO;
      else (db.data.purchase_orders || []).push(finalPO);
    }

    return finalPO;
  }

  async updatePurchaseOrder(
    tenantId: string,
    id: string,
    updates: Partial<PurchaseOrder>,
    options?: { expectedVersion?: number }
  ): Promise<PurchaseOrder> {
    const client = this.getClient();

    if (!client) {
      const existing = db.findPurchaseOrderById(tenantId, id);
      if (!existing) {
        throw new Error(`Purchase order not found: ${id}`);
      }
      Object.assign(existing, updates);
      return existing;
    }

    const currRes = await client.query<{ data: PurchaseOrder | string; version: string }>(
      `SELECT data, version::text AS version
       FROM commerceos.documents
       WHERE collection = 'purchase_orders' AND tenant_id = $1 AND id = $2
       FOR UPDATE`,
      [tenantId, id]
    );

    if (currRes.rowCount === 0 || !currRes.rows[0]) {
      throw new Error(`Purchase order not found: ${id}`);
    }

    const currentVersion = Number(currRes.rows[0].version || "1");
    if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      throw new StoreConflictError([{ collection: "purchase_orders", id }]);
    }

    const currentData = parseJsonData<PurchaseOrder>(currRes.rows[0].data);
    const mergedData: PurchaseOrder = {
      ...currentData,
      ...updates,
      id,
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
    };

    const updateRes = await client.query<{ data: PurchaseOrder | string; version: string }>(
      `UPDATE commerceos.documents
       SET data = $1::jsonb,
           version = version + 1
       WHERE collection = 'purchase_orders' AND tenant_id = $2 AND id = $3 AND version = $4
       RETURNING data, version::text AS version`,
      [JSON.stringify(mergedData), tenantId, id, currentVersion]
    );

    if (updateRes.rowCount === 0 || !updateRes.rows[0]) {
      throw new StoreConflictError([{ collection: "purchase_orders", id }]);
    }

    if (db.isCollectionHydrated("purchase_orders")) {
      const idx = (db.data.purchase_orders || []).findIndex((p) => p.tenant_id === tenantId && p.id === id);
      if (idx !== -1) (db.data.purchase_orders || [])[idx] = mergedData;
    }

    return parseJsonData<PurchaseOrder>(updateRes.rows[0].data);
  }
}

export const supplierRepository = new SupplierRepository();
