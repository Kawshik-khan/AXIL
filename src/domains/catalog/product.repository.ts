/**
 * CommerceOS — Product & Catalog Repository
 * Authoritative data access for products, variants, categories, and brands via Neon PostgreSQL.
 * Seamless fallback to in-memory db if DATABASE_URL is not set.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute, withTransaction } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Product, ProductVariant, Category, Brand, ProductStatus } from '@/types/commerce';

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super('products', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(tenantId: string, id: string): Promise<Product | null> {
    if (!this.isNeonConfigured()) {
      return db.findProductById(tenantId, id) || null;
    }
    const product = await queryOne<Product>(
      `SELECT * FROM products WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
    if (!product) return null;

    const variants = await query<ProductVariant>(
      `SELECT * FROM product_variants WHERE tenant_id = $1 AND product_id = $2`,
      [tenantId, id]
    );
    return {
      ...product,
      name: (product as any).title || product.name,
      variants,
    };
  }

  async findBySlug(tenantId: string, slug: string): Promise<Product | null> {
    if (!this.isNeonConfigured()) {
      return db.findProductBySlug(tenantId, slug) || null;
    }
    const product = await queryOne<Product>(
      `SELECT * FROM products WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
      [tenantId, slug]
    );
    if (!product) return null;

    const variants = await query<ProductVariant>(
      `SELECT * FROM product_variants WHERE tenant_id = $1 AND product_id = $2`,
      [tenantId, product.id]
    );
    return { ...product, variants };
  }

  async findBySku(tenantId: string, sku: string): Promise<Product | null> {
    if (!this.isNeonConfigured()) {
      return db.findProductBySku(tenantId, sku) || null;
    }
    const normalizedSku = sku.trim().toUpperCase();
    return queryOne<Product>(
      `SELECT * FROM products WHERE tenant_id = $1 AND UPPER(sku) = $2 LIMIT 1`,
      [tenantId, normalizedSku]
    );
  }

  async listProducts(
    tenantId: string,
    options?: {
      category_id?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ products: Product[]; total: number }> {
    if (!this.isNeonConfigured()) {
      return db.getProducts(tenantId, options);
    }

    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIdx = 2;

    if (options?.category_id) {
      whereSQL += ` AND category = $${paramIdx++}`;
      params.push(options.category_id);
    }
    if (options?.status) {
      whereSQL += ` AND status = $${paramIdx++}`;
      params.push(options.status);
    }
    if (options?.search) {
      whereSQL += ` AND (title ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`;
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM products WHERE ${whereSQL}`,
      params
    );
    const total = parseInt(countRes[0]?.count || '0', 10);

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const products = await query<Product>(
      `SELECT * FROM products WHERE ${whereSQL} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    // Populate variants
    const productIds = products.map((p) => p.id);
    let allVariants: ProductVariant[] = [];
    if (productIds.length > 0) {
      const placeholders = productIds.map((_, i) => `$${i + 2}`).join(', ');
      allVariants = await query<ProductVariant>(
        `SELECT * FROM product_variants WHERE tenant_id = $1 AND product_id IN (${placeholders})`,
        [tenantId, ...productIds]
      );
    }

    const populated = products.map((p) => ({
      ...p,
      variants: allVariants.filter((v) => v.product_id === p.id),
    }));

    return { products: populated, total };
  }

  async createProduct(product: Product, initialStock = 0): Promise<Product> {
    if (!this.isNeonConfigured()) {
      return db.createProduct(product, initialStock);
    }

    const created = await queryOne<Product>(
      `INSERT INTO products (
        id, tenant_id, title, slug, description, category, brand_id,
        base_price, compare_at_price, cost_price, currency, status,
        tags, media, seo, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        product.id,
        product.tenant_id,
        product.name,
        product.slug,
        product.description || null,
        product.category_id || null,
        product.brand_id || null,
        product.base_price,
        product.compare_at_price || null,
        product.cost_price || null,
        product.currency || 'BDT',
        product.status || 'ACTIVE',
        JSON.stringify([]),
        JSON.stringify(product.images || []),
        JSON.stringify({}),
        JSON.stringify({}),
        product.created_at || new Date().toISOString(),
        product.updated_at || new Date().toISOString(),
      ]
    );

    const result: Product = {
      ...product,
      ...(created || {}),
      name: (created as any)?.title || product.name,
    };

    // Keep fallback in sync
    db.createProduct(result, initialStock);
    return result;
  }

  async updateProduct(tenantId: string, id: string, updates: Partial<Product>): Promise<Product | null> {
    if (!this.isNeonConfigured()) {
      return db.updateProduct(tenantId, id, updates) || null;
    }
    const sets: string[] = [];
    const vals: unknown[] = [tenantId, id];
    let idx = 3;

    if (updates.name !== undefined) {
      sets.push(`title = $${idx++}`);
      vals.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push(`description = $${idx++}`);
      vals.push(updates.description);
    }
    if (updates.base_price !== undefined) {
      sets.push(`base_price = $${idx++}`);
      vals.push(updates.base_price);
    }
    if (updates.status !== undefined) {
      sets.push(`status = $${idx++}`);
      vals.push(updates.status);
    }
    sets.push(`updated_at = $${idx++}`);
    vals.push(new Date().toISOString());

    const updated = await queryOne<Product>(
      `UPDATE products SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    db.updateProduct(tenantId, id, updates);
    return updated;
  }

  async archiveProduct(tenantId: string, id: string): Promise<boolean> {
    if (!this.isNeonConfigured()) {
      return db.archiveProduct(tenantId, id);
    }
    const res = await execute(
      `UPDATE products SET status = 'ARCHIVED', updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    db.archiveProduct(tenantId, id);
    return res.rowCount > 0;
  }
}

export const productRepository = new ProductRepository();
