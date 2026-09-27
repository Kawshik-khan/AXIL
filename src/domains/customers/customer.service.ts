import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Customer, CustomerAddress, CustomerSource } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { parseOrThrow } from "@/lib/validation";
import { CustomerPatchSchema } from "./customer.schemas";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";

export class CustomerService {
  /**
   * Normalize Bangladeshi and international phone numbers to canonical E.164-style (+880...)
   * Prevents customer duplicates between 017xxxxxxxx and +88017xxxxxxxx
   */
  public static normalizePhoneNumber(rawPhone: string): string {
    const cleaned = rawPhone.replace(/[\s\-()]/g, "");
    if (cleaned.startsWith("+880")) {
      return cleaned;
    }
    if (cleaned.startsWith("880")) {
      return `+${cleaned}`;
    }
    if (cleaned.startsWith("0")) {
      return `+88${cleaned}`;
    }
    if (cleaned.length === 10 && cleaned.startsWith("1")) {
      return `+880${cleaned}`;
    }
    return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  }

  public static async listCustomers(
    context: RequestContext,
    options?: { search?: string; limit?: number; offset?: number }
  ): Promise<{ customers: Customer[]; total: number }> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_READ);
    return db.getCustomers(context.tenant.id, options);
  }

  public static async getCustomerById(
    context: RequestContext,
    customerId: string
  ): Promise<Customer> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_READ);
    const customer = db.findCustomerById(context.tenant.id, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer '${customerId}' not found.`);
    }
    return customer;
  }

  public static async getCustomerByPhone(
    context: RequestContext,
    rawPhone: string
  ): Promise<Customer | undefined> {
    const normalized = this.normalizePhoneNumber(rawPhone);
    return db.findCustomerByPhone(context.tenant.id, normalized);
  }

  public static async createCustomer(
    context: RequestContext,
    payload: {
      first_name: string;
      last_name: string;
      phone: string;
      email?: string;
      source?: CustomerSource;
      notes?: string;
      address?: {
        division: string;
        district: string;
        upazila?: string;
        area?: string;
        address_line_1: string;
        postal_code?: string;
      };
    }
  ): Promise<Customer> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_CREATE);

    if (!payload.first_name || payload.first_name.trim().length === 0) {
      throw new BadRequestError("Customer first name is required.");
    }
    if (!payload.phone || payload.phone.trim().length === 0) {
      throw new BadRequestError("Customer phone number is required.");
    }

    const normalizedPhone = this.normalizePhoneNumber(payload.phone);

    // Deduplication check: Return existing customer if phone matches
    const existing = db.findCustomerByPhone(context.tenant.id, normalizedPhone);
    if (existing) {
      return existing;
    }

    const customerId = `cust_${Date.now()}_${randomSuffix()}`;
    const now = new Date().toISOString();

    let initialAddress: CustomerAddress | undefined;
    if (payload.address) {
      initialAddress = {
        id: `addr_${Date.now()}_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        customer_id: customerId,
        type: "SHIPPING",
        is_default: true,
        country: "Bangladesh",
        division: payload.address.division,
        district: payload.address.district,
        upazila: payload.address.upazila,
        area: payload.address.area,
        address_line_1: payload.address.address_line_1,
        postal_code: payload.address.postal_code,
        phone: normalizedPhone,
        created_at: now,
      };
    }

    const newCust: Customer = {
      id: customerId,
      tenant_id: context.tenant.id,
      first_name: payload.first_name.trim(),
      last_name: payload.last_name.trim(),
      email: payload.email?.trim().toLowerCase(),
      phone: normalizedPhone,
      status: "ACTIVE",
      source: payload.source || "MANUAL",
      notes: payload.notes,
      total_orders: 0,
      total_spent: 0,
      created_at: now,
      updated_at: now,
    };

    const created = db.createCustomer(newCust, initialAddress);

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "CUSTOMER_CREATED",
      resource_type: "customer",
      resource_id: customerId,
      metadata: { phone: normalizedPhone, name: `${created.first_name} ${created.last_name}` },
      created_at: now,
    });

    return created;
  }

  public static async updateCustomer(
    context: RequestContext,
    customerId: string,
    body: unknown
  ): Promise<Customer> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_UPDATE);
    await this.getCustomerById(context, customerId);

    // Only whitelisted fields; totals, source and tenant are never client-writable (FX-12, audit H4).
    const patch = parseOrThrow(CustomerPatchSchema, body);
    const updates: Partial<Customer> = { ...patch, email: patch.email === null ? undefined : patch.email };
    if (!("email" in patch)) delete updates.email;

    if (updates.phone) {
      updates.phone = this.normalizePhoneNumber(updates.phone);
      const holder = db.findCustomerByPhone(context.tenant.id, updates.phone);
      if (holder && holder.id !== customerId) {
        throw new ConflictError("Another customer already uses this phone number.");
      }
    }

    const updated = db.updateCustomer(context.tenant.id, customerId, updates);
    if (!updated) {
      throw new NotFoundError(`Customer '${customerId}' not found.`);
    }

    return updated;
  }
}
