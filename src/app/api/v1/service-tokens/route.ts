import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ServiceTokenService } from "@/domains/automation/services/service-token.service";
import { parseOrThrow, readJson } from "@/lib/validation";

const CreateBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.string().max(100)).min(1).max(20),
    expires_in_days: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

/** Lists this workspace's service tokens (never the secrets). */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ service_tokens: ServiceTokenService.list(context) });
  } catch (err) {
    return apiError(err);
  }
}

/** Creates a service token. The token value is in this response only; it can't be shown again. */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(CreateBody, await readJson(request));
    const created = ServiceTokenService.create(context, input);
    const response = apiSuccess(created, undefined, 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    return apiError(err);
  }
}
