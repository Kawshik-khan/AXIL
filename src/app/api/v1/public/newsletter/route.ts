import { z } from "zod";
import { NewsletterService } from "@/domains/marketing/newsletter.service";
import { apiSuccess, apiError } from "@/lib/api-response";
import { enforceRateLimit, clientKey, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { AppError } from "@/lib/errors";

// Strict (ADR-104): any other key is rejected. Consent must be explicitly true; nothing is stored without it.
const NewsletterBody = z
  .object({
    email: z
      .string({ error: "Valid email address is required." })
      .trim()
      .max(254, "Valid email address is required.")
      .email("Valid email address is required."),
    consent: z.literal(true, { error: "Consent is required to subscribe." }),
  })
  .strict();

/**
 * Public landing-page newsletter sign-up. Stores the consented address and sends nothing. The answer is the same 202
 * for a new and a known address, so the endpoint never reveals who is on the list.
 */
async function handlePOST(request: Request) {
  try {
    // 5 per client per hour behind a trusted proxy, and a global cap of 200 per hour that no header can lift.
    const client = clientKey(request);
    if (client) await enforceRateLimit(`newsletter:client:${client}`, 5, 60 * MINUTE);
    await enforceRateLimit("newsletter:global", 200, 60 * MINUTE);
    // JSON only: a cross-site form or text/plain "simple" request (no CORS preflight) cannot submit through visitors' browsers.
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415);
    }
    const body = parseOrThrow(NewsletterBody, await readJson(request));
    NewsletterService.subscribe(body);
    return apiSuccess({ status: "subscribed" }, undefined, 202);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
