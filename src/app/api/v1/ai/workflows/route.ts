import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(2000),
  template_code: z.enum(["ABANDONED_CART_RECOVERY", "LOW_STOCK_RESTOCK", "DELIVERY_EXCEPTION_RESOLVE", "REFUND_REVIEW", "WHOLESALE_QUOTE"]).optional(),
  description: z.string().trim().max(2000).optional(),
  trigger_type: z.enum(["MANUAL", "EVENT", "SCHEDULE", "AGENT", "WEBHOOK", "SYSTEM"]).optional(),
  context_entities: z.record(z.unknown()).optional(),
  budget: z.object({
    max_tokens: z.number().int().positive().max(1_000_000).optional(),
    max_cost_usd: z.number().finite().nonnegative().max(10_000).optional(),
    max_tool_calls: z.number().int().nonnegative().max(1000).optional(),
    max_tasks: z.number().int().positive().max(500).optional(),
    max_duration_ms: z.number().int().positive().max(86_400_000).optional(),
  }).strict().optional(),
  auto_start: z.boolean().optional(),
}).strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const workflows = db.getWorkflows(context.tenant.id, status);
    return apiSuccess(workflows, { total: workflows.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const body = parseOrThrow(Body, await readJson(request));

    const workflow = await workflowEngine.createWorkflow({
      tenantId: context.tenant.id,
      name: body.name,
      description: body.description,
      objective: body.objective,
      templateCode: body.template_code,
      triggerType: body.trigger_type,
      createdBy: context.user.id,
      createdByType: "USER",
      contextEntities: body.context_entities,
      budget: body.budget,
    });

    if (body.auto_start) {
      const idempotencyKey = request.headers.get("idempotency-key") || `workflow:${workflow.id}:start`;
      const job = await workflowEngine.enqueueAction(workflow.tenant_id, workflow.id, "START", idempotencyKey);
      return apiSuccess({ ...workflow, execution_job: job }, undefined, 202);
    }

    return apiSuccess(workflow, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
