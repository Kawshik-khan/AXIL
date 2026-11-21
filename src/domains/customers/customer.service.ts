import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Customer, CustomerAddress, CustomerSource } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { parseOrThrow } from "@/lib/validation";
import { CustomerPatchSchema } from "./customer.schemas";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";

import { sliceForCursor } from "@/lib/cursor-pagination";
import { customerRepository } from "./customer.repository";
import { loadCustomerRows, readTenantRows } from "@/infrastructure/db/tenant-rows";
import {
  customerSegment,
  type CustomerListItem,
  type CustomerSegment,
  type CustomerSort,
  type SegmentCounts,
} from "@/lib/customer-segments";
import type { ChannelType, CustomerIdentity } from "@/types/social";

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

  /**
   * One page of the tenant's customers, each with its segment (from its order counters) and the chat channels it has
   * written from. Segment filters and sorts apply to offset pages; a cursor page is always newest first.
   */
  public static async listCustomers(
    context: RequestContext,
    options?: { search?: string; limit?: number; offset?: number; cursor?: string; segment?: CustomerSegment; sort?: CustomerSort }
  ): Promise<{
    customers: CustomerListItem[];
    total: number;
    segment_counts?: SegmentCounts;
    next_cursor?: string | null;
    has_more?: boolean;
  }> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_READ);
    const tenantId = context.tenant.id;
    if (options?.cursor !== undefined) {
      if (options.segment || (options.sort && options.sort !== "newest")) {
        throw new BadRequestError("Segment and sort filters work with offset pages, not with a cursor.");
      }
      const res = await customerRepository.listWithCursor(tenantId, {
        search: options.search,
        limit: options.limit ?? 20,
        cursor: options.cursor,
      });
      return {
        customers: await this.asListItems(tenantId, res.items),
        total: res.total ?? res.items.length,
        next_cursor: res.pagination.next_cursor,
        has_more: res.pagination.has_more,
      };
    }
    // One page (SQL under zero-hydration); analytics use getAllCustomers
    const page = await customerRepository.listCustomers(tenantId, {
      search: options?.search,
      limit: options?.limit ?? 50,
      offset: options?.offset,
      segment: options?.segment,
      sort: options?.sort,
    });
    return { customers: await this.asListItems(tenantId, page.customers), total: page.total, segment_counts: page.segment_counts };
  }

  /** Adds each customer's segment and the channel types of its chat identities (only this page's customers are read). */
  private static async asListItems(tenantId: string, customers: Customer[]): Promise<CustomerListItem[]> {
    const identities = await readTenantRows<CustomerIdentity>("customer_identities", tenantId, {
      field: "customer_id",
      values: customers.map((c) => c.id),
    });
    const channelsByCustomer = new Map<string, Set<ChannelType>>();
    for (const identity of identities) {
      const set = channelsByCustomer.get(identity.customer_id) ?? new Set<ChannelType>();
      set.add(identity.channel_type);
      channelsByCustomer.set(identity.customer_id, set);
    }
    return customers.map((c) => ({
      ...c,
      segment: customerSegment(c),
      channels: [...(channelsByCustomer.get(c.id) ?? [])].sort(),
    }));
  }

  public static async getCustomerById(
    context: RequestContext,
    customerId: string
  ): Promise<Customer> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_READ);
    const customer = await customerRepository.findById(context.tenant.id, customerId);
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
    return (await customerRepository.findByPhone(context.tenant.id, normalized)) ?? undefined;
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
    },
    /** Social/chat contacts may have no phone; they're stored with "" instead of an invented number (FX-30, N6). */
    opts: { allowMissingPhone?: boolean } = {}
  ): Promise<Customer> {
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_CREATE);

    if (!payload.first_name || payload.first_name.trim().length === 0) {
      throw new BadRequestError("Customer first name is required.");
    }
    const hasPhone = Boolean(payload.phone && payload.phone.trim().length > 0);
    if (!hasPhone && !opts.allowMissingPhone) {
      throw new BadRequestError("Customer phone number is required.");
    }

    const normalizedPhone = hasPhone ? this.normalizePhoneNumber(payload.phone) : "";

    // Deduplication check: Return existing customer if phone matches (only for a real phone number)
    const existing = normalizedPhone
      ? await customerRepository.findByPhone(context.tenant.id, normalizedPhone)
      : undefined;
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
      const holder = await customerRepository.findByPhone(context.tenant.id, updates.phone);
      if (holder && holder.id !== customerId) {
        throw new ConflictError("Another customer already uses this phone number.");
      }
    }

    await loadCustomerRows(context.tenant.id, [customerId]); // zero-hydration: the row this request changes
    const updated = db.updateCustomer(context.tenant.id, customerId, updates);
    if (!updated) {
      throw new NotFoundError(`Customer '${customerId}' not found.`);
    }

    return updated;
  }
}
