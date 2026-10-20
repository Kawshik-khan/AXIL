/**
 * What each provider's picker lists and activates after sign-in (ADR-119 P1). Until the generic resource model (P2),
 * each provider plugs in its own service here; the routes under /api/v1/connections/{provider}/ stay generic.
 */
import { z } from "zod";
import { RequestContext } from "@/lib/context";
import { MetaLoginService } from "@/domains/social/meta/meta-login.service";
import { WhatsAppSignupService } from "@/domains/social/whatsapp/whatsapp-signup.service";
import { NotFoundError } from "@/lib/errors";
import { getOAuthAdapter } from "./oauth-broker";

export interface ResourcePicker {
  /** Strict body of the activate POST. */
  activateBody: z.ZodTypeAny;
  list(context: RequestContext, pendingCookie: string | undefined): Promise<unknown>;
  activate(context: RequestContext, pendingCookie: string | undefined, input: unknown): Promise<unknown>;
}

const MetaActivateBody = z
  .object({
    page_ids: z.array(z.string().regex(/^\d{1,32}$/)).max(25).default([]),
    include_instagram: z.boolean().default(true),
    ad_account_id: z.string().regex(/^(act_)?\d{5,25}$/).optional(),
  })
  .strict()
  .refine((b) => b.page_ids.length > 0 || b.ad_account_id !== undefined, { message: "Pick a Page or an ad account." });

const WhatsAppActivateBody = z
  .object({
    phone_number_id: z.string().regex(/^\d{1,32}$/),
    // The number's two-step verification PIN, used once to register it for the Cloud API; never stored
    pin: z.string().regex(/^\d{6}$/).optional(),
  })
  .strict();

const PICKERS: Record<string, ResourcePicker> = {
  whatsapp: {
    activateBody: WhatsAppActivateBody,
    list: (context, cookie) => WhatsAppSignupService.listNumbers(context, cookie),
    activate: async (context, cookie, input) => ({
      results: [await WhatsAppSignupService.connectNumber(context, cookie, input as z.infer<typeof WhatsAppActivateBody>)],
    }),
  },
  meta: {
    activateBody: MetaActivateBody,
    list: (context, cookie) => MetaLoginService.listPages(context, cookie),
    activate: async (context, cookie, input) => ({
      results: await MetaLoginService.connectPages(context, cookie, input as z.infer<typeof MetaActivateBody>),
    }),
  },
};

export function getResourcePicker(slug: string): ResourcePicker {
  getOAuthAdapter(slug); // 404 for an unknown provider
  const picker = Object.prototype.hasOwnProperty.call(PICKERS, slug) ? PICKERS[slug] : undefined;
  if (!picker) throw new NotFoundError("Resource picker");
  return picker;
}
