import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { AgentTask, TaskBudget, WorkflowBudget, WorkflowTaskBudgetReservation } from "@/types/orchestration";

export interface WorkflowTaskUsage {
  tokens?: number;
  costUsd?: number;
  toolCalls?: number;
}

/** Durable workflow/task budget holds, scoped by the tenant and serialized by the store unit of work. */
export class WorkflowBudgetService {
  /** Recover expired task holds after a worker crash without releasing already-consumed usage. */
  public async reconcileExpiredReservations(tenantId: string, workflowId: string): Promise<number> {
    return db.unit(async () => {
      const workflow = db.getWorkflowById(tenantId, workflowId);
      if (!workflow) return 0;
      const reservations = { ...(workflow.budget.reservations || {}) };
      let usedTokens = workflow.budget.used_tokens;
      let usedCost = workflow.budget.used_cost_usd;
      let usedToolCalls = workflow.budget.used_tool_calls;
      let recovered = 0;
      for (const [taskId, hold] of Object.entries(reservations)) {
        if (Date.parse(hold.expires_at) > Date.now()) continue;
        assertValidReservation(hold);
        const task = db.getTaskById(tenantId, taskId);
        usedTokens += hold.used_tokens;
        usedCost = roundCost(usedCost + hold.used_cost_usd);
        usedToolCalls += hold.used_tool_calls;
        if (task) {
          const taskBudget = normalizeTaskBudget(task.budget);
          taskBudget.used_tokens += hold.used_tokens;
          taskBudget.used_cost_usd = roundCost(taskBudget.used_cost_usd + hold.used_cost_usd);
          taskBudget.used_tool_calls += hold.used_tool_calls;
          if (task.status === "RUNNING" || task.status === "PENDING" || task.status === "READY") {
            db.updateTask(tenantId, task.id, {
              status: "EXPIRED",
              completed_at: new Date().toISOString(),
              error: "Task budget reservation expired; the previous worker did not settle execution.",
              budget: taskBudget,
            });
          } else {
            db.updateTask(tenantId, task.id, { budget: taskBudget });
          }
        }
        delete reservations[taskId];
        recovered++;
      }
      if (recovered) {
        db.updateWorkflow(tenantId, workflowId, { budget: {
          ...workflow.budget,
          used_tokens: usedTokens,
          used_cost_usd: usedCost,
          used_tool_calls: usedToolCalls,
          reservations,
        } });
      }
      return recovered;
    }, () => true);
  }

  public async reserveTask(tenantId: string, workflowId: string, taskId: string, expiresAt: string): Promise<{ reservationId: string }> {
    return db.unit(async () => {
      const workflow = db.getWorkflowById(tenantId, workflowId);
      const task = db.getTaskById(tenantId, taskId);
      if (!workflow || !task || task.workflow_id !== workflowId) throw new AppError("NOT_FOUND", "Workflow task was not found.", 404);
      if (workflow.status !== "RUNNING" || !["PENDING", "READY"].some((status) => status === task.status)) {
        throw new AppError("CONFLICT", "Only a ready task in a running workflow can reserve budget.", 409);
      }
      if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
        throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Workflow or task deadline has expired.", 429);
      }
      const reservations = { ...(workflow.budget.reservations || {}) };
      // Expired holds stay accounted until the owning task settles or an operator reconciles it.
      // Dropping a hold based on time alone could let a crashed worker's already-consumed usage escape the cap.
      if (reservations[taskId]) {
        throw new AppError("CONFLICT", "This task already has an active budget reservation.", 409);
      }
      const active = Object.values(reservations);
      const taskBudget = normalizeTaskBudget(task.budget || defaultTaskBudget(workflow.budget, workflow.tasks.length, workflow.tasks.indexOf(taskId)));
      assertValidWorkflowBudget(workflow.budget);
      for (const hold of Object.values(reservations)) assertValidReservation(hold);
      const remaining = {
        tokens: Math.max(0, taskBudget.max_tokens - taskBudget.used_tokens),
        cost_usd: Math.max(0, taskBudget.max_cost_usd - taskBudget.used_cost_usd),
        tool_calls: Math.max(0, taskBudget.max_tool_calls - taskBudget.used_tool_calls),
      };
      const reserved = {
        tokens: active.reduce((sum, hold) => sum + hold.tokens, 0),
        cost_usd: active.reduce((sum, hold) => sum + hold.cost_usd, 0),
        tool_calls: active.reduce((sum, hold) => sum + hold.tool_calls, 0),
      };
      const budget = workflow.budget;
      if (
        budget.used_tokens + reserved.tokens + remaining.tokens > budget.max_tokens ||
        budget.used_cost_usd + reserved.cost_usd + remaining.cost_usd > budget.max_cost_usd + 1e-9 ||
        budget.used_tool_calls + reserved.tool_calls + remaining.tool_calls > budget.max_tool_calls
      ) {
        throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Workflow or task budget does not have enough capacity for this task.", 429);
      }
      if (remaining.tool_calls < 1) {
        throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Task tool-call budget is exhausted.", 429);
      }
      const reservationId = randomUUID();
      const hold: WorkflowTaskBudgetReservation = {
        reservation_id: reservationId,
        task_id: taskId,
        tokens: remaining.tokens,
        cost_usd: remaining.cost_usd,
        tool_calls: remaining.tool_calls,
        used_tokens: 0,
        used_cost_usd: 0,
        used_tool_calls: 0,
        expires_at: expiresAt,
      };
      reservations[taskId] = hold;
      db.updateWorkflow(tenantId, workflowId, { budget: { ...budget, reservations } });
      db.updateTask(tenantId, taskId, {
        budget: taskBudget,
        status: "RUNNING",
        started_at: new Date().toISOString(),
        deadline: expiresAt,
        attempt_count: task.attempt_count + 1,
      });
      return { reservationId };
    }, () => true);
  }

  /** Call immediately before each provider, tool, or side-effect boundary. */
  public async consumeTaskUsage(
    tenantId: string,
    workflowId: string,
    taskId: string,
    reservationId: string,
    usage: WorkflowTaskUsage,
  ): Promise<void> {
    const delta = normalizeUsage(usage);
    await db.unit(async () => {
      const workflow = db.getWorkflowById(tenantId, workflowId);
      const task = db.getTaskById(tenantId, taskId);
      const hold = workflow?.budget.reservations?.[taskId];
      if (!workflow || !task || task.workflow_id !== workflowId || workflow.status !== "RUNNING" || !hold || hold.reservation_id !== reservationId) {
        throw new AppError("CONFLICT", "Workflow budget reservation is no longer valid.", 409);
      }
      if (Date.parse(hold.expires_at) <= Date.now()) {
        throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Workflow task budget reservation expired.", 429);
      }
      if (
        hold.used_tokens + delta.tokens > hold.tokens ||
        hold.used_cost_usd + delta.cost_usd > hold.cost_usd + 1e-9 ||
        hold.used_tool_calls + delta.tool_calls > hold.tool_calls
      ) {
        throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Task budget would be exceeded by this provider or tool call.", 429);
      }
      const reservations = { ...workflow.budget.reservations, [taskId]: {
        ...hold,
        used_tokens: hold.used_tokens + delta.tokens,
        used_cost_usd: roundCost(hold.used_cost_usd + delta.cost_usd),
        used_tool_calls: hold.used_tool_calls + delta.tool_calls,
      } };
      db.updateWorkflow(tenantId, workflowId, { budget: { ...workflow.budget, reservations } });
    }, () => true);
  }

  /** Settle consumed usage and release the unused part of the hold in one transaction. */
  public async settleTask(tenantId: string, workflowId: string, taskId: string, reservationId: string): Promise<void> {
    await db.unit(async () => {
      const workflow = db.getWorkflowById(tenantId, workflowId);
      const task = db.getTaskById(tenantId, taskId);
      const hold = workflow?.budget.reservations?.[taskId];
      if (!workflow || !task || task.workflow_id !== workflowId || !hold || hold.reservation_id !== reservationId) return;
      const reservations = { ...workflow.budget.reservations };
      delete reservations[taskId];
      const nextTaskBudget = normalizeTaskBudget(task.budget);
      nextTaskBudget.used_tokens += hold.used_tokens;
      nextTaskBudget.used_cost_usd = roundCost(nextTaskBudget.used_cost_usd + hold.used_cost_usd);
      nextTaskBudget.used_tool_calls += hold.used_tool_calls;
      db.updateTask(tenantId, taskId, { budget: nextTaskBudget });
      db.updateWorkflow(tenantId, workflowId, { budget: {
        ...workflow.budget,
        used_tokens: workflow.budget.used_tokens + hold.used_tokens,
        used_cost_usd: roundCost(workflow.budget.used_cost_usd + hold.used_cost_usd),
        used_tool_calls: workflow.budget.used_tool_calls + hold.used_tool_calls,
        reservations,
      } });
    }, () => true);
  }
}

export const workflowBudgetService = new WorkflowBudgetService();

function normalizeTaskBudget(budget?: TaskBudget): TaskBudget {
  const safe = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value as number) : 0;
  return {
    max_tokens: safe(budget?.max_tokens),
    max_cost_usd: safe(budget?.max_cost_usd),
    max_tool_calls: safe(budget?.max_tool_calls),
    used_tokens: safe(budget?.used_tokens),
    used_cost_usd: safe(budget?.used_cost_usd),
    used_tool_calls: safe(budget?.used_tool_calls),
  };
}

function assertValidWorkflowBudget(budget: WorkflowBudget): void {
  const values = [budget.max_tokens, budget.max_cost_usd, budget.max_tool_calls, budget.used_tokens, budget.used_cost_usd, budget.used_tool_calls];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Workflow budget state is invalid; execution is blocked.", 429);
  }
}

function assertValidReservation(hold: WorkflowTaskBudgetReservation): void {
  const values = [hold.tokens, hold.cost_usd, hold.tool_calls, hold.used_tokens, hold.used_cost_usd, hold.used_tool_calls];
  if (values.some((value) => !Number.isFinite(value) || value < 0) || !Number.isFinite(Date.parse(hold.expires_at))) {
    throw new AppError("WORKFLOW_BUDGET_EXCEEDED", "Workflow reservation state is invalid; execution is blocked.", 429);
  }
}

function defaultTaskBudget(workflowBudget: WorkflowBudget, count: number, index: number): TaskBudget {
  const safeCount = Math.max(1, count);
  const safeIndex = Math.max(0, index);
  return {
    max_tokens: integerShare(workflowBudget.max_tokens, safeCount, safeIndex),
    max_cost_usd: decimalShare(workflowBudget.max_cost_usd, safeCount, safeIndex),
    max_tool_calls: integerShare(workflowBudget.max_tool_calls, safeCount, safeIndex),
    used_tokens: 0,
    used_cost_usd: 0,
    used_tool_calls: 0,
  };
}

function normalizeUsage(usage: WorkflowTaskUsage) {
  const result = {
    tokens: usage.tokens ?? 0,
    cost_usd: usage.costUsd ?? 0,
    tool_calls: usage.toolCalls ?? 0,
  };
  if (Object.values(result).some((value) => !Number.isFinite(value) || value < 0) ||
      !Number.isInteger(result.tokens) || !Number.isInteger(result.tool_calls)) {
    throw new AppError("VALIDATION_ERROR", "Budget usage must contain finite, non-negative values.", 400);
  }
  return result;
}

function roundCost(value: number): number { return Number(value.toFixed(8)); }
function integerShare(total: number, count: number, index: number): number {
  const base = Math.floor(total / count);
  return base + (index < total % count ? 1 : 0);
}
function decimalShare(total: number, count: number, index: number): number {
  const base = total / count;
  return Number((index === count - 1 ? total - base * index : base).toFixed(8));
}
