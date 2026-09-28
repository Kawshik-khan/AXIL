/**
 * CommerceOS Phase 7: Consent, Preference & Frequency Capping Service
 * Strictly enforces opt-in/opt-out status, suppression lists, and multi-channel frequency caps.
 */

import { db } from "@/infrastructure/db";
import {
  CustomerCommunicationPreference,
  SuppressionEntry,
  MarketingChannelType,
  FrequencyCapPolicy,
} from "@/types/growth";

export class ConsentService {
  /**
   * Records or updates communication preferences for a customer
   */
  public setPreference(params: {
    tenantId: string;
    customerId: string;
    channel: MarketingChannelType;
    purpose: "MARKETING" | "TRANSACTIONAL" | "SERVICE";
    status: "OPTED_IN" | "OPTED_OUT";
    consentSource?: string;
  }): CustomerCommunicationPreference {
    const { tenantId, customerId, channel, purpose, status, consentSource } = params;

    const existing = db
      .getCommunicationPreferences(tenantId, customerId)
      .find((p) => p.channel === channel && p.purpose === purpose);

    const now = new Date().toISOString();
    const pref: CustomerCommunicationPreference = {
      id: existing?.id || `pref_${Date.now()}_${customerId}`,
      tenant_id: tenantId,
      customer_id: customerId,
      channel,
      purpose,
      status,
      consent_source: consentSource || "USER_INTERFACE",
      opted_in_at: status === "OPTED_IN" ? now : existing?.opted_in_at,
      opted_out_at: status === "OPTED_OUT" ? now : existing?.opted_out_at,
      updated_at: now,
    };

    db.upsertCommunicationPreference(pref);

    // If opted out of marketing, add to suppression list
    if (status === "OPTED_OUT" && purpose === "MARKETING") {
      db.insertSuppressionEntry({
        id: `sup_${Date.now()}_${customerId}`,
        tenant_id: tenantId,
        customer_id: customerId,
        channel,
        reason: "CUSTOMER_OPT_OUT",
        created_at: now,
      });
    }

    return pref;
  }

  /**
   * Checks whether a customer has given consent for marketing on a specific channel
   */
  public hasConsent(tenantId: string, customerId: string, channel: MarketingChannelType): boolean {
    // Check suppression list first
    const suppressions = db.getSuppressionEntries(tenantId, customerId);
    const isSuppressed = suppressions.some(
      (s) => (!s.channel || s.channel === channel) && (!s.suppressed_until || new Date() < new Date(s.suppressed_until))
    );
    if (isSuppressed) return false;

    // Check customer preference
    const preferences = db.getCommunicationPreferences(tenantId, customerId);
    const pref = preferences.find((p) => p.channel === channel && p.purpose === "MARKETING");

    // If explicitly opted out, reject
    if (pref && pref.status === "OPTED_OUT") return false;

    // By default in Bangladeshi social commerce, customer initiated conversations / orders imply consent unless opted out
    return true;
  }

  /**
   * Suppresses a customer manually or automatically (e.g. bounce or complaint)
   */
  public suppressCustomer(
    tenantId: string,
    customerId: string,
    reason: SuppressionEntry["reason"],
    channel?: MarketingChannelType,
    suppressedUntil?: string
  ): SuppressionEntry {
    const entry: SuppressionEntry = {
      id: `sup_${Date.now()}_${customerId}`,
      tenant_id: tenantId,
      customer_id: customerId,
      channel,
      reason,
      suppressed_until: suppressedUntil,
      created_at: new Date().toISOString(),
    };
    db.insertSuppressionEntry(entry);
    return entry;
  }
}

export const consentService = new ConsentService();

export class FrequencyCappingService {
  private defaultPolicy: FrequencyCapPolicy = {
    max_messages_per_day: 3,
    max_messages_per_week: 10,
    cooldown_period_hours: 4,
  };

  /**
   * Evaluates if a customer has exceeded marketing frequency caps
   */
  public checkFrequencyCap(
    tenantId: string,
    customerId: string,
    channel: MarketingChannelType,
    customPolicy?: Partial<FrequencyCapPolicy>
  ): { capped: boolean; reason?: string } {
    const policy = { ...this.defaultPolicy, ...customPolicy };

    // Find all outbound messages sent to this customer across conversation messages
    const now = Date.now();
    const oneDayAgo = now - 24 * 3600 * 1000;
    const oneWeekAgo = now - 7 * 24 * 3600 * 1000;

    // Check messages in conversation database
    // Every message of the customer, not the first page of conversations/messages (FX-22)
    const allMessages = db.getCustomerMessages(tenantId, customerId);

    const marketingMessages = allMessages.filter(
      (m) => m.sender_type === "AGENT" || m.sender_type === "BOT" || (m.metadata as any)?.is_marketing === true
    );

    let msgsLast24h = 0;
    let msgsLast7d = 0;
    let lastMsgTime = 0;

    for (const msg of marketingMessages) {
      const t = new Date(msg.created_at).getTime();
      if (t >= oneDayAgo) msgsLast24h++;
      if (t >= oneWeekAgo) msgsLast7d++;
      if (t > lastMsgTime) lastMsgTime = t;
    }

    if (msgsLast24h >= policy.max_messages_per_day) {
      return {
        capped: true,
        reason: `Daily frequency cap exceeded: ${msgsLast24h}/${policy.max_messages_per_day} messages sent in last 24 hours.`,
      };
    }

    if (msgsLast7d >= policy.max_messages_per_week) {
      return {
        capped: true,
        reason: `Weekly frequency cap exceeded: ${msgsLast7d}/${policy.max_messages_per_week} messages sent in last 7 days.`,
      };
    }

    const hoursSinceLast = (now - lastMsgTime) / 3600000;
    if (lastMsgTime > 0 && hoursSinceLast < policy.cooldown_period_hours) {
      return {
        capped: true,
        reason: `Cooldown period active: last message sent ${hoursSinceLast.toFixed(1)}h ago (minimum ${policy.cooldown_period_hours}h).`,
      };
    }

    return { capped: false };
  }

  /**
   * Combined pre-send eligibility check combining consent and frequency capping
   */
  public checkSendEligibility(
    tenantId: string,
    customerId: string,
    channel: MarketingChannelType
  ): { eligible: boolean; reason?: string } {
    if (!consentService.hasConsent(tenantId, customerId, channel)) {
      return { eligible: false, reason: "Customer is opted out or suppressed." };
    }

    const freq = this.checkFrequencyCap(tenantId, customerId, channel);
    if (freq.capped) {
      return { eligible: false, reason: freq.reason };
    }

    return { eligible: true };
  }
}

export const frequencyCappingService = new FrequencyCappingService();
