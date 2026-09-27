import { WorkflowStatus, TaskStatus } from '@/types/orchestration';

export class WorkflowStateMachine {
  private static readonly ALLOWED_WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
    [WorkflowStatus.DRAFT]: [WorkflowStatus.QUEUED, WorkflowStatus.CANCELLED],
    [WorkflowStatus.QUEUED]: [WorkflowStatus.RUNNING, WorkflowStatus.PAUSED, WorkflowStatus.CANCELLED],
    [WorkflowStatus.RUNNING]: [
      WorkflowStatus.WAITING,
      WorkflowStatus.PAUSED,
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
    ],
    [WorkflowStatus.WAITING]: [
      WorkflowStatus.RUNNING,
      WorkflowStatus.PAUSED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
    ],
    [WorkflowStatus.PAUSED]: [WorkflowStatus.RUNNING, WorkflowStatus.CANCELLED],
    [WorkflowStatus.COMPLETED]: [],
    [WorkflowStatus.FAILED]: [WorkflowStatus.QUEUED, WorkflowStatus.CANCELLED],
    [WorkflowStatus.CANCELLED]: [],
  };

  private static readonly ALLOWED_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PENDING]: [TaskStatus.READY, TaskStatus.RUNNING, TaskStatus.CANCELLED],
    [TaskStatus.READY]: [TaskStatus.RUNNING, TaskStatus.CANCELLED],
    [TaskStatus.RUNNING]: [
      TaskStatus.WAITING_DEPENDENCY,
      TaskStatus.WAITING_APPROVAL,
      TaskStatus.WAITING_HUMAN,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
      TaskStatus.PAUSED,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.WAITING_DEPENDENCY]: [
      TaskStatus.READY,
      TaskStatus.RUNNING,
      TaskStatus.FAILED,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.WAITING_APPROVAL]: [
      TaskStatus.RUNNING,
      TaskStatus.READY,
      TaskStatus.FAILED,
      TaskStatus.CANCELLED,
      TaskStatus.EXPIRED,
    ],
    [TaskStatus.WAITING_HUMAN]: [
      TaskStatus.RUNNING,
      TaskStatus.READY,
      TaskStatus.FAILED,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.PAUSED]: [TaskStatus.RUNNING, TaskStatus.CANCELLED],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [TaskStatus.PENDING, TaskStatus.READY, TaskStatus.CANCELLED],
    [TaskStatus.CANCELLED]: [],
    [TaskStatus.EXPIRED]: [],
  };

  /**
   * Validates if a workflow state transition is permissible
   */
  public canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus): boolean {
    if (from === to) return true;
    const allowed = WorkflowStateMachine.ALLOWED_WORKFLOW_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  public assertWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): void {
    if (!this.canTransitionWorkflow(from, to)) {
      throw new Error(`Invalid workflow transition from ${from} to ${to}`);
    }
  }

  /**
   * Validates if a task state transition is permissible
   */
  public canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true;
    const allowed = WorkflowStateMachine.ALLOWED_TASK_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  public assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
    if (!this.canTransitionTask(from, to)) {
      throw new Error(`Invalid task transition from ${from} to ${to}`);
    }
  }
}

export const workflowStateMachine = new WorkflowStateMachine();
