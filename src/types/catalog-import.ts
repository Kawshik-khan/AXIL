import { z } from "zod";
import { ProductStatus } from "./commerce";

/**
 * Individual row specification for product catalog import
 */
export interface BulkProductImportRow {
  title: string;
  sku: string;
  base_price: number;
  compare_at_price?: number;
  cost_price?: number;
  stock?: number;
  category?: string;
  brand?: string;
  description?: string;
  short_description?: string;
  images?: string[];
  attributes?: Record<string, string>;
  status?: ProductStatus;
  warehouse_code?: string;
}

/**
 * Configuration options for the bulk import job
 */
export interface BulkImportOptions {
  mode?: "upsert" | "create_only" | "update_only";
  dry_run?: boolean;
  warehouse_id?: string;
  auto_create_categories?: boolean;
  auto_generate_sku_if_missing?: boolean;
}

/**
 * Precise error descriptor for rejected rows
 */
export interface BulkImportRowError {
  row_index: number;
  sku?: string;
  field?: string;
  value?: any;
  reason: string;
  raw_data?: Record<string, any>;
}

/**
 * Authoritative batch execution result
 */
export interface BulkImportResult {
  batch_id: string;
  total_rows: number;
  imported_count: number;
  updated_count: number;
  failed_count: number;
  successful_skus: string[];
  created_categories: string[];
  errors: BulkImportRowError[];
  duration_ms: number;
  dry_run: boolean;
}

/**
 * Zod validation schema for single product import row
 */
export const BulkProductRowSchema = z.object({
  title: z
    .string({ required_error: "Product title/name is required" })
    .trim()
    .min(1, "Product title cannot be empty"),
  sku: z
    .string()
    .trim()
    .optional(),
  base_price: z
    .number({ required_error: "Base price is required" })
    .nonnegative("Price must be a non-negative number (>= 0)"),
  compare_at_price: z
    .number()
    .nonnegative("Compare-at price must be >= 0")
    .optional(),
  cost_price: z
    .number()
    .nonnegative("Cost price must be >= 0")
    .optional(),
  stock: z
    .number()
    .int("Stock must be an integer")
    .nonnegative("Stock cannot be negative")
    .optional()
    .default(0),
  category: z
    .string()
    .trim()
    .optional(),
  brand: z
    .string()
    .trim()
    .optional(),
  description: z
    .string()
    .optional()
    .default(""),
  short_description: z
    .string()
    .optional()
    .default(""),
  images: z
    .array(z.string())
    .optional()
    .default([]),
  attributes: z
    .record(z.string())
    .optional()
    .default({}),
  status: z
    .enum(["ACTIVE", "DRAFT", "ARCHIVED", "OUT_OF_STOCK", "DISCONTINUED"])
    .optional()
    .default("ACTIVE"),
  warehouse_code: z
    .string()
    .trim()
    .optional(),
});

/**
 * Payload schema for POST /api/v1/products/bulk
 */
export const BulkImportPayloadSchema = z.object({
  batch_id: z.string().optional(),
  options: z
    .object({
      mode: z.enum(["upsert", "create_only", "update_only"]).optional().default("upsert"),
      dry_run: z.boolean().optional().default(false),
      warehouse_id: z.string().optional(),
      auto_create_categories: z.boolean().optional().default(true),
      auto_generate_sku_if_missing: z.boolean().optional().default(true),
    })
    .optional()
    .default({}),
  products: z.array(z.record(z.any())).min(1, "Products array cannot be empty"),
});
