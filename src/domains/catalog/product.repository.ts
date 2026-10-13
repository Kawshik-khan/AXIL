/**
 * CommerceOS — Product & Catalog Repository
 * Authoritative data access for products, variants, categories, and brands.
 *
 * Implements high-performance Keyset (Cursor) Pagination over Neon PostgreSQL (commerceos schema)
 * with seamless fallback to in-memory store for offline test execution.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { db } from '@/infrastructure/db';
import type { SqlClient } from '@/infrastructure/store/sql-client';
import { StoreConflictError } from '@/infrastructure/store/pg-store';
import { Product, ProductVariant } from '@/types/commerce';
import {
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  sliceForCursor,
  type CursorPaginatedResult,
} from '@/lib/cursor-pagination';

function parseJsonData<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super('products', 'id');
  }

  /** SQL only when products is left out of memory (zero-hydration); otherwise the in-memory store is the source of truth. */
  private getClient(): SqlClient | null {
    return db.isCollectionHydrated("products") ? null : db.getSqlClient();
  }

  /**
   * Count products for a tenant.
   * If includeArchived is false (default), excludes ARCHIVED status.
   * Uses SQL index-backed count (products_tenant_status_idx) when database backend is active.
   */
  async countByTenant(tenantId: string, includeArchived = false): Promise<number> {
    const client = this.getClient();
    if (client) {
      const sql = includeArchived
        ? `SELECT count(*)::text AS total FROM commerceos.products WHERE tenant_id = $1`
        : `SELECT count(*)::text AS total FROM commerceos.products WHERE tenant_id = $1 AND (status IS DISTINCT FROM 'ARCHIVED' OR status IS NULL)`;
      const res = await client.query<{ total: string }>(sql, [tenantId]);
      return Number(res.rows[0]?.total ?? 0);
    }
    const all = db.getAllProducts(tenantId);
    return includeArchived ? all.length : all.filter((p) => p.status !== 'ARCHIVED').length;
  }

  async countActiveProducts(tenantId: string): Promise<number> {
    return this.countByTenant(tenantId, false);
  }

  static async countByTenant(tenantId: string, includeArchived = false): Promise<number> {
    return productRepository.countByTenant(tenantId, includeArchived);
  }

  async findByIds(tenantId: string, ids: string[]): Promise<Product[]> {
    if (!ids.length) return [];
    const client = this.getClient();
    if (client) {
      const rowsRes = await client.query<{ id: string; data: Product | string }>(
        `SELECT id, data FROM commerceos.products WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, ids]
      );
      const productIds = rowsRes.rows.map((r) => r.id);
      const variantsMap = await this.findVariantsByProductIds(tenantId, productIds);
      return rowsRes.rows.map((r) => {
        const p = parseJsonData<Product>(r.data);
        return {
          ...p,
          variants: variantsMap.get(p.id) || p.variants || [],
        };
      });
    }
    return ids.map((id) => db.findProductById(tenantId, id)).filter(Boolean) as Product[];
  }

  async existsById(tenantId: string, id: string): Promise<boolean> {
    const client = this.getClient();
    if (client) {
      const res = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM commerceos.products WHERE tenant_id = $1 AND id = $2) AS exists`,
        [tenantId, id]
      );
      return Boolean(res.rows[0]?.exists);
    }
    return Boolean(db.findProductById(tenantId, id));
  }

  async findById(tenantId: string, id: string): Promise<Product | null> {
    const client = this.getClient();
    if (!client) {
      return db.findProductById(tenantId, id) || null;
    }

    const rowRes = await client.query<{ data: Product | string }>(
      `SELECT data FROM commerceos.products WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;

    const product = parseJsonData<Product>(row.data);
    const variants = await this.findVariantsByProductId(tenantId, id);

    return {
      ...product,
      variants,
    };
  }

  async findBySlug(tenantId: string, slug: string): Promise<Product | null> {
    const client = this.getClient();
    if (!client) {
      return db.findProductBySlug(tenantId, slug) || null;
    }

    const rowRes = await client.query<{ data: Product | string }>(
      `SELECT data FROM commerceos.products WHERE tenant_id = $1 AND (data->>'slug') = $2 LIMIT 1`,
      [tenantId, slug]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;

    const product = parseJsonData<Product>(row.data);
    const variants = await this.findVariantsByProductId(tenantId, product.id);

    return {
      ...product,
      variants,
    };
  }

  async findBySku(tenantId: string, sku: string): Promise<Product | null> {
    const client = this.getClient();
    if (!client) {
      return db.findProductBySku(tenantId, sku) || null;
    }

    const normalizedSku = sku.trim().toUpperCase();
    const rowRes = await client.query<{ data: Product | string }>(
      `SELECT data FROM commerceos.products WHERE tenant_id = $1 AND sku_key = $2 LIMIT 1`,
      [tenantId, normalizedSku]
    );
    const row = rowRes.rows[0];
    if (!row?.data) return null;
    return parseJsonData<Product>(row.data);
  }

  async findVariantsByProductId(tenantId: string, productId: string): Promise<ProductVariant[]> {
    const client = this.getClient();
    if (!client) {
      return db.getProductVariants(tenantId, productId);
    }
    const variantRows = await client.query<{ data: ProductVariant | string }>(
      `SELECT data FROM commerceos.product_variants WHERE tenant_id = $1 AND product_id = $2`,
      [tenantId, productId]
    );
    return variantRows.rows.map((v) => parseJsonData<ProductVariant>(v.data));
  }

  async findVariantsByProductIds(
    tenantId: string,
    productIds: string[]
  ): Promise<Map<string, ProductVariant[]>> {
    const map = new Map<string, ProductVariant[]>();
    if (productIds.length === 0) return map;

    const client = this.getClient();
    if (!client) {
      for (const pid of productIds) {
        map.set(pid, db.getProductVariants(tenantId, pid));
      }
      return map;
    }

    const variantRows = await client.query<{ product_id: string; data: ProductVariant | string }>(
      `SELECT product_id, data FROM commerceos.product_variants WHERE tenant_id = $1 AND product_id = ANY($2::text[])`,
      [tenantId, productIds]
    );
    for (const vr of variantRows.rows) {
      const list = map.get(vr.product_id) || [];
      list.push(parseJsonData<ProductVariant>(vr.data));
      map.set(vr.product_id, list);
    }
    return map;
  }

  /**
   * High-performance Keyset (Cursor) Pagination for Products.
   * Avoids scanning and discarding rows; queries index (created_at DESC, id DESC).
   */
  async listWithCursor(
    tenantId: string,
    options?: {
      category_id?: string;
      status?: string;
      search?: string;
      limit?: number;
      cursor?: string;
    }
  ): Promise<CursorPaginatedResult<Product>> {
    const limit = options?.limit ?? 20;
    const client = this.getClient();

    if (!client) {
      // Offline / In-memory Fallback
      let all = db.getAllProducts(tenantId);
      if (options?.category_id) {
        all = all.filter((p) => p.category_id === options.category_id);
      }
      if (options?.status && options.status !== 'ALL') {
        all = all.filter((p) => p.status === options.status);
      }
      if (options?.search) {
        const q = options.search.toLowerCase().trim();
        all = all.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.slug.toLowerCase().includes(q)
        );
      }
      all.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return sliceForCursor(all, limit, options?.cursor);
    }

    // Direct PostgreSQL Keyset Query
    const params: unknown[] = [tenantId];
    let whereSQL = `tenant_id = $1`;
    let nextIdx = 2;

    if (options?.category_id) {
      whereSQL += ` AND category_id = $${nextIdx++}`;
      params.push(options.category_id);
    }
    if (options?.status && options.status !== 'ALL') {
      whereSQL += ` AND status = $${nextIdx++}`;
      params.push(options.status);
    }
    if (options?.search) {
      whereSQL += ` AND (data->>'name' ILIKE $${nextIdx} OR sku_key ILIKE $${nextIdx} OR data->>'slug' ILIKE $${nextIdx})`;
      params.push(`%${options.search}%`);
      nextIdx++;
    }

    const decoded = decodeCursor(options?.cursor);
    const keyset = buildKeysetClause(decoded, nextIdx);
    whereSQL += keyset.sqlClause;
    params.push(...keyset.params);
    nextIdx = keyset.nextParamIndex;

    // Fetch limit + 1 to detect has_more without COUNT(*)
    const fetchLimit = limit + 1;
    const querySQL = `
      SELECT id, created_at, data
      FROM commerceos.products
      WHERE ${whereSQL}
      ORDER BY created_at DESC, id DESC
      LIMIT $${nextIdx}
    `;
    params.push(fetchLimit);

    const rowsRes = await client.query<{ id: string; created_at: string; data: Product | string }>(
      querySQL,
      params
    );
    const rows = rowsRes.rows;

    const hasMore = rows.length > limit;
    const pagedRows = hasMore ? rows.slice(0, limit) : rows;

    // Populate variants for current page batch
    const productIds = pagedRows.map((r) => r.id);
    const variantsMap = await this.findVariantsByProductIds(tenantId, productIds);

    const products: Product[] = pagedRows.map((r) => {
      const data = parseJsonData<Product>(r.data);
      return {
        ...data,
        variants: variantsMap.get(r.id) || data.variants || [],
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pagedRows.length > 0) {
      const last = pagedRows[pagedRows.length - 1];
      const lastCreatedAt = last.created_at || (parseJsonData<Product>(last.data) as any)?.created_at || new Date().toISOString();
      nextCursor = encodeCursor(lastCreatedAt, last.id);
    }

    return {
      items: products,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
    };
  }

  /**
   * Backward-compatible listProducts signature for existing services.
   */
  async listProducts(
    tenantId: string,
    options?: {
      category_id?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    }
  ): Promise<{
    products: Product[];
    total: number;
    next_cursor?: string | null;
    has_more?: boolean;
  }> {
    if (options?.cursor !== undefined) {
      const cursorRes = await this.listWithCursor(tenantId, options);
      return {
        products: cursorRes.items,
        total: cursorRes.total ?? cursorRes.items.length,
        next_cursor: cursorRes.pagination.next_cursor,
        has_more: cursorRes.pagination.has_more,
      };
    }

    // Default offset path
    const res = db.getProducts(tenantId, {
      category_id: options?.category_id,
      status: options?.status,
      search: options?.search,
      limit: options?.limit ?? 50,
      offset: options?.offset,
    });

    return {
      products: res.products,
      total: res.total,
    };
  }

  async createProduct(product: Product, initialStock = 0): Promise<Product> {
    return db.createProduct(product, initialStock);
  }

  async updateProduct(
    tenantId: string,
    id: string,
    updates: Partial<Product>
  ): Promise<Product | null> {
    return this.update(tenantId, id, updates);
  }

  async archiveProduct(tenantId: string, id: string): Promise<boolean> {
    return this.archive(tenantId, id);
  }

  /**
   * Semantic repository mutation for updating a product (Phase D - Write-Path Decoupling).
   * Executes parameterized atomic UPDATE with optional optimistic concurrency control via version.
   */
  async update(
    tenantId: string,
    id: string,
    updates: Partial<Product>,
    options?: { expectedVersion?: number; tx?: SqlClient }
  ): Promise<Product | null> {
    const executor = options?.tx || this.getClient();
    if (executor) {
      let sql = `UPDATE commerceos.products
                 SET data = data || $3::jsonb,
                     version = version + 1,
                     row_updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`;
      const params: unknown[] = [tenantId, id, JSON.stringify(updates)];
      if (options?.expectedVersion !== undefined) {
        sql += ` AND version = $4`;
        params.push(options.expectedVersion);
      }
      sql += ` RETURNING data, version::text AS version`;

      const res = await executor.query<{ data: Product | string; version: string }>(sql, params);
      if (res.rowCount === 0) {
        if (options?.expectedVersion !== undefined) {
          const check = await executor.query<{ version: string }>(
            `SELECT version::text AS version FROM commerceos.products WHERE tenant_id = $1 AND id = $2`,
            [tenantId, id]
          );
          if (check.rowCount && check.rows[0].version !== String(options.expectedVersion)) {
            throw new StoreConflictError([{ collection: "products", id }]);
          }
        }
        return null;
      }
      const updated = parseJsonData<Product>(res.rows[0].data);
      if (db.isCollectionHydrated("products")) {
        const idx = db.data.products.findIndex((p) => p.tenant_id === tenantId && p.id === id);
        if (idx !== -1) {
          db.data.products[idx] = { ...db.data.products[idx], ...updates, updated_at: new Date().toISOString() };
        }
      }
      return updated;
    }

    return db.updateProduct(tenantId, id, updates) || null;
  }

  /**
   * Semantic repository mutation for archiving a product.
   */
  async archive(tenantId: string, id: string, tx?: SqlClient): Promise<boolean> {
    const executor = tx || this.getClient();
    if (executor) {
      const res = await executor.query(
        `UPDATE commerceos.products
         SET data = jsonb_set(data, '{status}', '"ARCHIVED"'),
             version = version + 1,
             row_updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );
      if (res.rowCount === 0) return false;
      if (db.isCollectionHydrated("products")) {
        const idx = db.data.products.findIndex((p) => p.tenant_id === tenantId && p.id === id);
        if (idx !== -1) {
          db.data.products[idx].status = "ARCHIVED";
          db.data.products[idx].updated_at = new Date().toISOString();
        }
      }
      return true;
    }
    return db.archiveProduct(tenantId, id);
  }

  /**
   * Bounded cursor iteration over products for batch/catalog workloads (Phase D).
   */
  async *iterateByCursor(
    tenantId: string,
    options?: { batchSize?: number; status?: string }
  ): AsyncIterable<Product[]> {
    const limit = Math.min(Math.max(options?.batchSize ?? 100, 1), 1000);
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const page = await this.listWithCursor(tenantId, {
        limit,
        cursor: cursor ?? undefined,
        status: options?.status,
      });

      if (page.items.length > 0) {
        yield page.items;
      }

      cursor = page.pagination.next_cursor;
      hasMore = page.pagination.has_more && Boolean(cursor);
    }
  }
}

export const productRepository = new ProductRepository();
