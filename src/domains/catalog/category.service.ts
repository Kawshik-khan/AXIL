import { db } from "@/infrastructure/db";
import { Category, Brand } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

export class CategoryService {
  public static async listCategories(context: RequestContext): Promise<Category[]> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    return db.getCategories(context.tenant.id);
  }

  public static async createCategory(
    context: RequestContext,
    payload: { name: string; description?: string; parent_id?: string }
  ): Promise<Category> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_CREATE);
    if (!payload.name || payload.name.trim().length === 0) {
      throw new BadRequestError("Category name is required.");
    }

    const slug = payload.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-");

    const newCat: Category = {
      id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenant_id: context.tenant.id,
      name: payload.name.trim(),
      slug,
      description: payload.description,
      parent_id: payload.parent_id,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    };

    return db.createCategory(newCat);
  }
}

export { BrandService } from "./brand.service";
