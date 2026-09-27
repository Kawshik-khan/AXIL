import { randomUUID } from 'crypto';
import {
  AgentWorkflow,
  WorkflowStatus,
  WorkflowTriggerType,
  WorkflowBudget,
  WorkflowContext,
  WorkflowCheckpoint,
  TaskStatus,
} from '@/types/orchestration';
import { db } from '@/infrastructure/db';
import { workflowStateMachine } from './workflow-state-machine';
import { taskPlanner } from '../planning/task-planner';
import { taskExecutor } from './task-executor';

export interface CreateWorkflowParams {
  tenantId: string;
  name: string;
  description?: string;
  objective: string;
  triggerType?: WorkflowTriggerType;
  triggerSource?: string;
  triggerPayload?: Record<string, unknown>;
  createdBy?: string;
  createdByType?: "USER" | "AGENT" | "SYSTEM" | "EVENT";
  contextEntities?: Record<string, unknown>;
  budget?: Partial<WorkflowBudget>;
}

export class WorkflowEngine {
  /**
   * Plans and creates a new multi-agent workflow
   */
  public async createWorkflow(params: CreateWorkflowParams): Promise<AgentWorkflow> {
    const tenantId = params.tenantId;
    const workflowId = `wf_${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    // 1. Decompose & Validate DAG Plan
    const { steps, rawPlanSteps, validation } = await taskPlanner.planObjective(
      tenantId,
      params.objective,
      params.contextEntities
    );

    if (!validation.isValid) {
      throw new Error(`Invalid workflow plan: ${validation.errors.join(', ')}`);
    }

    // 2. Instantiate Tasks in DB
    const tasks = taskPlanner.createTasksFromPlan(tenantId, workflowId, steps);
    const taskIds = tasks.map((t) => t.id);

    // 3. Initialize Budget
    const defaultBudget: WorkflowBudget = {
      max_tokens: 50000,
      max_cost_usd: 1.0,
      max_tool_calls: 30,
      max_tasks: 20,
      max_duration_ms: 180000,
      used_tokens: 0,
      used_cost_usd: 0,
      used_tool_calls: 0,
      ...params.budget,
    };

    // 4. Initialize Context
    const contextId = `ctx_${randomUUID().substring(0, 8)}`;
    const workflowContext: WorkflowContext = {
      id: contextId,
      tenant_id: tenantId,
      workflow_id: workflowId,
      objective: params.objective,
      relevant_entities: params.contextEntities || {},
      completed_tasks: [],
      active_tasks: [],
      artifacts: [],
      constraints: [],
      approved_actions: [],
      created_at: now,
      updated_at: now,
    };
    db.upsertWorkflowContext(workflowContext);

    // 5. Instantiate Workflow Entity
    const workflow: AgentWorkflow = {
      id: workflowId,
      tenant_id: tenantId,
      name: params.name,
      description: params.description || `Autonomous execution of: ${params.objective}`,
      trigger_type: params.triggerType || WorkflowTriggerType.MANUAL,
      trigger_source: params.triggerSource,
      trigger_payload: params.triggerPayload,
      status: WorkflowStatus.QUEUED,
      objective: params.objective,
      plan: rawPlanSteps,
      tasks: taskIds,
      current_step: 0,
      total_steps: tasks.length,
      budget: defaultBudget,
      context_id: contextId,
      created_by: params.createdBy || "system",
      created_by_type: params.createdByType || "USER",
      created_at: now,
      updated_at: now,
    };

    db.insertWorkflow(workflow);

    // 6. Initial Checkpoint
    this.createCheckpoint(workflow, "Initial plan checkpoint");

    return workflow;
  }

  /**
   * Starts executing tasks in a workflow
   */
  public async startWorkflow(tenantId: string, workflowId: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.RUNNING);
    const runningWf = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.RUNNING,
      started_at: workflow.started_at || new Date().toISOString(),
    });

    return this.executeWorkflowLoop(runningWf);
  }

  /**
   * Primary execution loop processing tasks topologically
   */
  private async executeWorkflowLoop(workflow: AgentWorkflow): Promise<AgentWorkflow> {
    const tenantId = workflow.tenant_id;
    let currentWorkflow = workflow;
    const context = db.getWorkflowContext(tenantId, workflow.id);

    while (true) {
      const allTasks = db.getTasks(tenantId, currentWorkflow.id);
      const pendingTasks = allTasks.filter(
        (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.WAITING_DEPENDENCY
      );

      // If no tasks left to run
      if (pendingTasks.length === 0) {
        const hasFailed = allTasks.some((t) => t.status === TaskStatus.FAILED);
        const hasWaiting = allTasks.some(
          (t) =>
            t.status === TaskStatus.WAITING_APPROVAL ||
            t.status === TaskStatus.WAITING_HUMAN
        );

        if (hasFailed) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.FAILED,
            error: "One or more tasks failed during execution.",
            completed_at: new Date().toISOString(),
          });
        } else if (hasWaiting) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.WAITING,
          });
        } else {
          // Everything completed!
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.COMPLETED,
            completed_at: new Date().toISOString(),
          });
        }

        this.createCheckpoint(currentWorkflow, "Workflow execution finished or waiting");
        return currentWorkflow;
      }

      // Find tasks whose dependencies are satisfied
      const readyTasks = pendingTasks.filter((t) => {
        if (!t.dependencies || t.dependencies.length === 0) return true;
        return t.dependencies.every((dep) => {
          const parent = allTasks.find((p) => p.id === dep.task_id);
          const reqStatus = dep.required_status || TaskStatus.COMPLETED;
          return parent && parent.status === reqStatus;
        });
      });

      if (readyTasks.length === 0) {
        // Deadlock or waiting for external approval
        const isWaitingApproval = allTasks.some((t) => t.status === TaskStatus.WAITING_APPROVAL);
        if (isWaitingApproval) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.WAITING,
          });
          return currentWorkflow;
        }

        // Otherwise dependency deadlock
        currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
          status: WorkflowStatus.FAILED,
          error: "Workflow deadlocked: No tasks are ready to run.",
        });
        return currentWorkflow;
      }

      // Execute ready tasks in parallel
      for (const task of readyTasks) {
        const result = await taskExecutor.executeTask(task, context?.relevant_entities);

        if (result.approvalRequired || result.status === TaskStatus.WAITING_APPROVAL) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.WAITING,
          });
          this.createCheckpoint(currentWorkflow, `Waiting for approval on task ${task.id}`);
          return currentWorkflow;
        }

        if (result.status === TaskStatus.FAILED) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.FAILED,
            error: result.error || `Task ${task.id} failed`,
          });
          this.createCheckpoint(currentWorkflow, `Task ${task.id} failed`);
          return currentWorkflow;
        }
      }

      // Checkpoint step
      currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
        current_step: currentWorkflow.current_step + 1,
      });
      this.createCheckpoint(currentWorkflow, `Step ${currentWorkflow.current_step} completed`);
    }
  }

  /**
   * Pauses an active workflow
   */
  public async pauseWorkflow(tenantId: string, workflowId: string, reason: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.PAUSED);
    const updated = db.updateWorkflow(tenantId, workflowId, { status: WorkflowStatus.PAUSED });
    this.createCheckpoint(updated, `Workflow paused: ${reason}`);
    return updated;
  }

  /**
   * Resumes a paused or waiting workflow
   */
  public async resumeWorkflow(tenantId: string, workflowId: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.RUNNING);
    const updated = db.updateWorkflow(tenantId, workflowId, { status: WorkflowStatus.RUNNING });
    return this.executeWorkflowLoop(updated);
  }

  /**
   * Cancels a workflow and terminates all pending tasks
   */
  public async cancelWorkflow(tenantId: string, workflowId: string, reason: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.CANCELLED);
    const updated = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.CANCELLED,
      error: `Cancelled: ${reason}`,
      completed_at: new Date().toISOString(),
    });

    const tasks = db.getTasks(workflow.tenant_id, workflowId);
    for (const t of tasks) {
      if (t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.FAILED) {
        db.updateTask(tenantId, t.id, { status: TaskStatus.CANCELLED });
      }
    }

    this.createCheckpoint(updated, `Workflow cancelled: ${reason}`);
    return updated;
  }

  /**
   * Retries a failed workflow by resetting failed tasks
   */
  public async retryWorkflow(tenantId: string, workflowId: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.QUEUED);
    const updated = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.QUEUED,
      error: undefined,
    });

    const tasks = db.getTasks(workflow.tenant_id, workflowId);
    for (const t of tasks) {
      if (t.status === TaskStatus.FAILED) {
        db.updateTask(tenantId, t.id, {
          status: TaskStatus.PENDING,
          attempt_count: 0,
          error: undefined,
        });
      }
    }

    return this.startWorkflow(tenantId, workflowId);
  }

  /**
   * Checkpoints current workflow state
   */
  public createCheckpoint(workflow: AgentWorkflow, reason: string): WorkflowCheckpoint {
    const tasks = db.getTasks(workflow.tenant_id, workflow.id);
    const context = db.getWorkflowContext(workflow.tenant_id, workflow.id) || {
      id: `ctx_${workflow.id}`,
      tenant_id: workflow.tenant_id,
      workflow_id: workflow.id,
      objective: workflow.objective,
      relevant_entities: {},
      completed_tasks: [],
      active_tasks: [],
      artifacts: [],
      constraints: [],
      approved_actions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const checkpoint: WorkflowCheckpoint = {
      id: `chk_${randomUUID().substring(0, 8)}`,
      tenant_id: workflow.tenant_id,
      workflow_id: workflow.id,
      step_index: workflow.current_step,
      status: workflow.status,
      snapshot: {
        workflow,
        tasks,
        context,
        budget: workflow.budget,
      },
      reason,
      created_at: new Date().toISOString(),
    };

    db.insertWorkflowCheckpoint(checkpoint);
    return checkpoint;
  }
}

export const workflowEngine = new WorkflowEngine();
