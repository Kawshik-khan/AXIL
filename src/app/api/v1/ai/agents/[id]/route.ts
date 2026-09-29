import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { AgentDefinition } from "@/types/ai";
import { withStore } from "@/lib/store-unit";

// FX-12: identity, type and tenant are fixed; limits are bounded.
const AgentPatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    status: z.enum(["ACTIVE", "INACTIVE", "PAUSED", "MAINTENANCE"]),
    model_tier: z.enum(["TIER_1_FAST", "TIER_2_REASONING", "TIER_3_EMBEDDING"]),
    model_name: z.string().trim().min(1).max(120),
    prompt_version: z.string().trim().min(1).max(40),
    allowed_channels: z.array(z.string().max(40)).max(20),
    allowed_tools: z.array(z.string().max(100)).max(100),
    max_iterations: z.number().int().min(1).max(50),
    max_tool_calls: z.number().int().min(0).max(100),
    timeout_ms: z.number().int().min(1000).max(300_000),
    is_default: z.boolean(),
  })
  .partial()
  .strict();

async function handleGET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const agent = db.findAgentById(context.tenant.id, params.id);
    if (!agent) {
      throw new AppError("NOT_FOUND", `Agent ${params.id} not found`, 404);
    }

    return apiSuccess(agent);
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const existing = db.findAgentById(context.tenant.id, params.id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `Agent ${params.id} not found`, 404);
    }

    const body = parseOrThrow(AgentPatch, await readJson(request));
    const updated = db.updateAgent(context.tenant.id, params.id, body as Partial<AgentDefinition>);
    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
