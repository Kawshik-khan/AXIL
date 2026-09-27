import { AgentTriggerRule, WorkflowTriggerType } from '@/types/orchestration';
import { db } from '@/infrastructure/db';
import { workflowEngine } from '../engine/workflow-engine';

export class EventTriggerService {
  /**
   * Processes an incoming domain event and evaluates active trigger rules
   */
  public async handleDomainEvent(event: {
    tenant_id: string;
    type: string;
    payload: Record<string, any>;
  }): Promise<{ triggered: boolean; ruleId?: string; workflowId?: string; reason?: string }> {
    const rules = db.getAgentTriggerRules(event.tenant_id, event.type);
    const enabledRules = rules.filter((r) => r.enabled);

    if (enabledRules.length === 0) {
      return { triggered: false, reason: `No enabled trigger rules for event: ${event.type}` };
    }

    for (const rule of enabledRules) {
      // 1. Check daily quota
      if (rule.runs_today >= rule.max_runs_per_day) {
        continue;
      }

      // 2. Check cooldown
      if (rule.last_triggered_at) {
        const lastTime = new Date(rule.last_triggered_at).getTime();
        const elapsedSec = (Date.now() - lastTime) / 1000;
        if (elapsedSec < rule.cooldown_seconds) {
          continue; // In cooldown
        }
      }

      // 3. Evaluate Conditions
      const conditionsMet = this.evaluateConditions(rule.conditions, event.payload);
      if (!conditionsMet) {
        continue;
      }

      // 4. Trigger Workflow
      const template = db.getWorkflowTemplates(event.tenant_id).find(
        (t) => t.id === rule.target_workflow_template_id || t.code === rule.target_workflow_template_id
      );

      const workflowName = template ? template.name : `Event-Triggered: ${event.type}`;
      const objective = template
        ? template.description
        : `Automatically process event ${event.type} for tenant ${event.tenant_id}`;

      const workflow = await workflowEngine.createWorkflow({
        tenantId: event.tenant_id,
        name: workflowName,
        objective,
        triggerType: WorkflowTriggerType.EVENT,
        triggerSource: event.type,
        triggerPayload: event.payload,
        createdByType: "EVENT",
        contextEntities: event.payload,
      });

      // Update trigger rule stats
      db.updateAgentTriggerRule(rule.tenant_id, rule.id, {
        last_triggered_at: new Date().toISOString(),
        runs_today: rule.runs_today + 1,
      });

      // Start workflow execution asynchronously
      workflowEngine.startWorkflow(workflow.tenant_id, workflow.id).catch((err) => {
        console.error(`Error starting triggered workflow ${workflow.id}:`, err);
      });

      return {
        triggered: true,
        ruleId: rule.id,
        workflowId: workflow.id,
      };
    }

    return { triggered: false, reason: "No matching rules satisfied event conditions or quotas" };
  }

  private evaluateConditions(
    conditions: AgentTriggerRule['conditions'],
    payload: Record<string, any>
  ): boolean {
    if (!conditions || conditions.length === 0) return true;

    for (const cond of conditions) {
      const actualValue = payload[cond.field];

      switch (cond.operator) {
        case "EQUALS":
          if (actualValue !== cond.value) return false;
          break;
        case "NOT_EQUALS":
          if (actualValue === cond.value) return false;
          break;
        case "GREATER_THAN":
          if (Number(actualValue) <= Number(cond.value)) return false;
          break;
        case "LESS_THAN":
          if (Number(actualValue) >= Number(cond.value)) return false;
          break;
        case "CONTAINS":
          if (!String(actualValue).toLowerCase().includes(String(cond.value).toLowerCase())) {
            return false;
          }
          break;
        default:
          return false;
      }
    }

    return true;
  }
}

export const eventTriggerService = new EventTriggerService();
