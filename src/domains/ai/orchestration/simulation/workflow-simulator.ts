import {
  WorkflowSimulationResult,
  ActionRiskLevel,
  WorkflowPlanStep,
} from '@/types/orchestration';
import { AgentType } from '@/types/ai';
import { supervisorAgent } from '../agents/supervisor.agent';
import { planValidator } from '../planning/plan-validator';
import { autonomyPolicyService } from '../autonomy/autonomy-policy.service';

export class WorkflowSimulator {
  /**
   * Simulates workflow planning and risk projection without mutating state.
   */
  public async simulate(
    tenantId: string,
    objective: string,
    context?: Record<string, unknown>
  ): Promise<WorkflowSimulationResult> {
    const rawSteps = supervisorAgent.decomposeObjective({
      objective,
      context,
    });

    const steps = rawSteps.map((s, idx) => ({
      id: s.task_type || `step_${idx + 1}`,
      name: s.objective,
      agent_type: s.agent_type,
      action: s.task_type,
      dependencies: s.dependencies || [],
      risk_level: s.risk_level,
      parameters: (s.input_schema as Record<string, any>) || {},
    }));

    const validation = planValidator.validate(steps);

    // Extract unique agents and tools
    const agentSet = new Set<AgentType>();
    const toolSet = new Set<string>();
    const approvalPoints: WorkflowSimulationResult['approval_points'] = [];

    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i];
      agentSet.add(step.agent_type);
      for (const tool of step.required_tools || []) {
        toolSet.add(tool);
      }

      const stepRisk = step.risk_level || ActionRiskLevel.LOW;
      const requiresApproval = autonomyPolicyService.requiresApproval(
        tenantId,
        step.agent_type,
        stepRisk
      );

      if (requiresApproval) {
        approvalPoints.push({
          step: i + 1,
          action: step.task_type,
          risk_level: stepRisk,
          reason: `Action risk level ${stepRisk} requires operator approval under current policy.`,
        });
      }
    }

    const estimatedTokens = rawSteps.length * 1250;
    const estimatedCostUsd = Number(((estimatedTokens / 1000) * 0.0015).toFixed(4));
    const estimatedDurationMs = rawSteps.length * 1500;

    return {
      objective,
      planned_steps: rawSteps,
      required_agents: Array.from(agentSet),
      required_tools: Array.from(toolSet),
      estimated_tokens: estimatedTokens,
      estimated_cost_usd: estimatedCostUsd,
      estimated_duration_ms: estimatedDurationMs,
      approval_points: approvalPoints,
      safe_to_execute: validation.isValid && approvalPoints.length <= rawSteps.length,
      warnings: validation.warnings,
    };
  }
}

export const workflowSimulator = new WorkflowSimulator();
