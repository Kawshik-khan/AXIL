import { randomUUID } from 'crypto';
import {
  AgentTask,
  TaskStatus,
  TaskPriority,
  ActionRiskLevel,
  WorkflowPlanStep,
} from '@/types/orchestration';
import { AgentType } from '@/types/ai';
import { supervisorAgent } from '../agents/supervisor.agent';
import { planValidator, PlanStepDefinition, PlanValidationResult } from './plan-validator';
import { db } from '@/infrastructure/db';

export class TaskPlanner {
  /**
   * Decomposes a business objective into a validated multi-agent execution DAG.
   */
  public async planObjective(
    tenantId: string,
    objective: string,
    context?: Record<string, unknown>
  ): Promise<{
    steps: PlanStepDefinition[];
    rawPlanSteps: WorkflowPlanStep[];
    validation: PlanValidationResult;
  }> {
    // 1. Ask supervisor agent to decompose
    const rawSteps = supervisorAgent.decomposeObjective({
      objective,
      context,
    });

    // 2. Normalize WorkflowPlanStep to PlanStepDefinition
    const steps: PlanStepDefinition[] = rawSteps.map((s, idx) => ({
      id: s.task_type || `step_${idx + 1}`,
      task_type: s.task_type,
      name: s.objective,
      objective: s.objective,
      agent_type: s.agent_type,
      action: s.task_type,
      dependencies: s.dependencies || [],
      parameters: (s.input_schema as Record<string, any>) || {},
      risk_level: s.risk_level,
      required_tools: s.required_tools,
    }));

    // 3. Validate DAG structure, agent permissions, cycles
    const validation = planValidator.validate(steps);

    return {
      steps,
      rawPlanSteps: rawSteps,
      validation,
    };
  }

  /**
   * Instantiates executable AgentTask entities from validated plan steps.
   */
  public createTasksFromPlan(
    tenantId: string,
    workflowId: string,
    steps: PlanStepDefinition[]
  ): AgentTask[] {
    const now = new Date().toISOString();
    const tasks: AgentTask[] = [];

    // Map step id to generated task id for dependency remapping
    const stepIdToTaskId = new Map<string, string>();
    for (const step of steps) {
      stepIdToTaskId.set(step.id, `task_${randomUUID().substring(0, 8)}`);
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const taskId = stepIdToTaskId.get(step.id)!;
      const remappedDeps = (step.dependencies || []).map((depId) => ({
        task_id: stepIdToTaskId.get(depId) || depId,
        required_status: TaskStatus.COMPLETED,
      }));

      const task: AgentTask = {
        id: taskId,
        tenant_id: tenantId,
        workflow_id: workflowId,
        agent_id: `agent_${step.agent_type.toLowerCase()}`,
        agent_type: step.agent_type as AgentType,
        task_type: step.task_type || step.action,
        objective: step.objective || step.name,
        status: TaskStatus.PENDING,
        priority: TaskPriority.MEDIUM,
        risk_level: step.risk_level || ActionRiskLevel.LOW,
        input: step.parameters || {},
        dependencies: remappedDeps,
        assigned_tools: step.required_tools || [],
        attempt_count: 0,
        max_attempts: 3,
        timeout_ms: (step.timeout_seconds || 30) * 1000,
        idempotency_key: `idemp_${taskId}`,
        created_at: now,
        updated_at: now,
      };

      tasks.push(task);
      db.insertTask(task);
    }

    return tasks;
  }
}

export const taskPlanner = new TaskPlanner();
