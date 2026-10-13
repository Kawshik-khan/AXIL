import { randomUUID } from 'crypto';
import {
  AgentTask,
  TaskStatus,
  ActionRiskLevel,
  ActionReceipt,
  AgentMessage,
  AgentMessageType,
  ApprovalRequest,
  ApprovalStatus,
} from '@/types/orchestration';
import { db } from '@/infrastructure/db';
import { workflowStateMachine } from './workflow-state-machine';
import { verifierAgent } from '../agents/verifier.agent';
import { inventoryAgent } from '../agents/operations-inventory.agent';
import { shippingAgent } from '../agents/operations-shipping.agent';
import { paymentAgent } from '../agents/operations-payment.agent';
import { RequestContext } from '@/lib/context';
import { PERMISSIONS, Permission } from '@/lib/permissions';
import { RbacService } from '@/domains/rbac/service';
import { ForbiddenError } from '@/lib/errors';
import { AppError, isAppError } from '@/lib/errors';
import { workflowBudgetService } from './workflow-budget.service';
import { autonomyPolicyService } from '../autonomy/autonomy-policy.service';
import { approvalBindingMismatch, approvalDigest, approvalPayloadDigest, captureApprovalTargetState } from '../autonomy/approval-binding';

/**
 * What system- and event-started workflows may do (FX-19, audit M12). They have no human creator, and the agents
 * they run only read (stock, shipping estimates, payment status), so they get read access, not OWNER.
 */
const SYSTEM_WORKFLOW_PERMISSIONS: Permission[] = [
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.SHIPMENTS_READ,
  PERMISSIONS.PAYMENTS_READ,
  PERMISSIONS.ORDERS_READ,
  PERMISSIONS.CUSTOMERS_READ,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.AI_RUN,
];

const TASK_HANDLER_AGENT: Readonly<Record<string, string>> = Object.freeze({
  AUDIT_WAREHOUSE_STOCK: "INVENTORY",
  CALCULATE_SHIPPING_ESTIMATE: "SHIPPING",
  CALCULATE_ESTIMATE: "SHIPPING",
  VERIFY_PAYMENT_TRX: "PAYMENT",
});

export function isWorkflowTaskHandlerRegistered(taskType: string, agentType?: string): boolean {
  const registeredAgent = TASK_HANDLER_AGENT[taskType];
  return !!registeredAgent && (!agentType || registeredAgent === agentType);
}

export function isWorkflowTaskReady(
  taskType: string,
  agentType: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {},
): boolean {
  if (!isWorkflowTaskHandlerRegistered(taskType, agentType)) return false;
  if (taskType === "AUDIT_WAREHOUSE_STOCK") return typeof (input.variant_id ?? context.variant_id) === "string";
  if (taskType === "CALCULATE_SHIPPING_ESTIMATE" || taskType === "CALCULATE_ESTIMATE") {
    const weight = input.weight_kg ?? context.weight_kg;
    return typeof (input.city ?? context.city) === "string" && typeof weight === "number" && Number.isFinite(weight) && weight > 0;
  }
  if (taskType === "VERIFY_PAYMENT_TRX") return typeof (input.payment_id ?? context.payment_id) === "string";
  return false;
}

export interface TaskExecutionResult {
  task: AgentTask;
  status: TaskStatus;
  output?: Record<string, unknown>;
  receipt?: ActionReceipt;
  approvalRequired?: boolean;
  approvalId?: string;
  error?: string;
}

class TaskDeadlineExceeded extends Error {
  constructor() { super("Task deadline exceeded."); this.name = "TaskDeadlineExceeded"; }
}

/** Raised by a provider/effect adapter when it cannot prove whether a remote effect committed. */
export class TaskOutcomeUnknownError extends Error {
  constructor(message = "The external action outcome could not be confirmed.") {
    super(message);
    this.name = "TaskOutcomeUnknownError";
  }
}

function classifyFailure(err: unknown): AgentTask["failure_class"] {
  if (err instanceof TaskOutcomeUnknownError) return "OUTCOME_UNKNOWN";
  if (isAppError(err)) {
    if (err.statusCode === 429) return "RATE_LIMITED";
    if (err.statusCode === 401 || err.statusCode === 403) return "POLICY_DENIED";
    if (err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 409) return "PERMANENT";
  }
  return "RETRYABLE";
}

function retryDelayMs(attempt: number, taskId: string): number {
  // Stable 0.75–1.25 jitter, reproducible for the same task/attempt and bounded to 30 minutes.
  const base = Math.min(30 * 60_000, 1_000 * (2 ** Math.min(10, Math.max(0, attempt - 1))));
  let hash = 2166136261;
  for (const char of `${taskId}:${attempt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const jitter = 0.75 + ((hash >>> 0) / 0xffffffff) * 0.5;
  return Math.round(base * jitter);
}

function awaitWithSignal<T>(work: Promise<T>, signal: AbortSignal, deadlineAt: number): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (signal.aborted) return Promise.reject(new Error("Task execution cancelled."));
  if (remainingMs <= 0) return Promise.reject(new TaskDeadlineExceeded());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TaskDeadlineExceeded()), remainingMs);
    const onAbort = () => reject(new Error("Task execution cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export class TaskExecutor {
  /**
   * Executes a single task within a workflow context.
   */
  public async executeTask(
    task: AgentTask,
    contextEntities?: Record<string, unknown>,
    cancellationSignal?: AbortSignal,
  ): Promise<TaskExecutionResult> {
    const tenantId = task.tenant_id;

    const initialWorkflow = db.getWorkflowById(tenantId, task.workflow_id);
    const initialTask = db.getTaskById(tenantId, task.id) || task;
    if (initialWorkflow?.status === "CANCELLED" || initialTask.status === TaskStatus.CANCELLED) {
      if (initialTask.status !== TaskStatus.CANCELLED) db.updateTask(tenantId, task.id, { status: TaskStatus.CANCELLED, completed_at: new Date().toISOString() });
      return { task: db.getTaskById(tenantId, task.id) || initialTask, status: TaskStatus.CANCELLED };
    }
    if (initialWorkflow?.status === "PAUSED") {
      if (initialTask.status !== TaskStatus.PAUSED) db.updateTask(tenantId, task.id, { status: TaskStatus.PAUSED });
      return { task: db.getTaskById(tenantId, task.id) || initialTask, status: TaskStatus.PAUSED };
    }

    // Recover a committed action receipt after a worker crash between action completion and task checkpoint.
    const priorReceipt = db.getActionReceiptByIdempotencyKey(tenantId, task.idempotency_key);
    if (initialTask.status === TaskStatus.RUNNING && priorReceipt?.status === "SUCCESS" &&
        priorReceipt.workflow_id === task.workflow_id && priorReceipt.task_id === task.id) {
      const completed = db.updateTask(tenantId, task.id, {
        status: TaskStatus.COMPLETED,
        output: priorReceipt.result,
        completed_at: task.completed_at || priorReceipt.created_at,
        error: undefined,
        failure_class: undefined,
        next_attempt_at: undefined,
      });
      return { task: completed, status: TaskStatus.COMPLETED, output: priorReceipt.result, receipt: priorReceipt };
    }
    if (task.status === TaskStatus.OUTCOME_UNKNOWN) {
      return { task, status: TaskStatus.OUTCOME_UNKNOWN, error: task.error };
    }
    if (task.status === TaskStatus.RETRY_WAIT && task.next_attempt_at && Date.parse(task.next_attempt_at) > Date.now()) {
      return { task, status: TaskStatus.RETRY_WAIT, error: task.error };
    }
    if (task.status === TaskStatus.RETRY_WAIT) {
      db.updateTask(tenantId, task.id, { status: TaskStatus.PENDING, next_attempt_at: undefined });
      task = { ...task, status: TaskStatus.PENDING, next_attempt_at: undefined };
    }

    // 1. Dependency Check
    if (task.dependencies && task.dependencies.length > 0) {
      for (const dep of task.dependencies) {
        const depTask = db.getTaskById(tenantId, dep.task_id);
        const requiredStatus = dep.required_status || TaskStatus.COMPLETED;
        if (!depTask || depTask.status !== requiredStatus) {
          workflowStateMachine.assertTaskTransition(task.status, TaskStatus.WAITING_DEPENDENCY);
          const updated = db.updateTask(tenantId, task.id, { status: TaskStatus.WAITING_DEPENDENCY });
          return {
            task: updated,
            status: TaskStatus.WAITING_DEPENDENCY,
          };
        }
      }
    }

    // 2. Risk & Autonomy Policy Check (Approval Required Check)
    const policy = autonomyPolicyService.getPolicy(tenantId, task.agent_type);
    const isEmergencyStopped = policy.is_emergency_stopped || false;
    if (isEmergencyStopped || !policy.enabled) {
      const err = isEmergencyStopped
        ? `Execution halted: Emergency Kill Switch active for agent ${task.agent_type}`
        : `Execution halted: Agent policy is disabled for ${task.agent_type}`;
      db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, error: err });
      return { task: { ...task, status: TaskStatus.FAILED, error: err }, status: TaskStatus.FAILED, error: err };
    }

    // If task risk requires approval and approval hasn't already been granted
    const requiresApproval = autonomyPolicyService.requiresApproval(tenantId, task.agent_type, task.risk_level);

    if (requiresApproval && !task.approval_id) {
      workflowStateMachine.assertTaskTransition(task.status, TaskStatus.WAITING_APPROVAL);

      const approvalId = `appr_${randomUUID().substring(0, 8)}`;
      const orderId = (task.input.order_id as string | undefined) ||
        (task.input.target_entity_type === "ORDER" ? task.input.target_entity_id as string | undefined : undefined);
      const targetState = orderId ? captureApprovalTargetState(tenantId, "ORDER", orderId) : undefined;
      if (!orderId || !targetState) {
        const error = "Approval cannot be created without a verifiable authoritative order target.";
        const updated = db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, failure_class: "PERMANENT", error });
        return { task: updated, status: TaskStatus.FAILED, error };
      }
      const workflow = db.getWorkflowById(tenantId, task.workflow_id);
      const approvalReq: ApprovalRequest = {
        id: approvalId,
        tenant_id: tenantId,
        workflow_id: task.workflow_id,
        task_id: task.id,
        requested_by_agent: task.agent_type,
        action: task.task_type,
        risk_level: task.risk_level,
        target_entity_type: "ORDER",
        target_entity_id: orderId,
        entity_state_snapshot: targetState,
        payload: task.input,
        requester_id: workflow?.created_by_type === "USER" ? workflow.created_by : undefined,
        payload_digest: approvalPayloadDigest(tenantId, task),
        entity_state_digest: approvalDigest(targetState),
        policy_version: policy.version,
        reason: `High risk action requires explicit operational approval: ${task.objective}`,
        status: ApprovalStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date().toISOString(),
      };

      const updated = await db.unit(async () => {
        const latest = db.getTaskById(tenantId, task.id);
        if (!latest || latest.status !== task.status) throw new AppError("CONFLICT", "Task changed while approval was being requested.", 409);
        db.insertApprovalRequest(approvalReq);
        return db.updateTask(tenantId, task.id, { status: TaskStatus.WAITING_APPROVAL, approval_id: approvalId });
      }, () => true);

      return {
        task: updated,
        status: TaskStatus.WAITING_APPROVAL,
        approvalRequired: true,
        approvalId,
      };
    }

    if (requiresApproval || task.approval_id) {
      const approval = task.approval_id ? db.getApprovalRequestById(tenantId, task.approval_id) : undefined;
      const mismatch = approval && approval.task_id === task.id && approval.workflow_id === task.workflow_id
        ? approvalBindingMismatch(approval, task, policy.version)
        : "An approved request bound to this task is required.";
      if (!approval || approval.status !== ApprovalStatus.APPROVED || Date.parse(approval.expires_at) <= Date.now() || mismatch ||
          (approval.requester_id && approval.requester_id === approval.approved_by)) {
        const error = mismatch || "The approval is missing, expired, or violates requester/approver separation.";
        const updated = db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, failure_class: "POLICY_DENIED", error });
        return { task: updated, status: TaskStatus.FAILED, error };
      }
    }

    const startMs = Date.now();
    const workflowBeforeExecution = db.getWorkflowById(tenantId, task.workflow_id);
    const configuredDeadline = task.deadline ? Date.parse(task.deadline) : Number.NaN;
    if (task.deadline && !Number.isFinite(configuredDeadline)) {
      const error = "Task deadline is invalid.";
      const updated = db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, error });
      return { task: updated, status: TaskStatus.FAILED, error };
    }
    const taskTimeoutAt = startMs + Math.max(1, task.timeout_ms || 30_000);
    const workflowDeadlineAt = workflowBeforeExecution?.deadline_at ? Date.parse(workflowBeforeExecution.deadline_at) : Number.POSITIVE_INFINITY;
    const deadlineAt = Math.min(
      Number.isFinite(configuredDeadline) ? configuredDeadline : taskTimeoutAt,
      taskTimeoutAt,
      Number.isFinite(workflowDeadlineAt) ? workflowDeadlineAt : Number.POSITIVE_INFINITY,
    );
    const deadline = new Date(deadlineAt).toISOString();
    if (deadlineAt <= startMs) {
      const error = "Task deadline expired before execution.";
      const updated = db.updateTask(tenantId, task.id, { status: TaskStatus.EXPIRED, deadline, completed_at: new Date().toISOString(), error });
      return { task: updated, status: TaskStatus.EXPIRED, error };
    }

    if (workflowBeforeExecution?.status === "CANCELLED") {
      db.updateTask(tenantId, task.id, { status: TaskStatus.CANCELLED, completed_at: new Date().toISOString() });
      return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.CANCELLED };
    }
    if (workflowBeforeExecution?.status === "PAUSED") {
      db.updateTask(tenantId, task.id, { status: TaskStatus.PAUSED });
      return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.PAUSED };
    }
    if (cancellationSignal?.aborted) throw new AppError("CONFLICT", "Workflow worker lease was cancelled or lost.", 409);

    try {
      this.executionContextFor(task);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        const error = err.message;
        const updated = db.updateTask(tenantId, task.id, {
          status: TaskStatus.FAILED,
          failure_class: "POLICY_DENIED",
          error,
          completed_at: new Date().toISOString(),
        });
        return { task: updated, status: TaskStatus.FAILED, error };
      }
      throw err;
    }

    let budgetReservationId: string | undefined;
    if (workflowBeforeExecution) {
      try {
        const reservation = await workflowBudgetService.reserveTask(tenantId, task.workflow_id, task.id, deadline);
        budgetReservationId = reservation.reservationId;
      } catch (err) {
        const currentWorkflow = db.getWorkflowById(tenantId, task.workflow_id);
        const currentTask = db.getTaskById(tenantId, task.id);
        if (currentWorkflow?.status === "CANCELLED") {
          db.updateTask(tenantId, task.id, { status: TaskStatus.CANCELLED, completed_at: new Date().toISOString() });
          return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.CANCELLED };
        }
        if (currentWorkflow?.status === "PAUSED") {
          db.updateTask(tenantId, task.id, { status: TaskStatus.PAUSED });
          return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.PAUSED };
        }
        if (isAppError(err) && err.code === "CONFLICT") {
          if (currentTask?.status === TaskStatus.RUNNING) return { task: currentTask, status: TaskStatus.RUNNING };
        }
        const error = isAppError(err) && err.code === "WORKFLOW_BUDGET_EXCEEDED"
          ? "WORKFLOW_BUDGET_EXCEEDED"
          : "WORKFLOW_BUDGET_RESERVATION_FAILED";
        db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, error, completed_at: new Date().toISOString() });
        return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.FAILED, error };
      }
    }

    // 3. Mark Task as RUNNING
    if (!workflowBeforeExecution) {
      workflowStateMachine.assertTaskTransition(task.status, TaskStatus.RUNNING);
      db.updateTask(tenantId, task.id, {
        status: TaskStatus.RUNNING,
        started_at: new Date().toISOString(),
        deadline,
        attempt_count: task.attempt_count + 1,
      });
    }

    // Emitting message
    const msgId = `msg_${randomUUID().substring(0, 8)}`;
    db.insertAgentMessage({
      id: msgId,
      tenant_id: tenantId,
      workflow_id: task.workflow_id,
      task_id: task.id,
      sender_agent: "SUPERVISOR",
      recipient_agent: task.agent_type,
      message_type: AgentMessageType.TASK_REQUEST,
      payload: task.input,
      correlation_id: task.id,
      created_at: new Date().toISOString(),
    });

    try {
      // 4. Execute Domain Agent Logic
      const noCancelSignal = new AbortController().signal;
      const signal = cancellationSignal || noCancelSignal;
      if (budgetReservationId) {
        await workflowBudgetService.consumeTaskUsage(tenantId, task.workflow_id, task.id, budgetReservationId, { toolCalls: 1 });
        this.assertStillActive(task, signal, deadlineAt);
      }
      const output = await awaitWithSignal(this.dispatchAgentAction(task, contextEntities, signal), signal, deadlineAt);
      this.assertStillActive(task, signal, deadlineAt);

      // 5. Verification Gate (Physical verification against DB records)
      if (task.task_type.includes("ORDER") || task.task_type.includes("INVENTORY") || task.task_type.includes("PAYMENT")) {
        const verAssertion = `Validate output integrity for task ${task.id}`;
        const verResult = await awaitWithSignal(verifierAgent.verify({
          tenantId,
          workflowId: task.workflow_id,
          taskId: task.id,
          claimedOutput: output,
          targetAssertion: verAssertion,
        }), signal, deadlineAt);
        this.assertStillActive(task, signal, deadlineAt);

        if (verResult.status === "FAILED") {
          throw new Error(`Verifier rejected agent output: ${verResult.failure_reason}`);
        }
      }

      if (budgetReservationId) {
        await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        budgetReservationId = undefined;
        this.assertStillActive(task, signal, deadlineAt);
      }

      // 6. Generate ActionReceipt
      const receiptId = `rcpt_${randomUUID().substring(0, 8)}`;
      const receipt: ActionReceipt = {
        id: receiptId,
        tenant_id: tenantId,
        workflow_id: task.workflow_id,
        task_id: task.id,
        action: task.task_type,
        actor_agent: task.agent_type,
        target_entity: (task.input.target_entity as string) || "DOMAIN_OBJECT",
        target_id: (task.input.target_id as string) || task.id,
        status: "SUCCESS",
        idempotency_key: task.idempotency_key,
        result: output,
        created_at: new Date().toISOString(),
      };
      db.insertActionReceipt(receipt);

      // 7. Complete Task
      workflowStateMachine.assertTaskTransition(TaskStatus.RUNNING, TaskStatus.COMPLETED);
      const completedTask = db.updateTask(tenantId, task.id, {
        status: TaskStatus.COMPLETED,
        output,
        completed_at: new Date().toISOString(),
      });

      // Emitting result message
      db.insertAgentMessage({
        id: `msg_${randomUUID().substring(0, 8)}`,
        tenant_id: tenantId,
        workflow_id: task.workflow_id,
        task_id: task.id,
        sender_agent: task.agent_type,
        recipient_agent: "SUPERVISOR",
        message_type: AgentMessageType.TASK_RESULT,
        payload: output,
        correlation_id: task.id,
        created_at: new Date().toISOString(),
      });

      return {
        task: completedTask,
        status: TaskStatus.COMPLETED,
        output,
        receipt,
      };
    } catch (err: any) {
      const latestWorkflow = db.getWorkflowById(tenantId, task.workflow_id);
      const latestTask = db.getTaskById(tenantId, task.id);
      if (latestWorkflow?.status === "CANCELLED" || latestTask?.status === TaskStatus.CANCELLED) {
        if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        if (latestTask && latestTask.status !== TaskStatus.CANCELLED) {
          db.updateTask(tenantId, task.id, { status: TaskStatus.CANCELLED, completed_at: new Date().toISOString() });
        }
        return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.CANCELLED };
      }
      if (latestWorkflow?.status === "PAUSED") {
        if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        if (latestTask?.status === TaskStatus.RUNNING) db.updateTask(tenantId, task.id, { status: TaskStatus.PAUSED });
        return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.PAUSED };
      }
      if (cancellationSignal?.aborted) {
        // A worker whose lease was fenced must not mutate task state after ownership is lost.
        throw new AppError("CONFLICT", "Workflow worker lease was cancelled or lost.", 409);
      }
      if (isAppError(err) && err.code === "WORKFLOW_BUDGET_EXCEEDED") {
        if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        const error = "WORKFLOW_BUDGET_EXCEEDED";
        workflowStateMachine.assertTaskTransition(TaskStatus.RUNNING, TaskStatus.FAILED);
        db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, completed_at: new Date().toISOString(), error });
        return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.FAILED, error };
      }
      const failureClass = classifyFailure(err);
      if (failureClass === "OUTCOME_UNKNOWN") {
        if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        const errorMessage = "External action may have completed; automatic retry stopped pending reconciliation.";
        const updated = db.updateTask(tenantId, task.id, {
          status: TaskStatus.OUTCOME_UNKNOWN,
          failure_class: "OUTCOME_UNKNOWN",
          error: errorMessage,
          completed_at: new Date().toISOString(),
          metadata: { ...latestTask?.metadata, outcome_unknown_at: new Date().toISOString(), outcome_error: String(err?.message || "unknown") },
        });
        return { task: updated, status: TaskStatus.OUTCOME_UNKNOWN, error: errorMessage };
      }
      if (err instanceof TaskDeadlineExceeded || Date.now() >= deadlineAt) {
        if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
        const errorMessage = "Task deadline exceeded.";
        if (latestTask?.status === TaskStatus.RUNNING) {
          db.updateTask(tenantId, task.id, { status: TaskStatus.EXPIRED, completed_at: new Date().toISOString(), error: errorMessage });
        }
        return { task: db.getTaskById(tenantId, task.id) || task, status: TaskStatus.EXPIRED, error: errorMessage };
      }
      const errorMessage = err?.message || "Execution error encountered";
      if (budgetReservationId) await workflowBudgetService.settleTask(tenantId, task.workflow_id, task.id, budgetReservationId);
      
      // Retry only transient failures, after bounded exponential backoff. Stable task idempotency key is retained.
      const mayRetry = (failureClass === "RETRYABLE" || failureClass === "RATE_LIMITED") && task.attempt_count + 1 < task.max_attempts;
      const nextAttemptAt = mayRetry
        ? new Date(Date.now() + retryDelayMs(task.attempt_count + 1, task.id)).toISOString()
        : undefined;
      if (mayRetry) {
        db.updateTask(tenantId, task.id, {
          status: TaskStatus.RETRY_WAIT,
          failure_class: failureClass,
          next_attempt_at: nextAttemptAt,
          error: `Attempt ${task.attempt_count + 1} failed: ${errorMessage}`,
        });
      } else {
        workflowStateMachine.assertTaskTransition(TaskStatus.RUNNING, TaskStatus.FAILED);
        db.updateTask(tenantId, task.id, {
          status: TaskStatus.FAILED,
          failure_class: failureClass,
          next_attempt_at: undefined,
          error: errorMessage,
        });
      }

      // Emitting error message
      db.insertAgentMessage({
        id: `msg_${randomUUID().substring(0, 8)}`,
        tenant_id: tenantId,
        workflow_id: task.workflow_id,
        task_id: task.id,
        sender_agent: task.agent_type,
        recipient_agent: "SUPERVISOR",
        message_type: AgentMessageType.TASK_ERROR,
        payload: { error: errorMessage },
        correlation_id: task.id,
        created_at: new Date().toISOString(),
      });

      return {
        task: db.getTaskById(tenantId, task.id) || task,
        status: mayRetry ? TaskStatus.RETRY_WAIT : TaskStatus.FAILED,
        error: errorMessage,
      };
    }
  }

  private assertStillActive(task: AgentTask, signal: AbortSignal, deadlineAt: number): void {
    const workflow = db.getWorkflowById(task.tenant_id, task.workflow_id);
    const currentTask = db.getTaskById(task.tenant_id, task.id);
    if (signal.aborted || workflow?.status === "CANCELLED" || workflow?.status === "PAUSED" || currentTask?.status === TaskStatus.CANCELLED) {
      throw new Error("Task execution cancelled.");
    }
    if (currentTask?.status === TaskStatus.EXPIRED) throw new TaskDeadlineExceeded();
    if (Date.now() >= deadlineAt) throw new TaskDeadlineExceeded();
  }

  /**
   * The identity a task acts with (FX-19, audit M12). A user-created workflow acts with its creator's CURRENT role in
   * the workspace, so a creator who lost access (or a permission) can't keep acting through a workflow. System and
   * event workflows get read-only access. Tasks used to run as a synthetic OWNER.
   */
  private executionContextFor(task: AgentTask): RequestContext {
    const tenantId = task.tenant_id;
    const tenant = db.findTenantById(tenantId);
    if (!tenant || tenant.status !== "ACTIVE") {
      throw new ForbiddenError("This workspace is not active.");
    }
    const tenantInfo = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
      timezone: tenant.timezone,
      language: tenant.language,
      status: tenant.status,
    };
    const base = {
      requestId: `req_${randomUUID().substring(0, 8)}`,
      traceId: `trc_${randomUUID().substring(0, 8)}`,
      tenant: tenantInfo,
      timestamp: new Date().toISOString(),
    };

    const workflow = db.getWorkflowById(tenantId, task.workflow_id);
    if (workflow?.created_by_type === "USER") {
      const user = db.findUserById(workflow.created_by);
      const membership = user ? db.findMembership(tenantId, user.id) : undefined;
      if (!user || user.status !== "ACTIVE" || !membership || membership.status === "SUSPENDED") {
        throw new ForbiddenError("The workflow's creator no longer has access to this workspace, so it can't run.");
      }
      return {
        ...base,
        user: { id: user.id, email: user.email, name: user.name, status: user.status },
        role: membership.role,
        permissions: RbacService.getPermissionsForRole(membership.role),
      };
    }

    return {
      ...base,
      user: { id: "sys_agent_runner", email: "system@commerceos.io", name: "System Agent", status: "ACTIVE" },
      role: "SERVICE",
      permissions: SYSTEM_WORKFLOW_PERMISSIONS,
    };
  }

  /**
   * Dispatches task to appropriate specialized agent
   */
  private async dispatchAgentAction(
    task: AgentTask,
    contextEntities?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new AppError("CONFLICT", "Workflow execution was cancelled.", 409);
    if (!isWorkflowTaskHandlerRegistered(task.task_type, task.agent_type)) {
      throw new AppError("NOT_IMPLEMENTED", `Workflow task '${task.task_type}' has no reviewed typed handler.`, 501);
    }
    const mockContext = this.executionContextFor(task);

    switch (task.agent_type) {
      case "INVENTORY": {
        const variantId = (task.input.variant_id as string) || (contextEntities?.variant_id as string | undefined);
        if (!variantId) throw new AppError("VALIDATION_ERROR", "Inventory task requires an authoritative variant_id.", 400);
        const stockResult = inventoryAgent.checkStock(mockContext, variantId);
        return {
          variant_id: variantId,
          available_quantity: stockResult.available,
          reserved_quantity: stockResult.reserved,
          low_stock: stockResult.low_stock,
          status: "STOCK_AUDITED",
        };
      }

      case "SHIPPING": {
        if (task.task_type !== "CALCULATE_SHIPPING_ESTIMATE" && task.task_type !== "CALCULATE_ESTIMATE") {
          throw new AppError("NOT_IMPLEMENTED", `Workflow task '${task.task_type}' requires a live shipment-tracking adapter.`, 501);
        }
        const city = (task.input.city as string | undefined) || (contextEntities?.city as string | undefined);
        const weight = (task.input.weight_kg as number | undefined) ?? (contextEntities?.weight_kg as number | undefined);
        if (!city || typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
          throw new AppError("VALIDATION_ERROR", "Shipping estimate requires city and positive weight_kg.", 400);
        }
        const shippingResult = shippingAgent.calculateEstimate(mockContext, city, weight);
        return {
          ...shippingResult,
          status: "SHIPPING_CALCULATED",
        };
      }

      case "PAYMENT": {
        const paymentId = (task.input.payment_id as string | undefined) || (contextEntities?.payment_id as string | undefined);
        if (!paymentId) throw new AppError("VALIDATION_ERROR", "Payment verification requires an authoritative payment_id.", 400);
        const paymentResult = paymentAgent.verifyPayment(mockContext, paymentId);
        return {
          payment_id: paymentId,
          verified: paymentResult?.verified ?? false,
          status: paymentResult?.status ?? "NOT_FOUND",
          amount: paymentResult?.amount ?? null,
        };
      }

      default: {
        throw new AppError("NOT_IMPLEMENTED", `Workflow task '${task.task_type}' has no verified domain handler.`, 501);
      }
    }
  }
}

export const taskExecutor = new TaskExecutor();
