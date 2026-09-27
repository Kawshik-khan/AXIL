import { db } from "@/infrastructure/db";
import { Brand } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

export class BrandService {
  public static async listBrands(context: RequestContext): Promise<Brand[]> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    return db.getBrands(context.tenant.id);
  }

  public static async createBrand(
    context: RequestContext,
    payload: { name: string; description?: string; logo?: string }
  ): Promise<Brand> {
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_CREATE);
    if (!payload.name || payload.name.trim().length === 0) {
      throw new BadRequestError("Brand name is required.");
    }

    const slug = payload.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-");

    const newBrand: Brand = {
      id: `brd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenant_id: context.tenant.id,
      name: payload.name.trim(),
      slug,
      description: payload.description,
      logo: payload.logo,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    };

    return db.createBrand(newBrand);
  }
}
