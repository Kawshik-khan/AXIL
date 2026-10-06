/**
 * CommerceOS Phase 4: Product & Inventory Tools
 * Grounded strictly in Commerce Core ProductService & InventoryService.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { ProductService } from "@/domains/catalog/product.service";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

// 1. Search Products Tool
const SearchProductsInputSchema = z.object({
  query: z.string().describe("Search term in English, Bangla, or Banglish"),
  category: z.string().optional().describe("Optional category name or slug"),
  min_price: z.number().positive().optional(),
  max_price: z.number().positive().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export class SearchProductsTool implements IAgentTool<z.infer<typeof SearchProductsInputSchema>> {
  public readonly name = "search_products";
  public readonly description = "Search active products from catalog by name, category, or keywords. Never fabricates items.";
  public readonly category = "PRODUCT";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = SearchProductsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term" },
          category: { type: "string", description: "Optional category filter" },
          min_price: { type: "number", description: "Minimum price in BDT" },
          max_price: { type: "number", description: "Maximum price in BDT" },
          limit: { type: "number", description: "Maximum results" },
        },
        required: ["query"],
      },
      timeout_ms: 5000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof SearchProductsInputSchema>) {
    const list = await ProductService.listProducts(context, {
      search: input.query,
      status: "ACTIVE",
      limit: input.limit,
    });

    return list.products.map((p) => {
      const variants = db.getProductVariants(context.tenant.id, p.id);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.base_price,
        compare_at_price: p.compare_at_price,
        currency: "BDT",
        description: p.short_description || p.description,
        variants: variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          title: v.title,
          price: v.price || p.base_price,
          attributes: v.attributes,
        })),
      };
    });
  }
}

// 2. Get Product Tool
const GetProductInputSchema = z.object({
  product_id: z.string().describe("Canonical product ID"),
});

export class GetProductTool implements IAgentTool<z.infer<typeof GetProductInputSchema>> {
  public readonly name = "get_product";
  public readonly description = "Retrieve authoritative product details, pricing, and variants for a specific product ID.";
  public readonly category = "PRODUCT";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetProductInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "Product ID" },
        },
        required: ["product_id"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetProductInputSchema>) {
    const product = await ProductService.getProductById(context, input.product_id);
    const variants = db.getProductVariants(context.tenant.id, product.id);

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      base_price: product.base_price,
      currency: "BDT",
      status: product.status,
      description: product.description,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        price: v.price || product.base_price,
        attributes: v.attributes,
      })),
    };
  }
}

// 3. Check Inventory Tool
const CheckInventoryInputSchema = z.object({
  product_query: z.string().optional().describe("Product name or SKU to inspect"),
  product_id: z.string().optional().describe("Canonical product ID if known"),
  variant_attributes: z.record(z.string()).optional().describe("Attributes like size, color (e.g. { size: 'XL' })"),
});

export class CheckInventoryTool implements IAgentTool<z.infer<typeof CheckInventoryInputSchema>> {
  public readonly name = "check_inventory";
  public readonly description = "Check live warehouse stock for a product or variant. Authoritative from Commerce Core.";
  public readonly category = "PRODUCT";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.INVENTORY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = CheckInventoryInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          product_query: { type: "string", description: "Product name or search keyword" },
          product_id: { type: "string", description: "Product ID" },
          variant_attributes: { type: "object", description: "Variant attributes map" },
        },
        required: [],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  /**
   * Stock comes only from inventory rows (FX-71, audit F05). A product with no inventory row is not "in stock", and a
   * size or colour the product doesn't come in is reported as such, never answered with the stock of every variant.
   */
  public async execute(context: RequestContext, input: z.infer<typeof CheckInventoryInputSchema>) {
    const inventoryLevels = await InventoryService.getInventoryLevels(context);

    let matched = inventoryLevels;
    let productName: string | undefined;
    if (input.product_id) {
      const product = db.findProductById(context.tenant.id, input.product_id);
      if (!product) {
        return { available: false, quantity: 0, status: "PRODUCT_NOT_FOUND", message: "No product with that id exists." };
      }
      productName = product.name;
      const variantIds = new Set(db.getProductVariants(context.tenant.id, product.id).map((v) => v.id));
      matched = matched.filter((i) => variantIds.has(i.product_variant_id));
    } else if (input.product_query) {
      const q = input.product_query.toLowerCase();
      matched = matched.filter(
        (i) => i.product_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
      );
    }

    if (matched.length === 0) {
      const product = productName ?? db.getProducts(context.tenant.id, { search: input.product_query, limit: 1 }).products[0]?.name;
      return {
        ...(product ? { product_name: product } : {}),
        available: false,
        quantity: 0,
        status: "OUT_OF_STOCK",
        message: product
          ? `${product} has no stock record, so it can't be confirmed as available.`
          : "No stock matching your criteria was found in inventory.",
      };
    }

    if (input.variant_attributes && Object.keys(input.variant_attributes).length > 0) {
      const requestedVals = Object.values(input.variant_attributes).map((v) => v.toLowerCase());
      const filteredByVariant = matched.filter((i) =>
        requestedVals.some((val) => i.variant_title.toLowerCase().includes(val))
      );
      if (filteredByVariant.length === 0) {
        return {
          product_name: matched[0].product_name,
          available: false,
          quantity: 0,
          status: "SIZE_NOT_OFFERED",
          offered: Array.from(new Set(matched.map((i) => i.variant_title))),
          message: "That size or option isn't offered for this product.",
        };
      }
      matched = filteredByVariant;
    }

    const stockStatus = (qty: number) => (qty > 5 ? "IN_STOCK" : qty > 0 ? "LOW_STOCK" : "OUT_OF_STOCK");
    const totalAvailable = matched.reduce((acc, item) => acc + Math.max(0, item.quantity_available), 0);
    const inStock = totalAvailable > 0;

    return {
      product_name: matched[0].product_name,
      variant_title: matched[0].variant_title,
      sku: matched[0].sku,
      available: inStock,
      quantity: totalAvailable,
      status: stockStatus(totalAvailable),
      // Per variant, so "size 42?" is answered for size 42 only; quantities above 10 aren't disclosed exactly
      variants: matched.map((i) => {
        const qty = Math.max(0, i.quantity_available);
        return { variant_title: i.variant_title, sku: i.sku, stock_status: stockStatus(qty), available_qty: Math.min(qty, 10) };
      }),
      message: inStock
        ? `Currently available in stock (quantity: ${totalAvailable}).`
        : "Currently out of stock.",
    };
  }
}
