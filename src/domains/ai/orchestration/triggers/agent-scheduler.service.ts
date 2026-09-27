import { randomUUID } from 'crypto';
import { AgentSchedule, WorkflowTriggerType } from '@/types/orchestration';
import { AgentType } from '@/types/ai';
import { db } from '@/infrastructure/db';
import { workflowEngine } from '../engine/workflow-engine';

export class AgentSchedulerService {
  /**
   * Evaluates and triggers due agent schedules for a tenant or system-wide
   */
  public async evaluateDueSchedules(tenantId: string): Promise<string[]> {
    const schedules = db.getAgentSchedules(tenantId);
    const now = new Date();
    const triggeredIds: string[] = [];

    for (const schedule of schedules) {
      if (!schedule.is_active) continue;

      const nextRun = new Date(schedule.next_run_at);
      if (now >= nextRun) {
        // Trigger scheduled workflow
        const template = db.getWorkflowTemplates(tenantId).find(
          (t) => t.id === schedule.workflow_template_id || t.code === schedule.workflow_template_id
        );

        const workflow = await workflowEngine.createWorkflow({
          tenantId,
          name: `Scheduled: ${schedule.name}`,
          objective: schedule.description || `Autonomous scheduled run for ${schedule.name}`,
          triggerType: WorkflowTriggerType.SCHEDULE,
          triggerSource: schedule.id,
          triggerPayload: schedule.payload,
          createdByType: "SYSTEM",
          contextEntities: schedule.payload,
        });

        // Compute next run: default next 24 hours
        const nextDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        db.updateAgentSchedule(schedule.id, {
          last_run_at: now.toISOString(),
          next_run_at: nextDate,
        });

        workflowEngine.startWorkflow(workflow.id).catch((err) => {
          console.error(`Error starting scheduled workflow ${workflow.id}:`, err);
        });

        triggeredIds.push(schedule.id);
      }
    }

    return triggeredIds;
  }

  /**
   * Registers a new schedule
   */
  public createSchedule(params: {
    tenantId: string;
    name: string;
    description: string;
    workflowTemplateId: string;
    cronExpression: string;
    targetAgent: AgentType;
    payload?: Record<string, unknown>;
  }): AgentSchedule {
    const schedule: AgentSchedule = {
      id: `sched_${randomUUID().substring(0, 8)}`,
      tenant_id: params.tenantId,
      name: params.name,
      description: params.description,
      workflow_template_id: params.workflowTemplateId,
      cron_expression: params.cronExpression,
      target_agent: params.targetAgent,
      payload: params.payload,
      timezone: "Asia/Dhaka",
      is_active: true,
      next_run_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.insertAgentSchedule(schedule);
    return schedule;
  }
}

export const agentSchedulerService = new AgentSchedulerService();
