import { randomSuffix } from "@/lib/ids";
import { db, TenantRecord } from "@/infrastructure/db";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/errors";

export interface CreateTenantInput {
  name: string;
  slug?: string;
  currency?: string;
  timezone?: string;
  language?: string;
  settings?: Record<string, unknown>;
}

export class TenantService {
  public static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  public static async createTenant(input: CreateTenantInput): Promise<TenantRecord> {
    if (!input.name || input.name.trim().length < 2) {
      throw new ValidationError("Workspace name must be at least 2 characters.");
    }

    const slug = input.slug || this.generateSlug(input.name);
    const existing = db.findTenantBySlug(slug);
    if (existing) {
      throw new ConflictError(`Workspace with identifier '${slug}' already exists.`);
    }

    const tenantId = `ten_${randomSuffix()}`;
    const newTenant: TenantRecord = {
      id: tenantId,
      name: input.name.trim(),
      slug,
      currency: input.currency || "BDT",
      timezone: input.timezone || "Asia/Dhaka",
      language: input.language || "en",
      settings: input.settings || {
        delivery_charge_inside_dhaka: 60,
        delivery_charge_outside_dhaka: 120,
      },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createTenant(newTenant);
  }

  public static getTenantById(id: string): TenantRecord {
    const tenant = db.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError("Tenant", id);
    }
    return tenant;
  }

  public static updateTenantSettings(
    tenantId: string,
    updates: {
      name?: string;
      currency?: string;
      timezone?: string;
      language?: string;
      settings?: Record<string, unknown>;
    }
  ): TenantRecord {
    const tenant = this.getTenantById(tenantId);
    const mergedSettings = updates.settings ? { ...tenant.settings, ...updates.settings } : tenant.settings;

    const updated = db.updateTenant(tenantId, {
      ...(updates.name ? { name: updates.name.trim() } : {}),
      ...(updates.currency ? { currency: updates.currency } : {}),
      ...(updates.timezone ? { timezone: updates.timezone } : {}),
      ...(updates.language ? { language: updates.language } : {}),
      settings: mergedSettings,
    });

    if (!updated) {
      throw new NotFoundError("Tenant", tenantId);
    }
    return updated;
  }
}
