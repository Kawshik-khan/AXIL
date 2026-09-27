import { randomSuffix } from "@/lib/ids";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { AgentDefinition } from "@/types/ai";
import { AppError } from "@/lib/errors";
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";
import { autonomyPolicyService } from "@/domains/ai/orchestration/autonomy/autonomy-policy.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");

    if (view === "orchestration" || view === "registry") {
      const registryAgents = agentRegistry.getAllAgents();
      const enriched = registryAgents.map((agent) => {
        const policy = autonomyPolicyService.getPolicy(context.tenant.id, agent.agent_type);
        return {
          ...agent,
          policy,
        };
      });
      return apiSuccess(enriched, { total: enriched.length });
    }

    const agents = db.getAgents(context.tenant.id);
    return apiSuccess(agents, { total: agents.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const body = await request.json();

    // Phase 5: Autonomy Policy & Kill Switch Management
    if (body.action === "TRIGGER_KILL_SWITCH") {
      if (!body.agent_type) {
        throw new AppError("VALIDATION_ERROR", "agent_type is required for Kill Switch", 400);
      }
      const updatedPolicy = autonomyPolicyService.triggerEmergencyStop(
        context.tenant.id,
        body.agent_type,
        body.reason || "Manual Kill Switch triggered from Control Plane"
      );
      return apiSuccess({ success: true, policy: updatedPolicy });
    }

    if (body.action === "CLEAR_KILL_SWITCH") {
      if (!body.agent_type) {
        throw new AppError("VALIDATION_ERROR", "agent_type is required to clear Kill Switch", 400);
      }
      const updatedPolicy = autonomyPolicyService.clearEmergencyStop(
        context.tenant.id,
        body.agent_type
      );
      return apiSuccess({ success: true, policy: updatedPolicy });
    }

    if (body.action === "UPDATE_POLICY") {
      if (!body.agent_type || !body.autonomy_level) {
        throw new AppError("VALIDATION_ERROR", "agent_type and autonomy_level are required", 400);
      }
      const existing = autonomyPolicyService.getPolicy(context.tenant.id, body.agent_type);
      const updated = db.upsertAutonomyPolicy({
        ...existing,
        ...body.policy_updates,
        autonomy_level: body.autonomy_level,
        updated_at: new Date().toISOString(),
      });
      return apiSuccess({ success: true, policy: updated });
    }

    // Phase 4: Create Agent Definition
    if (!body.name || !body.agent_type) {
      throw new AppError("VALIDATION_ERROR", "Agent name and agent_type are required", 400);
    }

    const agent: AgentDefinition = {
      id: `agt_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      agent_type: body.agent_type,
      name: body.name,
      description: body.description || "",
      status: body.status || "ACTIVE",
      model_tier: body.model_tier || "TIER_1_FAST",
      model_name: body.model_name || "gpt-4o-mini",
      prompt_version: body.prompt_version || "1.0.0",
      allowed_channels: body.allowed_channels || ["ALL"],
      allowed_tools: body.allowed_tools || [],
      max_iterations: body.max_iterations || 5,
      max_tool_calls: body.max_tool_calls || 8,
      timeout_ms: body.timeout_ms || 30000,
      is_default: body.is_default || false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const created = db.createAgent(agent);
    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
