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
import { ROLE_PERMISSIONS } from '@/lib/permissions';

export interface TaskExecutionResult {
  task: AgentTask;
  status: TaskStatus;
  output?: Record<string, unknown>;
  receipt?: ActionReceipt;
  approvalRequired?: boolean;
  approvalId?: string;
  error?: string;
}

export class TaskExecutor {
  /**
   * Executes a single task within a workflow context.
   */
  public async executeTask(
    task: AgentTask,
    contextEntities?: Record<string, unknown>
  ): Promise<TaskExecutionResult> {
    const tenantId = task.tenant_id;

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
    const policy = db.getAutonomyPolicy(tenantId, task.agent_type);
    const isEmergencyStopped = policy?.is_emergency_stopped || false;
    if (isEmergencyStopped) {
      const err = `Execution halted: Emergency Kill Switch active for agent ${task.agent_type}`;
      db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, error: err });
      return { task: { ...task, status: TaskStatus.FAILED, error: err }, status: TaskStatus.FAILED, error: err };
    }

    // If task risk requires approval and approval hasn't already been granted
    const requiresApproval =
      (task.risk_level === ActionRiskLevel.HIGH || task.risk_level === ActionRiskLevel.CRITICAL) &&
      !task.approval_id;

    if (requiresApproval) {
      workflowStateMachine.assertTaskTransition(task.status, TaskStatus.WAITING_APPROVAL);

      const approvalId = `appr_${randomUUID().substring(0, 8)}`;
      const approvalReq: ApprovalRequest = {
        id: approvalId,
        tenant_id: tenantId,
        workflow_id: task.workflow_id,
        task_id: task.id,
        requested_by_agent: task.agent_type,
        action: task.task_type,
        risk_level: task.risk_level,
        target_entity_type: "ORDER",
        target_entity_id: (task.input.order_id as string) || "UNKNOWN",
        entity_state_snapshot: contextEntities || {},
        payload: task.input,
        reason: `High risk action requires explicit operational approval: ${task.objective}`,
        status: ApprovalStatus.PENDING,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date().toISOString(),
      };

      db.insertApprovalRequest(approvalReq);
      const updated = db.updateTask(tenantId, task.id, {
        status: TaskStatus.WAITING_APPROVAL,
        approval_id: approvalId,
      });

      return {
        task: updated,
        status: TaskStatus.WAITING_APPROVAL,
        approvalRequired: true,
        approvalId,
      };
    }

    // 3. Mark Task as RUNNING
    workflowStateMachine.assertTaskTransition(task.status, TaskStatus.RUNNING);
    db.updateTask(tenantId, task.id, {
      status: TaskStatus.RUNNING,
      started_at: new Date().toISOString(),
      attempt_count: task.attempt_count + 1,
    });

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
      const output = await this.dispatchAgentAction(task, contextEntities);

      // 5. Verification Gate (Physical verification against DB records)
      if (task.task_type.includes("ORDER") || task.task_type.includes("INVENTORY") || task.task_type.includes("PAYMENT")) {
        const verAssertion = `Validate output integrity for task ${task.id}`;
        const verResult = await verifierAgent.verify({
          tenantId,
          workflowId: task.workflow_id,
          taskId: task.id,
          claimedOutput: output,
          targetAssertion: verAssertion,
        });

        if (verResult.status === "FAILED") {
          throw new Error(`Verifier rejected agent output: ${verResult.failure_reason}`);
        }
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
      const errorMessage = err?.message || "Execution error encountered";
      
      // Determine retry eligibility
      if (task.attempt_count < task.max_attempts) {
        db.updateTask(tenantId, task.id, {
          status: TaskStatus.PENDING,
          error: `Attempt ${task.attempt_count} failed: ${errorMessage}`,
        });
      } else {
        workflowStateMachine.assertTaskTransition(TaskStatus.RUNNING, TaskStatus.FAILED);
        db.updateTask(tenantId, task.id, {
          status: TaskStatus.FAILED,
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
        status: task.attempt_count < task.max_attempts ? TaskStatus.PENDING : TaskStatus.FAILED,
        error: errorMessage,
      };
    }
  }

  /**
   * Dispatches task to appropriate specialized agent
   */
  private async dispatchAgentAction(
    task: AgentTask,
    contextEntities?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const tenantId = task.tenant_id;
    const mockContext: RequestContext = {
      requestId: `req_${randomUUID().substring(0, 8)}`,
      traceId: `trc_${randomUUID().substring(0, 8)}`,
      tenant: {
        id: tenantId,
        name: "Test Tenant",
        slug: "test-tenant",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        language: "bn-BD",
        status: "ACTIVE",
      },
      user: {
        id: "sys_agent_runner",
        email: "system@commerceos.io",
        name: "System Agent",
        status: "ACTIVE",
      },
      role: "OWNER",
      permissions: ROLE_PERMISSIONS.OWNER,
      timestamp: new Date().toISOString(),
    };

    switch (task.agent_type) {
      case "INVENTORY": {
        const variantId = (task.input.variant_id as string) || "var_demo_1";
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
        const city = (task.input.city as string) || "Dhaka";
        const weight = (task.input.weight_kg as number) || 1.0;
        const shippingResult = shippingAgent.calculateEstimate(mockContext, city, weight);
        return {
          ...shippingResult,
          status: "SHIPPING_CALCULATED",
        };
      }

      case "PAYMENT": {
        const paymentId = (task.input.payment_id as string) || "pay_demo_1";
        const paymentResult = paymentAgent.verifyPayment(mockContext, paymentId);
        return {
          payment_id: paymentId,
          verified: paymentResult?.verified || false,
          status: paymentResult?.status || "NOT_FOUND",
          amount: paymentResult?.amount || 0,
        };
      }

      case "SALES": {
        return {
          action: task.task_type,
          draft_id: `draft_${randomUUID().substring(0, 6)}`,
          copy: "Apnar cart-e offer apply kora hoyeche! Checkout korun ekhoni.",
          discount_code: "SPECIAL10",
          valid_until: new Date(Date.now() + 86400000).toISOString(),
          status: "OFFER_GENERATED",
        };
      }

      case "CUSTOMER_SUPPORT": {
        return {
          customer_id: (task.input.customer_id as string) || "cust_demo_1",
          preference_channel: "WHATSAPP",
          language: "BANGLISH",
          verified: true,
          status: "CUSTOMER_RETRIEVED",
        };
      }

      default: {
        return {
          action: task.task_type,
          processed_at: new Date().toISOString(),
          status: "EXECUTED",
          input_echo: task.input,
        };
      }
    }
  }
}

export const taskExecutor = new TaskExecutor();
