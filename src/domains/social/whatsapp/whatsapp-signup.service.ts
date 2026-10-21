/**
 * WhatsApp Embedded Signup picker (ADR-119 P5), on top of the OAuth broker (provider slug "whatsapp").
 *
 * 1. pending numbers: the WhatsApp Business Accounts this sign-in reaches come from Meta's token inspection (granular
 *    scopes), and their numbers from `/{waba}/phone_numbers` — never from the browser. No token leaves the server.
 * 2. activate: the picked number must be one of those. The broker saves the connection (the one copy of the business
 *    token); the app is subscribed to the account's webhooks; the number is registered for the Cloud API when the
 *    merchant gives its two-step PIN; the number becomes a WA_NUMBER resource and its WHATSAPP channel points at it.
 *    A number held by another workspace is refused (audit H5). Nothing is reported done unless Meta answered.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { randomSuffix } from "@/lib/ids";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError } from "@/lib/errors";
import { assertWithinLimit } from "@/lib/safety-gate";
import { encryptCredential } from "@/lib/security";
import { ChannelService } from "../channels/channel.service";
import { metaGraph as graph, whatsappOAuthAdapter } from "@/domains/connectors/auth/meta.adapter";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { upsertConnectionResource } from "@/domains/connectors/resources";
import type { ConnectedChannel } from "@/types/social";

const WA = whatsappOAuthAdapter.slug;
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export type NumberState = "NOT_CONNECTED" | "CONNECTED_HERE" | "IN_ANOTHER_WORKSPACE";

export interface PickableNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  waba_id: string;
  quality_rating?: string;
  state: NumberState;
}

interface MetaNumber {
  id: string;
  display: string;
  name: string;
  wabaId: string;
  quality?: string;
}

/** The numbers of every WhatsApp Business Account Meta says this token was granted on. */
async function fetchNumbers(token: string): Promise<MetaNumber[]> {
  const inspection = await whatsappOAuthAdapter.inspect({ accessToken: token });
  const wabaIds = [
    ...new Set([...(inspection.targets?.whatsapp_business_management ?? []), ...(inspection.targets?.whatsapp_business_messaging ?? [])]),
  ].slice(0, 20);
  const numbers: MetaNumber[] = [];
  for (const wabaId of wabaIds) {
    const res = await graph("GET", `/${wabaId}/phone_numbers`, { fields: "id,display_phone_number,verified_name,quality_rating", limit: "50" }, token);
    for (const row of Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : []) {
      const id = str(row.id);
      if (!/^\d{1,32}$/.test(id)) continue;
      numbers.push({
        id,
        display: str(row.display_phone_number).slice(0, 40),
        name: str(row.verified_name).slice(0, 120) || "WhatsApp number",
        wabaId,
        quality: str(row.quality_rating).slice(0, 16) || undefined,
      });
    }
  }
  return numbers;
}

function numberState(tenantId: string, phoneNumberId: string): NumberState {
  const holders = db.findConnectedChannelsByProviderId("WHATSAPP", phoneNumberId);
  if (holders.some((c) => c.tenant_id !== tenantId)) return "IN_ANOTHER_WORKSPACE";
  if (db.findLiveConnectionResourcesByExternalId("WA_NUMBER", phoneNumberId).some((r) => r.tenant_id !== tenantId)) return "IN_ANOTHER_WORKSPACE";
  return holders.length ? "CONNECTED_HERE" : "NOT_CONNECTED";
}

/** CONNECTED_NEEDS_ATTENTION: saved, but webhooks or registration failed, so messages won't flow until it's fixed. */
export type NumberOutcome =
  | "CONNECTED"
  | "RECONNECTED"
  | "CONNECTED_NOT_REGISTERED"
  | "CONNECTED_NEEDS_ATTENTION"
  | "IN_ANOTHER_WORKSPACE"
  | "FAILED";

export interface NumberConnectResult {
  phone_number_id: string;
  display_phone_number: string;
  outcome: NumberOutcome;
  /** Meta confirmed the app is subscribed to the WhatsApp Business Account's webhooks. */
  webhooks_subscribed: boolean;
  /** true / false: Meta's answer to registering the number; null: not asked (no PIN given). */
  registered: boolean | null;
  error?: string;
}

export class WhatsAppSignupService {
  /** The numbers the merchant can connect from this sign-in. No tokens leave the server. */
  public static async listNumbers(context: RequestContext, pendingCookie: string | undefined): Promise<{ numbers: PickableNumber[] }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = OAuthBroker.readPending(context, WA, pendingCookie);
    const numbers = await fetchNumbers(pending.token.accessToken);
    return {
      numbers: numbers.map((n) => ({
        id: n.id,
        display_phone_number: n.display,
        verified_name: n.name,
        waba_id: n.wabaId,
        quality_rating: n.quality,
        state: numberState(context.tenant.id, n.id),
      })),
    };
  }

  /** Connects the picked number. Runs outside the store lock (the route uses `unit: false`). */
  public static async connectNumber(
    context: RequestContext,
    pendingCookie: string | undefined,
    input: { phone_number_id: string; pin?: string }
  ): Promise<NumberConnectResult> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const pending = OAuthBroker.readPending(context, WA, pendingCookie);
    const token = pending.token.accessToken;
    // The number must be one Meta lists for an account this token was granted on (never trusted from the client)
    const number = (await fetchNumbers(token)).find((n) => n.id === input.phone_number_id);
    if (!number) throw new BadRequestError("That number isn't available to this WhatsApp sign-in.");
    const result: NumberConnectResult = {
      phone_number_id: number.id,
      display_phone_number: number.display,
      outcome: "FAILED",
      webhooks_subscribed: false,
      registered: null,
    };
    if (numberState(context.tenant.id, number.id) === "IN_ANOTHER_WORKSPACE") {
      return { ...result, outcome: "IN_ANOTHER_WORKSPACE", error: "This number is connected to another CommerceOS workspace." };
    }
    // Local checks that can fail come before anything changes at Meta
    const isNew = !db.findConnectedChannelsByProviderId("WHATSAPP", number.id).some((c) => c.tenant_id === context.tenant.id);
    if (isNew) assertWithinLimit(context.tenant.id, "max_channels");

    const connection = await OAuthBroker.saveConnection(context, WA, pending);
    try {
      const sub = await graph("POST", `/${number.wabaId}/subscribed_apps`, {}, token);
      result.webhooks_subscribed = sub.success === true;
    } catch (err) {
      result.error = `Webhooks not subscribed: ${err instanceof Error ? err.message : "Meta refused."}`;
    }
    if (input.pin) {
      try {
        const reg = await graph("POST", `/${number.id}/register`, { messaging_product: "whatsapp", pin: input.pin }, token);
        result.registered = reg.success === true;
      } catch (err) {
        result.registered = false;
        result.error = `${result.error ? `${result.error} ` : ""}Number not registered: ${err instanceof Error ? err.message : "Meta refused."}`;
      }
    }

    const ready = result.webhooks_subscribed && result.registered !== false;
    await db
      .unit(async () => {
        const resource = upsertConnectionResource(context.tenant.id, connection.id, "WA_NUMBER", number.id, {
          name: number.display || number.name,
          metadata: { waba_id: number.wabaId, verified_name: number.name },
          status: ready ? "ACTIVE" : "NEEDS_ATTENTION",
          activated: ready,
        });
        result.outcome = await this.upsertChannel(context, number, resource.id, token, ready ? undefined : result.error ?? "WhatsApp setup isn't finished.");
        if (!ready) result.outcome = "CONNECTED_NEEDS_ATTENTION";
        else if (result.outcome === "CONNECTED" && result.registered === null) result.outcome = "CONNECTED_NOT_REGISTERED";
        db.createAuditLog({
          id: `aud_${Date.now()}_${randomSuffix()}`,
          tenant_id: context.tenant.id,
          actor_user_id: context.user.id,
          action: "social.channel.whatsapp_connected",
          resource_type: "connected_channel",
          resource_id: number.id,
          metadata: {
            phone_number_id: number.id,
            waba_id: number.wabaId,
            outcome: result.outcome,
            webhooks_subscribed: result.webhooks_subscribed,
            registered: result.registered === null ? "NOT_ASKED" : result.registered,
            connection_id: connection.id,
          },
          created_at: new Date().toISOString(),
        });
        return true;
      }, () => true)
      .catch((err: unknown) => {
        // The unit didn't commit: nothing was saved
        result.outcome = "FAILED";
        result.error = err instanceof AppError ? err.message : "Could not save the channel. Try again.";
        logger.warn("whatsapp_signup.save_failed", { tenant_id: context.tenant.id, error: err instanceof Error ? err.message : "error" });
      });
    // Nothing holds the number: the account's webhooks must not stay subscribed to the platform app
    if (result.outcome === "FAILED") await unsubscribeUnusedWabas([number.wabaId], token);
    return result;
  }

  /**
   * Creates or refreshes the number's WHATSAPP channel, pointing at its resource. The channel stores no token: it reads
   * the connection's through the resource (ADR-119 E4).
   */
  private static async upsertChannel(
    context: RequestContext,
    number: MetaNumber,
    resourceId: string,
    token: string,
    problem?: string
  ): Promise<NumberOutcome> {
    const credentials = {
      phoneNumberId: number.id,
      businessAccountId: number.wabaId,
      connectedVia: "whatsapp_signup",
      connectedBy: context.user.id,
    };
    const name = number.display ? `WhatsApp ${number.display}` : number.name;
    const existing = db.findConnectedChannelsByProviderId("WHATSAPP", number.id).find((c) => c.tenant_id === context.tenant.id);
    const now = new Date().toISOString();
    if (existing) {
      db.updateConnectedChannel(context.tenant.id, existing.id, {
        name,
        // Not receiving until webhooks and registration work: never shown as active meanwhile
        status: problem ? "PENDING_SETUP" : "ACTIVE",
        external_phone_number_id: number.id,
        external_business_id: number.wabaId,
        credentials_encrypted: encryptCredential(credentials),
        connector_id: undefined,
        resource_id: resourceId,
        error_message: problem,
        last_sync_at: now,
        updated_at: now,
      } as Partial<ConnectedChannel>);
      return "RECONNECTED";
    }
    // The adapter's credential check needs the token; it is not stored on the channel
    const created = await ChannelService.connectChannel(context, {
      type: "WHATSAPP",
      name,
      provider_account_id: number.id,
      external_phone_number_id: number.id,
      external_business_id: number.wabaId,
      credentials: { ...credentials, accessToken: token },
      configuration: { auto_reply_enabled: true },
    });
    db.updateConnectedChannel(context.tenant.id, created.id, {
      credentials_encrypted: encryptCredential(credentials),
      resource_id: resourceId,
      ...(problem ? { error_message: problem, status: "PENDING_SETUP" as const } : {}),
    });
    return "CONNECTED";
  }
}

/**
 * Unsubscribes the platform app from WhatsApp Business Accounts no live number resource uses any more (best effort), so
 * their numbers' webhooks stop reaching CommerceOS. `ignoreConnectionId`: a connection being disconnected.
 */
export async function unsubscribeUnusedWabas(wabaIds: string[], token: string, ignoreConnectionId?: string): Promise<string[]> {
  const done: string[] = [];
  if (!token) return done;
  const live = (db.data.connection_resources || []).filter(
    (r) => r.kind === "WA_NUMBER" && r.status !== "DETACHED" && r.connection_id !== ignoreConnectionId
  );
  for (const wabaId of [...new Set(wabaIds)]) {
    if (!/^\d{1,32}$/.test(wabaId) || live.some((r) => r.metadata.waba_id === wabaId)) continue;
    try {
      const res = await graph("DELETE", `/${wabaId}/subscribed_apps`, {}, token);
      if (res.success === true) done.push(wabaId);
    } catch (err) {
      logger.warn("whatsapp_signup.unsubscribe_failed", { waba_id: wabaId, error: err instanceof Error ? err.message : "error" });
    }
  }
  return done;
}

/** The WhatsApp Business Accounts a connection's numbers belong to. */
export function wabasOfConnection(tenantId: string, connectionId: string): string[] {
  return db
    .getConnectionResources(tenantId, connectionId)
    .filter((r) => r.kind === "WA_NUMBER")
    .map((r) => String(r.metadata.waba_id ?? ""))
    .filter(Boolean);
}
