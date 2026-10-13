import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Query = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED", "ARCHIVED", "PROVISIONING", "PAST_DUE", "CANCELLED"]).optional(),
  plan_id: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const q = parseOrThrow(Query, {
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      plan_id: searchParams.get("plan_id") || undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });
    const result = PlatformTenantService.listTenants(q, context);
    return apiSuccess(result.tenants, { total: result.total, limit: q.limit, offset: q.offset });
  } catch (error) {
    return apiError(error);
  }
}

const ProvisionBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use 2–63 lowercase letters, digits and dashes."),
    legal_name: z.string().trim().max(200).optional(),
    plan_id: z.string().trim().min(1).max(40),
    owner_email: z.string().trim().email().max(200),
    owner_name: z.string().trim().min(1).max(120),
    currency: z.string().trim().length(3).optional(),
    timezone: z.string().trim().max(60).optional(),
    country: z.string().trim().length(2).optional(),
    start_trial: z.boolean().optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(ProvisionBody, await readJson(request));
    return apiSuccess(PlatformTenantService.provisionTenant(body, context), undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
