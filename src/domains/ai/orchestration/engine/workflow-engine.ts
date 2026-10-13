import { AppError } from "@/lib/errors";
import { randomUUID } from 'crypto';
import {
  AgentWorkflow,
  AgentTask,
  WorkflowStatus,
  WorkflowTriggerType,
  WorkflowBudget,
  WorkflowContext,
  WorkflowCheckpoint,
  TaskStatus,
  ActionReceipt,
} from '@/types/orchestration';
import { db } from '@/infrastructure/db';
import { WorkflowJob } from '@/types/orchestration';
import { workflowStateMachine } from './workflow-state-machine';
import { taskPlanner } from '../planning/task-planner';
import { taskExecutor } from './task-executor';
import { workflowBudgetService } from './workflow-budget.service';

export interface CreateWorkflowParams {
  tenantId: string;
  name: string;
  description?: string;
  objective: string;
  templateCode?: string;
  triggerType?: WorkflowTriggerType;
  triggerSource?: string;
  triggerPayload?: Record<string, unknown>;
  createdBy?: string;
  createdByType?: "USER" | "AGENT" | "SYSTEM" | "EVENT";
  contextEntities?: Record<string, unknown>;
  budget?: Partial<WorkflowBudget>;
}

export class WorkflowEngine {
  /** Atomically enqueue a workflow command. The same key returns the original job. */
  public async enqueueAction(
    tenantId: string,
    workflowId: string,
    action: WorkflowJob['action'],
    idempotencyKey: string
  ): Promise<WorkflowJob> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new AppError("VALIDATION_ERROR", "A valid workflow command idempotency key is required.", 400);
    }
    return db.unit(async () => {
      const existing = db.findWorkflowJobByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        if (existing.workflow_id !== workflowId || existing.action !== action) {
          throw new AppError("CONFLICT", "Idempotency key is already used for another workflow command.", 409);
        }
        return existing;
      }
      const now = new Date().toISOString();
      return db.createWorkflowJob({
        id: `wjob_${randomUUID()}`,
        tenant_id: tenantId,
        workflow_id: workflowId,
        action,
        idempotency_key: idempotencyKey,
        status: "PENDING",
        attempt_count: 0,
        max_attempts: 5,
        fence_version: 0,
        created_at: now,
        updated_at: now,
      });
    }, () => true);
  }

  /** Called only by the background worker after it has claimed the durable job. */
  public async executeQueuedAction(job: WorkflowJob, signal?: AbortSignal): Promise<AgentWorkflow> {
    const current = db.getWorkflowJobById(job.tenant_id, job.id);
    if (!current || current.status !== "IN_FLIGHT" || current.claim_token !== job.claim_token) {
      throw new AppError("CONFLICT", "Workflow job lease is no longer owned by this worker.", 409);
    }
    if (job.action === "RESUME") return this.resumeWorkflow(job.tenant_id, job.workflow_id, signal);
    if (job.action === "RETRY") return this.retryWorkflow(job.tenant_id, job.workflow_id, signal);
    return this.startWorkflow(job.tenant_id, job.workflow_id, signal);
  }

  /**
   * Plans and creates a new multi-agent workflow
   */
  public async createWorkflow(params: CreateWorkflowParams): Promise<AgentWorkflow> {
    const tenantId = params.tenantId;
    const workflowId = `wf_${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    // 1. Decompose & Validate DAG Plan
    const { steps, rawPlanSteps, validation, templateCode, templateVersion, clarification } = await taskPlanner.planObjective(
      tenantId,
      params.objective,
      params.contextEntities,
      params.templateCode
    );

    if (!validation.isValid) {
      throw new AppError(
        "VALIDATION_ERROR",
        clarification && steps.length === 0
          ? clarification
          : validation.errors.length
            ? `Invalid workflow plan: ${validation.errors.join(', ')}`
            : clarification || "No supported workflow plan matches this objective.",
        400
      );
    }

    // 2. Validate the immutable limits. Caller-supplied used counters/reservations are never accepted.
    const requestedBudget = params.budget || {};
    const defaultBudget: WorkflowBudget = {
      max_tokens: requestedBudget.max_tokens ?? 50000,
      max_cost_usd: requestedBudget.max_cost_usd ?? 1.0,
      max_tool_calls: requestedBudget.max_tool_calls ?? 30,
      max_tasks: requestedBudget.max_tasks ?? 20,
      max_duration_ms: requestedBudget.max_duration_ms ?? 180000,
      used_tokens: 0,
      used_cost_usd: 0,
      used_tool_calls: 0,
    };
    if (
      !Number.isInteger(defaultBudget.max_tokens) || defaultBudget.max_tokens < 0 ||
      !Number.isFinite(defaultBudget.max_cost_usd) || defaultBudget.max_cost_usd < 0 ||
      !Number.isInteger(defaultBudget.max_tool_calls) || defaultBudget.max_tool_calls < 0 ||
      !Number.isInteger(defaultBudget.max_tasks) || defaultBudget.max_tasks < 1 ||
      !Number.isInteger(defaultBudget.max_duration_ms) || defaultBudget.max_duration_ms < 1
    ) {
      throw new AppError("VALIDATION_ERROR", "Workflow budget limits must be finite, non-negative values with positive task and duration limits.", 400);
    }
    if (steps.length > defaultBudget.max_tasks) {
      throw new AppError("WORKFLOW_BUDGET_EXCEEDED", `Workflow has ${steps.length} tasks but its task limit is ${defaultBudget.max_tasks}.`, 400);
    }

    // 3. Instantiate tasks with per-task ceilings whose totals cannot exceed the workflow caps.
    const tasks = taskPlanner.createTasksFromPlan(tenantId, workflowId, steps);
    const taskIds = tasks.map((t) => t.id);
    tasks.forEach((task, index) => {
      const budget: AgentTask["budget"] = {
        max_tokens: integerShare(defaultBudget.max_tokens, tasks.length, index),
        max_cost_usd: decimalShare(defaultBudget.max_cost_usd, tasks.length, index),
        max_tool_calls: integerShare(defaultBudget.max_tool_calls, tasks.length, index),
        used_tokens: 0,
        used_cost_usd: 0,
        used_tool_calls: 0,
      };
      db.updateTask(tenantId, task.id, { budget });
    });

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
      // No creator means a system-started workflow (it runs with read-only access, FX-19), not a "USER" named "system".
      created_by_type: params.createdByType || (params.createdBy ? "USER" : "SYSTEM"),
      metadata: { template_code: templateCode, template_version: templateVersion },
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
  public async startWorkflow(tenantId: string, workflowId: string, signal?: AbortSignal): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.RUNNING);
    const startedAt = workflow.started_at || new Date().toISOString();
    const deadlineAt = workflow.deadline_at || new Date(Date.parse(startedAt) + workflow.budget.max_duration_ms).toISOString();
    const runningWf = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.RUNNING,
      started_at: startedAt,
      deadline_at: deadlineAt,
    });

    return this.executeWorkflowLoop(runningWf, signal);
  }

  /**
   * Primary execution loop processing tasks topologically
   */
  private async executeWorkflowLoop(workflow: AgentWorkflow, signal?: AbortSignal): Promise<AgentWorkflow> {
    const tenantId = workflow.tenant_id;
    let currentWorkflow = workflow;
    const context = db.getWorkflowContext(tenantId, workflow.id);

    executionLoop: while (true) {
      await workflowBudgetService.reconcileExpiredReservations(tenantId, currentWorkflow.id);
      const latestWorkflow = db.getWorkflowById(tenantId, currentWorkflow.id);
      if (!latestWorkflow) throw new AppError("NOT_FOUND", `Workflow not found: ${currentWorkflow.id}`, 404);
      if (latestWorkflow.status === WorkflowStatus.PAUSED || latestWorkflow.status === WorkflowStatus.CANCELLED) {
        return latestWorkflow;
      }
      if (signal?.aborted) throw new AppError("CONFLICT", "Workflow worker lease was cancelled or lost.", 409);
      currentWorkflow = latestWorkflow;
      if (currentWorkflow.deadline_at && Date.parse(currentWorkflow.deadline_at) <= Date.now()) {
        for (const task of db.getTasks(tenantId, currentWorkflow.id)) {
          if ([TaskStatus.PENDING, TaskStatus.READY, TaskStatus.WAITING_DEPENDENCY, TaskStatus.RUNNING, TaskStatus.WAITING_APPROVAL, TaskStatus.WAITING_HUMAN].some((status) => status === task.status)) {
            db.updateTask(tenantId, task.id, { status: TaskStatus.EXPIRED, completed_at: new Date().toISOString(), error: "Workflow duration budget exceeded." });
          }
        }
        currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
          status: WorkflowStatus.FAILED,
          error: "Workflow duration budget exceeded.",
          completed_at: new Date().toISOString(),
        });
        this.createCheckpoint(currentWorkflow, "Workflow duration budget exceeded");
        return currentWorkflow;
      }
      const allTasks = db.getTasks(tenantId, currentWorkflow.id);
      const failedTask = allTasks.find((task) => task.status === TaskStatus.FAILED || task.status === TaskStatus.EXPIRED);
      if (failedTask) {
        currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
          status: WorkflowStatus.FAILED,
          error: failedTask.error || `Task ${failedTask.id} failed or expired.`,
          completed_at: new Date().toISOString(),
        });
        this.createCheckpoint(currentWorkflow, `Task ${failedTask.id} failed or expired`);
        return currentWorkflow;
      }
      const runningTask = allTasks.find((task) => task.status === TaskStatus.RUNNING);
      if (runningTask) {
        await this.waitForRunningTask(tenantId, currentWorkflow, runningTask, signal);
        continue executionLoop;
      }
      const unknownTask = allTasks.find((task) => task.status === TaskStatus.OUTCOME_UNKNOWN);
      if (unknownTask) {
        currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
          status: WorkflowStatus.WAITING,
          error: `Task ${unknownTask.id} has an uncertain external outcome and needs reconciliation.`,
        });
        this.createCheckpoint(currentWorkflow, `Task ${unknownTask.id} outcome requires reconciliation`);
        return currentWorkflow;
      }
      const retryWaitTask = allTasks.find((task) => task.status === TaskStatus.RETRY_WAIT);
      if (retryWaitTask) {
        const remaining = Math.max(0, Date.parse(retryWaitTask.next_attempt_at || "") - Date.now());
        if (remaining > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(remaining, 1_000));
            const abort = () => { clearTimeout(timer); resolve(); };
            signal?.addEventListener("abort", abort, { once: true });
            timer.unref?.();
          });
          if (signal?.aborted) throw new AppError("CONFLICT", "Workflow worker lease was cancelled or lost.", 409);
          continue executionLoop;
        }
      }
      const pendingTasks = allTasks.filter(
        (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.WAITING_DEPENDENCY ||
          (t.status === TaskStatus.RETRY_WAIT && (!t.next_attempt_at || Date.parse(t.next_attempt_at) <= Date.now()))
      );

      // If no tasks left to run
      if (pendingTasks.length === 0) {
        const hasFailed = allTasks.some((t) => t.status === TaskStatus.FAILED || t.status === TaskStatus.EXPIRED);
        const hasWaiting = allTasks.some(
          (t) =>
            t.status === TaskStatus.WAITING_APPROVAL ||
            t.status === TaskStatus.WAITING_HUMAN || t.status === TaskStatus.OUTCOME_UNKNOWN
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
        const result = await taskExecutor.executeTask(task, context?.relevant_entities, signal);

        const currentAfterTask = db.getWorkflowById(tenantId, currentWorkflow.id);
        if (currentAfterTask?.status === WorkflowStatus.CANCELLED || currentAfterTask?.status === WorkflowStatus.PAUSED) {
          return currentAfterTask;
        }
        if (result.status === TaskStatus.RUNNING) {
          await this.waitForRunningTask(tenantId, currentAfterTask || currentWorkflow, task, signal);
          continue executionLoop;
        }

        if (result.approvalRequired || result.status === TaskStatus.WAITING_APPROVAL) {
          currentWorkflow = db.updateWorkflow(tenantId, currentWorkflow.id, {
            status: WorkflowStatus.WAITING,
          });
          this.createCheckpoint(currentWorkflow, `Waiting for approval on task ${task.id}`);
          return currentWorkflow;
        }

        if (result.status === TaskStatus.FAILED || result.status === TaskStatus.EXPIRED) {
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

  private async waitForRunningTask(tenantId: string, workflow: AgentWorkflow, task: AgentTask, signal?: AbortSignal): Promise<void> {
    const currentTask = db.getTaskById(tenantId, task.id) || task;
    const now = Date.now();
    const taskDeadline = currentTask.deadline ? Date.parse(currentTask.deadline) : Number.NaN;
    const workflowDeadline = workflow.deadline_at ? Date.parse(workflow.deadline_at) : Number.NaN;
    const deadlineAt = Number.isFinite(taskDeadline) ? taskDeadline
      : Number.isFinite(workflowDeadline) ? workflowDeadline
        : now + 1_000;
    if (deadlineAt <= now) {
      await workflowBudgetService.reconcileExpiredReservations(tenantId, workflow.id);
      const latest = db.getTaskById(tenantId, currentTask.id);
      if (latest?.status === TaskStatus.RUNNING) {
        db.updateTask(tenantId, currentTask.id, {
          status: TaskStatus.EXPIRED,
          completed_at: new Date().toISOString(),
          error: "Task deadline expired while recovering a prior worker.",
        });
      }
      return;
    }
    await db.syncIfDue();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.min(500, deadlineAt - now));
      const onAbort = () => done();
      function done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }
      if (signal?.aborted) done();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Pauses an active workflow
   */
  public async pauseWorkflow(tenantId: string, workflowId: string, reason: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.PAUSED);
    const updated = db.updateWorkflow(tenantId, workflowId, { status: WorkflowStatus.PAUSED });
    this.createCheckpoint(updated, `Workflow paused: ${reason}`);
    return updated;
  }

  /**
   * Resumes a paused or waiting workflow
   */
  public async resumeWorkflow(tenantId: string, workflowId: string, signal?: AbortSignal): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.RUNNING);
    const updated = db.updateWorkflow(tenantId, workflowId, { status: WorkflowStatus.RUNNING });
    for (const task of db.getTasks(tenantId, workflowId)) {
      if (task.status === TaskStatus.PAUSED) db.updateTask(tenantId, task.id, { status: TaskStatus.PENDING });
    }
    return this.executeWorkflowLoop(updated, signal);
  }

  /**
   * Cancels a workflow and terminates all pending tasks
   */
  public async cancelWorkflow(tenantId: string, workflowId: string, reason: string): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.CANCELLED);
    const updated = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.CANCELLED,
      error: `Cancelled: ${reason}`,
      completed_at: new Date().toISOString(),
    });

    const tasks = db.getTasks(workflow.tenant_id, workflowId);
    for (const t of tasks) {
      if (![TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.EXPIRED, TaskStatus.CANCELLED].some((terminal) => terminal === t.status)) {
        db.updateTask(tenantId, t.id, { status: TaskStatus.CANCELLED });
      }
    }

    this.createCheckpoint(updated, `Workflow cancelled: ${reason}`);
    return updated;
  }

  /**
   * Retries a failed workflow by resetting failed tasks
   */
  public async retryWorkflow(tenantId: string, workflowId: string, signal?: AbortSignal): Promise<AgentWorkflow> {
    const workflow = db.getWorkflowById(tenantId, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", `Workflow not found: ${workflowId}`, 404);

    workflowStateMachine.assertWorkflowTransition(workflow.status, WorkflowStatus.QUEUED);
    const updated = db.updateWorkflow(tenantId, workflowId, {
      status: WorkflowStatus.QUEUED,
      error: undefined,
    });

    const tasks = db.getTasks(workflow.tenant_id, workflowId);
    for (const t of tasks) {
      if (t.status === TaskStatus.FAILED && (t.failure_class === "RETRYABLE" || t.failure_class === "RATE_LIMITED")) {
        db.updateTask(tenantId, t.id, {
          status: TaskStatus.PENDING,
          deadline: undefined,
          next_attempt_at: undefined,
          error: undefined,
          failure_class: undefined,
        });
      }
    }

    return this.startWorkflow(tenantId, workflowId, signal);
  }

  /** Resolve an uncertain action only after an operator has checked the provider/domain system of record. */
  public async reconcileTaskOutcome(
    tenantId: string,
    taskId: string,
    resolution: "APPLIED" | "NOT_APPLIED",
    actorId: string,
    evidenceReference: string,
    confirmedResult?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentWorkflow> {
    const task = db.getTaskById(tenantId, taskId);
    if (!task) throw new AppError("NOT_FOUND", `Task not found: ${taskId}`, 404);
    if (task.status !== TaskStatus.OUTCOME_UNKNOWN) throw new AppError("CONFLICT", "Only tasks with unknown outcomes can be reconciled.", 409);
    if (!actorId.trim() || !evidenceReference.trim()) throw new AppError("VALIDATION_ERROR", "Reconciliation requires an actor and evidence reference.", 400);
    if (resolution === "APPLIED" && !confirmedResult) throw new AppError("VALIDATION_ERROR", "Confirmed applied outcomes require the authoritative result.", 400);

    await db.unit(async () => {
      const current = db.getTaskById(tenantId, taskId);
      if (!current || current.status !== TaskStatus.OUTCOME_UNKNOWN) throw new AppError("CONFLICT", "Task outcome was already reconciled.", 409);
      const now = new Date().toISOString();
      const history = Array.isArray(current.metadata?.reconciliations) ? current.metadata.reconciliations : [];
      if (resolution === "APPLIED") {
        const existing = db.getActionReceiptByIdempotencyKey(tenantId, current.idempotency_key);
        if (!existing) {
          const receipt: ActionReceipt = {
            id: `rcpt_${randomUUID().substring(0, 8)}`, tenant_id: tenantId, workflow_id: current.workflow_id,
            task_id: current.id, action: current.task_type, actor_agent: current.agent_type,
            target_entity: (current.input.target_entity as string) || "DOMAIN_OBJECT",
            target_id: (current.input.target_id as string) || current.id, status: "SUCCESS",
            idempotency_key: current.idempotency_key, provider_reference: evidenceReference,
            result: confirmedResult!, created_at: now,
          };
          db.insertActionReceipt(receipt);
        }
        db.updateTask(tenantId, taskId, {
          status: TaskStatus.COMPLETED, output: existing?.result || confirmedResult,
          completed_at: now, error: undefined, failure_class: undefined,
          metadata: { ...current.metadata, reconciliations: [...history, { resolution, actor_id: actorId, evidence_reference: evidenceReference, created_at: now }] },
        });
      } else {
        db.updateTask(tenantId, taskId, {
          status: TaskStatus.PENDING, error: undefined, failure_class: undefined,
          next_attempt_at: undefined,
          metadata: { ...current.metadata, reconciliations: [...history, { resolution, actor_id: actorId, evidence_reference: evidenceReference, created_at: now }] },
        });
      }
    }, () => true);
    return this.resumeWorkflow(tenantId, task.workflow_id, signal);
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

function integerShare(total: number, count: number, index: number): number {
  const base = Math.floor(total / count);
  return base + (index < total % count ? 1 : 0);
}

function decimalShare(total: number, count: number, index: number): number {
  const base = total / count;
  return Number((index === count - 1 ? total - base * index : base).toFixed(8));
}

export const workflowEngine = new WorkflowEngine();
