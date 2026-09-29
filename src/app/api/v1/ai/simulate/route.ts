import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentRuntime } from "@/domains/ai/runtime/agent-runtime";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_SIMULATION_RUN);
    await enforceRateLimit(`ai:user:${context.user.id}`, 30, MINUTE); // costly model calls (FX-14)

    const body = await request.json();
    if (!body.message || typeof body.message !== "string") {
      throw new AppError("VALIDATION_ERROR", "Message text is required for simulation", 400);
    }

    const result = await AgentRuntime.simulate({
      context,
      messageText: body.message,
      channelType: body.channel_type || "FACEBOOK",
      customerId: body.customer_id,
      customerName: body.customer_name || "Simulated Customer",
      agentId: body.agent_id,
      conversationId: body.conversation_id,
    });

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
