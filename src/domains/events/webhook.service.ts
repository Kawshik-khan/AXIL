import { randomSuffix } from "@/lib/ids";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { WebhookSubscription, CommerceEvent } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

export class WebhookService {
  public static async listWebhooks(context: RequestContext): Promise<WebhookSubscription[]> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    return db.getWebhooks(context.tenant.id);
  }

  public static async registerWebhook(
    context: RequestContext,
    payload: { url: string; events: string[] }
  ): Promise<WebhookSubscription> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);

    if (!payload.url || !payload.url.startsWith("http")) {
      throw new BadRequestError("A valid HTTP/HTTPS webhook URL is required.");
    }

    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const sub: WebhookSubscription = {
      id: `wh_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      url: payload.url,
      secret,
      events: payload.events || ["*"],
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    };

    return db.createWebhook(sub);
  }

  public static signPayload(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  public static verifySignature(payload: string, secret: string, signature: string): boolean {
    const expected = this.signPayload(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}
