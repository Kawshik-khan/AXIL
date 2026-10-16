import {
  WorkflowSimulationResult,
  ActionRiskLevel,
  WorkflowPlanStep,
} from '@/types/orchestration';
import { AgentType } from '@/types/ai';
import { supervisorAgent } from '../agents/supervisor.agent';
import { planValidator } from '../planning/plan-validator';
import { autonomyPolicyService } from '../autonomy/autonomy-policy.service';
import { isWorkflowTaskReady } from '../engine/task-executor';

export class WorkflowSimulator {
  /**
   * Simulates workflow planning and risk projection without mutating state.
   */
  public async simulate(
    tenantId: string,
    objective: string,
    context?: Record<string, unknown>,
    templateCode?: string
  ): Promise<WorkflowSimulationResult> {
    const selection = supervisorAgent.selectTemplate({ objective, context, templateCode });
    const rawSteps = supervisorAgent.decomposeObjective({
      objective,
      context,
      templateCode,
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
    const unsupportedHandlers = rawSteps
      .filter((step) => !isWorkflowTaskReady(step.task_type, step.agent_type, (step.input_schema as Record<string, unknown>) || {}, context || {}))
      .map((step) => step.task_type);
    const executionReady = selection.status === "SELECTED" && validation.isValid && unsupportedHandlers.length === 0;

    return {
      objective,
      workflow_code: selection.code ? `${selection.code}@${selection.version}` : undefined,
      planned_steps: rawSteps,
      required_agents: Array.from(agentSet),
      required_tools: Array.from(toolSet),
      estimated_tokens: estimatedTokens,
      estimated_cost_usd: estimatedCostUsd,
      estimated_duration_ms: estimatedDurationMs,
      approval_points: approvalPoints,
      safe_to_execute: selection.status === "SELECTED" && validation.isValid && approvalPoints.length <= rawSteps.length,
      execution_ready: executionReady,
      warnings: [
        ...validation.warnings,
        ...(validation.isValid ? [] : validation.errors),
        ...(selection.status === "AMBIGUOUS" ? ["Objective matches multiple templates; select a template or clarify the request: " + selection.candidates.join(", ")] : []),
        ...(selection.status === "UNKNOWN" ? ["No supported workflow template matches this objective; manual review or clarification is required."] : []),
        ...(unsupportedHandlers.length ? ["Typed execution handlers are not registered for: " + Array.from(new Set(unsupportedHandlers)).join(", ")] : []),
      ],
    };
  }
}

export const workflowSimulator = new WorkflowSimulator();
