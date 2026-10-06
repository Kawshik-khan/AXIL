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
   * The provider proved this channel identity's phone number (FX-87: a Telegram own-contact share). The identity ends up
   * on a customer whose phone IS that number, and only then is marked TELEGRAM_VERIFIED_CONTACT (which the customer agent
   * treats like a WhatsApp number, VERIFIED_PHONE):
   * - exactly one customer has the number: the identity and its chats move to them;
   * - nobody has it: the identity's own customer takes the number if it was created for this profile and has no phone;
   *   otherwise (a different phone, or a customer the identity was linked to by a claimed phone or email) the identity
   *   and its chats move to a new customer with the number. A claim-linked customer is never kept;
   * - several customers have it: nothing is verified or moved (staff decide), and the audit says so.
   * Returns the customer the identity belongs to afterwards.
   */
  public static async linkVerifiedPhone(tenantId: string, identity: CustomerIdentity, rawPhone: string): Promise<Customer> {
    const phone = CustomerService.normalizePhoneNumber(rawPhone);
    const current = db.findCustomerById(tenantId, identity.customer_id);
    const owners = db.data.customers.filter((c) => c.tenant_id === tenantId && c.phone === phone && Boolean(phone));
    const claimLinked = ["PHONE_MATCH", "EMAIL_MATCH"].includes(String(identity.metadata?.resolution_strategy ?? ""));
    const audit = (outcome: string, to?: string) =>
      AuditService.log({
        tenantId,
        actorUserId: "system:identity",
        action: "CHANNEL_PHONE_VERIFIED",
        resourceType: "customer_identity",
        resourceId: identity.id,
        metadata: { channel_type: identity.channel_type, outcome, from_customer_id: identity.customer_id, to_customer_id: to ?? identity.customer_id },
      });

    if (owners.length > 1) {
      audit("AMBIGUOUS_NOT_LINKED");
      return current as Customer;
    }
    let target: Customer | undefined = owners[0];
    let outcome = "LINKED_TO_EXISTING_CUSTOMER";
    if (!target) {
      if (current && !current.phone && !claimLinked && identity.metadata?.resolution_strategy === "NEW_PROFILE_CREATED") {
        db.updateCustomer(tenantId, current.id, { phone });
        target = { ...current, phone };
        outcome = "PHONE_ADDED_TO_OWN_CUSTOMER";
      } else {
        const name = (identity.display_name || "Telegram customer").trim().split(/\s+/);
        target = await CustomerService.createCustomer(
          this.systemContext(tenantId),
          { first_name: name[0] || "Telegram", last_name: name.slice(1).join(" ") || "(TE)", phone, source: "SOCIAL", notes: `Verified phone from ${identity.channel_type} contact share` },
          { allowMissingPhone: false }
        );
        outcome = "MOVED_TO_NEW_CUSTOMER";
      }
    }
    if (target.id !== identity.customer_id) {
      // This chat's conversations follow the identity
      const chats = db.data.conversations.filter((c) => c.tenant_id === tenantId && c.channel_id === identity.channel_id && c.customer_id === identity.customer_id);
      for (const c of chats) db.updateConversation(tenantId, c.id, { customer_id: target.id });
    }
    db.updateCustomerIdentity(tenantId, identity.id, {
      customer_id: target.id,
      phone,
      metadata: { ...identity.metadata, resolution_strategy: "TELEGRAM_VERIFIED_CONTACT", phone_verified_at: new Date().toISOString() },
    });
    audit(outcome, target.id);
    return target;
  }

  private static systemContext(tenantId: string): RequestContext {
    return {
      requestId: `req_id_res_${Date.now()}_${randomSuffix()}`,
      traceId: `trc_id_res_${Date.now()}_${randomSuffix()}`,
      tenant: { id: tenantId, name: "Tenant Workspace", slug: "tenant", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
      user: { id: "usr_system_identity", email: "system@commerceos.io", name: "Identity Resolution Engine", status: "ACTIVE" },
      role: "OWNER",
      permissions: Object.values(PERMISSIONS),
      timestamp: new Date().toISOString(),
    };
  }

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
      const allCustomers = db.getAllCustomers(tenantId);
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

    // No phone: store none. This used to invent "+8801700" + 6 random digits, which could be a real person's
    // number (messaging a stranger) or match an existing customer and merge into their record (FX-30, N6).
    const newCustomer = await CustomerService.createCustomer(
      mockContext,
      {
        first_name: firstName,
        last_name: lastName,
        phone: profileData?.phone ?? "",
        email: profileData?.email,
        source: channelType === "WEBSITE_CHAT" ? "WEBSITE" : "SOCIAL",
        notes: `Ingressed from ${channelType} ID ${externalUserId}`,
      },
      { allowMissingPhone: true }
    );

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
