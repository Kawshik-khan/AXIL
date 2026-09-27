import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { CustomerIdentity, ChannelType } from "@/types/social";
import { Customer } from "@/types/commerce";
import { CustomerService } from "@/domains/customers/customer.service";
import { RequestContext } from "@/lib/context";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

export class IdentityResolutionService {
  /**
   * Authoritatively resolve an incoming channel sender to a canonical CommerceOS Customer record
   */
  public static async resolveCustomer(
    tenantId: string,
    channelId: string,
    channelType: ChannelType,
    externalUserId: string,
    profileData?: {
      displayName?: string;
      username?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<{ customer: Customer; identity: CustomerIdentity; isNewCustomer: boolean }> {
    // 1. Priority 1: Check existing verified channel identity for this tenant
    const existingIdentity = db.findCustomerIdentity(tenantId, channelId, externalUserId);
    if (existingIdentity) {
      const customer = db.findCustomerById(tenantId, existingIdentity.customer_id);
      if (customer) {
        // Update last seen
        db.updateCustomerIdentity(tenantId, existingIdentity.id, {
          display_name: profileData?.displayName || existingIdentity.display_name,
          external_username: profileData?.username || existingIdentity.external_username,
        });
        return { customer, identity: existingIdentity, isNewCustomer: false };
      }
    }

    // Context mock for internal service calls
    const mockContext: RequestContext = {
      requestId: `req_id_res_${Date.now()}_${randomSuffix()}`,
      traceId: `trc_id_res_${Date.now()}_${randomSuffix()}`,
      tenant: {
        id: tenantId,
        name: "Tenant Workspace",
        slug: "tenant",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        language: "en",
        status: "ACTIVE",
      },
      user: {
        id: "usr_system_identity",
        email: "system@commerceos.io",
        name: "Identity Resolution Engine",
        status: "ACTIVE",
      },
      role: "OWNER",
      permissions: Object.values(PERMISSIONS),
      timestamp: new Date().toISOString(),
    };

    // 2. Priority 2: Match verified phone number
    if (profileData?.phone) {
      const normalizedPhone = CustomerService.normalizePhoneNumber(profileData.phone);
      const matchedByPhone = await CustomerService.getCustomerByPhone(mockContext, normalizedPhone);
      if (matchedByPhone) {
        const newIdentity: CustomerIdentity = {
          id: `cid_${Date.now()}_${randomSuffix()}`,
          tenant_id: tenantId,
          customer_id: matchedByPhone.id,
          channel_id: channelId,
          channel_type: channelType,
          external_user_id: externalUserId,
          external_username: profileData.username,
          display_name: profileData.displayName,
          phone: normalizedPhone,
          email: profileData.email,
          metadata: { resolution_strategy: "PHONE_MATCH" },
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        };
        db.createCustomerIdentity(newIdentity);
        return { customer: matchedByPhone, identity: newIdentity, isNewCustomer: false };
      }
    }

    // 3. Priority 3: Match verified email
    if (profileData?.email) {
      const allCustomers = db.getCustomers(tenantId, { limit: 1000 }).customers;
      const matchedByEmail = allCustomers.find(
        (c) => c.email && c.email.toLowerCase() === profileData.email!.toLowerCase()
      );
      if (matchedByEmail) {
        const newIdentity: CustomerIdentity = {
          id: `cid_${Date.now()}_${randomSuffix()}`,
          tenant_id: tenantId,
          customer_id: matchedByEmail.id,
          channel_id: channelId,
          channel_type: channelType,
          external_user_id: externalUserId,
          external_username: profileData.username,
          display_name: profileData.displayName,
          phone: profileData.phone ? CustomerService.normalizePhoneNumber(profileData.phone) : matchedByEmail.phone,
          email: profileData.email,
          metadata: { resolution_strategy: "EMAIL_MATCH" },
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        };
        db.createCustomerIdentity(newIdentity);
        return { customer: matchedByEmail, identity: newIdentity, isNewCustomer: false };
      }
    }

    // 4. Safe fallback: Create a new customer record and associate new identity
    const nameParts = (profileData?.displayName || "Social Customer").trim().split(" ");
    const firstName = nameParts[0] || "Social";
    const lastName = nameParts.slice(1).join(" ") || `(${channelType.slice(0, 2)})`;

    const newCustomer = await CustomerService.createCustomer(mockContext, {
      first_name: firstName,
      last_name: lastName,
      phone: profileData?.phone || `+8801700${Math.floor(100000 + Math.random() * 900000)}`,
      email: profileData?.email,
      source: channelType === "WEBSITE_CHAT" ? "WEBSITE" : "SOCIAL",
      notes: `Ingressed from ${channelType} ID ${externalUserId}`,
    });

    const newIdentity: CustomerIdentity = {
      id: `cid_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      customer_id: newCustomer.id,
      channel_id: channelId,
      channel_type: channelType,
      external_user_id: externalUserId,
      external_username: profileData?.username,
      display_name: profileData?.displayName || `${firstName} ${lastName}`,
      phone: newCustomer.phone,
      email: newCustomer.email,
      metadata: { resolution_strategy: "NEW_PROFILE_CREATED" },
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    db.createCustomerIdentity(newIdentity);

    return { customer: newCustomer, identity: newIdentity, isNewCustomer: true };
  }

  public static async linkIdentity(
    context: RequestContext,
    customerId: string,
    identityId: string
  ): Promise<CustomerIdentity> {
    const customer = db.findCustomerById(context.tenant.id, customerId);
    if (!customer) throw new BadRequestError("Customer not found.");

    const identities = db.getCustomerIdentities(context.tenant.id);
    const target = identities.find((i) => i.id === identityId);
    if (!target) throw new BadRequestError("Identity record not found.");

    const updated = db.updateCustomerIdentity(context.tenant.id, identityId, {
      customer_id: customerId,
    });

    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "IDENTITY_LINKED",
      resourceType: "customer_identity",
      resourceId: identityId,
      metadata: { customer_id: customerId, channel_type: target.channel_type },
    });

    return updated;
  }
}
