import { db } from "@/infrastructure/db";
import { Product, ProductVariant, ProductStatus } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { parseOrThrow } from "@/lib/validation";
import { ProductPatchSchema } from "./product.schemas";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError, ConflictError } from "@/lib/errors";

export class ProductService {
  /**
   * Slug generator with collision resolution
   */
  public static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  public static async listProducts(
    context: RequestContext,
    options?: {
      category_id?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ products: Product[]; total: number }> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    return db.getProducts(context.tenant.id, options);
  }

  public static async getProductById(
    context: RequestContext,
    productId: string
  ): Promise<Product> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    const product = db.findProductById(context.tenant.id, productId);
    if (!product) {
      throw new NotFoundError(`Product '${productId}' not found in tenant workspace.`);
    }
    return product;
  }

  public static async createProduct(
    context: RequestContext,
    payload: {
      name: string;
      sku: string;
      base_price: number;
      description?: string;
      short_description?: string;
      category_id?: string;
      brand_id?: string;
      compare_at_price?: number;
      cost_price?: number;
      status?: ProductStatus;
      initial_stock?: number;
      images?: string[];
      variants?: Array<{
        title: string;
        sku: string;
        price: number;
        compare_at_price?: number;
        cost_price?: number;
        initial_stock?: number;
        attributes?: Record<string, string>;
      }>;
    }
  ): Promise<Product> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_CREATE);

    if (!payload.name || payload.name.trim().length === 0) {
      throw new BadRequestError("Product name is required.");
    }
    if (!payload.sku || payload.sku.trim().length === 0) {
      throw new BadRequestError("Product SKU is required.");
    }
    if (typeof payload.base_price !== "number" || payload.base_price < 0) {
      throw new BadRequestError("Valid base price in BDT is required.");
    }

    // Invariant: SKU must be tenant-scoped unique
    const existingSku = db.findProductBySku(context.tenant.id, payload.sku);
    if (existingSku) {
      throw new ConflictError(`SKU '${payload.sku}' already exists in this workspace.`);
    }

    // Generate unique slug
    let baseSlug = this.generateSlug(payload.name);
    let candidateSlug = baseSlug;
    let counter = 1;
    while (db.findProductBySlug(context.tenant.id, candidateSlug)) {
      counter++;
      candidateSlug = `${baseSlug}-${counter}`;
    }

    const productId = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    let variants: ProductVariant[] = [];
    if (payload.variants && payload.variants.length > 0) {
      variants = payload.variants.map((v, idx) => ({
        id: `var_${productId}_${idx + 1}`,
        tenant_id: context.tenant.id,
        product_id: productId,
        sku: v.sku.trim().toUpperCase(),
        title: v.title,
        price: v.price,
        compare_at_price: v.compare_at_price,
        cost_price: v.cost_price,
        initial_stock: v.initial_stock,
        attributes: v.attributes || {},
        status: payload.status || "ACTIVE",
        created_at: now,
        updated_at: now,
      }));
    }

    const newProduct: Product = {
      id: productId,
      tenant_id: context.tenant.id,
      name: payload.name.trim(),
      slug: candidateSlug,
      description: payload.description || "",
      short_description: payload.short_description || "",
      category_id: payload.category_id,
      brand_id: payload.brand_id,
      sku: payload.sku.trim().toUpperCase(),
      base_price: payload.base_price,
      compare_at_price: payload.compare_at_price,
      cost_price: payload.cost_price,
      currency: "BDT",
      status: payload.status || "ACTIVE",
      images: payload.images || [],
      primary_image: payload.images?.[0] || "",
      variants,
      created_at: now,
      updated_at: now,
    };

    const saved = db.createProduct(newProduct, payload.initial_stock || 0);

    // Audit log
    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PRODUCT_CREATED",
      resource_type: "product",
      resource_id: saved.id,
      metadata: { name: saved.name, sku: saved.sku, price: saved.base_price },
      created_at: now,
    });

    return saved;
  }

  public static async updateProduct(
    context: RequestContext,
    productId: string,
    body: unknown
  ): Promise<Product> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_UPDATE);
    const existing = await this.getProductById(context, productId);

    // Only whitelisted fields; unknown keys (tenant_id, id, variants, …) are a 400 (FX-12, audit H4).
    const patch = parseOrThrow(ProductPatchSchema, body);
    const updates: Partial<Product> = {
      ...patch,
      category_id: patch.category_id === null ? undefined : patch.category_id,
      brand_id: patch.brand_id === null ? undefined : patch.brand_id,
      compare_at_price: patch.compare_at_price === null ? undefined : patch.compare_at_price,
      cost_price: patch.cost_price === null ? undefined : patch.cost_price,
    };
    for (const key of Object.keys(updates) as Array<keyof Product>) {
      if (updates[key] === undefined && !(key in patch)) delete updates[key];
    }

    if (updates.sku && updates.sku.toUpperCase() !== existing.sku.toUpperCase()) {
      const collision = db.findProductBySku(context.tenant.id, updates.sku);
      if (collision && collision.id !== productId) {
        throw new ConflictError(`SKU '${updates.sku}' is already taken by another product.`);
      }
    }

    const updated = db.updateProduct(context.tenant.id, productId, updates);
    if (!updated) {
      throw new NotFoundError(`Product '${productId}' not found.`);
    }

    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PRODUCT_UPDATED",
      resource_type: "product",
      resource_id: productId,
      metadata: { updates },
      created_at: new Date().toISOString(),
    });

    return updated;
  }

  public static async archiveProduct(
    context: RequestContext,
    productId: string
  ): Promise<boolean> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_DELETE);
    await this.getProductById(context, productId);
    const success = db.archiveProduct(context.tenant.id, productId);

    db.createAuditLog({
      id: `aud_${Date.now()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PRODUCT_ARCHIVED",
      resource_type: "product",
      resource_id: productId,
      metadata: { reason: "User archive action" },
      created_at: new Date().toISOString(),
    });

    return success;
  }

  public static async bulkImportProducts(
    context: RequestContext,
    rows: Record<string, any>[],
    options?: import("@/types/catalog-import").BulkImportOptions
  ): Promise<import("@/types/catalog-import").BulkImportResult> {
    const { BulkImportService } = await import("./bulk-import.service");
    return BulkImportService.importProducts(context, rows, options);
  }
}
