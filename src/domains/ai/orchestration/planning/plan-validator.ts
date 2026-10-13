import { ActionRiskLevel } from '@/types/orchestration';
import { agentRegistry } from '../agent-registry';
import { AgentType } from '@/types/ai';

const TASK_AGENT_CONTRACT: Readonly<Record<string, AgentType>> = Object.freeze({
  IDENTIFY_ABANDONED_CARTS: "ORDER_ASSISTANT", RETRIEVE_CUSTOMER_CONTEXT: "CUSTOMER_SUPPORT",
  CHECK_PRODUCT_AVAILABILITY: "INVENTORY", GENERATE_PERSONALIZED_MESSAGE: "SALES",
  OUTBOUND_MESSAGE_APPROVAL: "SUPERVISOR", AUDIT_WAREHOUSE_STOCK: "INVENTORY",
  CALCULATE_SALES_VELOCITY: "SALES", PREPARE_REORDER_PROPOSAL: "ORDER_ASSISTANT",
  TRACK_PARCEL_STATUS: "SHIPPING", NOTIFY_CUSTOMER_EMPATHY: "CUSTOMER_SUPPORT",
  VERIFY_PAYMENT_TRX: "PAYMENT", INSPECT_ORDER_RETURN_STATE: "ORDER_ASSISTANT",
  APPROVAL_REFUND_DISBURSEMENT: "SUPERVISOR", VALIDATE_PRODUCT_SPEC: "SALES",
  AUDIT_BULK_STOCK: "INVENTORY", CALCULATE_BULK_SHIPPING: "SHIPPING",
  FORMULATE_WHOLESALE_QUOTE: "SALES",
});
const RISK_LEVELS = new Set<ActionRiskLevel>(Object.values(ActionRiskLevel));
const FORBIDDEN_PARAMETER_KEYS = new Set(["tenant_id", "tenantid", "workflow_id", "workflowid", "agent_id", "agent_type", "permissions", "required_tools", "dependencies", "risk_level"]);

function containsForbiddenParameter(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenParameter);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    FORBIDDEN_PARAMETER_KEYS.has(key.toLowerCase()) || containsForbiddenParameter(child));
}

export interface PlanStepDefinition {
  id: string;
  task_type?: string;
  name: string;
  objective?: string;
  agent_type: AgentType | string;
  action: string;
  dependencies: string[];
  parameters?: Record<string, any>;
  risk_level?: ActionRiskLevel;
  timeout_seconds?: number;
  required_tools?: string[];
}

export interface PlanValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  riskLevel: ActionRiskLevel;
  requiresApproval: boolean;
  executionOrder: string[][]; // Topological batches for parallel execution
}

export class PlanValidator {
  private readonly MAX_TASKS = 25;
  private readonly MAX_DEPTH = 10;

  /**
   * Validates a workflow plan DAG structure, agent permissions, and safety risks.
   */
  public validate(steps: PlanStepDefinition[]): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let highestRisk: ActionRiskLevel = ActionRiskLevel.LOW;
    let requiresApproval = false;

    if (!steps || steps.length === 0) {
      return {
        isValid: false,
        errors: ['Plan must contain at least one step'],
        warnings: [],
        riskLevel: ActionRiskLevel.LOW,
        requiresApproval: false,
        executionOrder: [],
      };
    }

    if (steps.length > this.MAX_TASKS) {
      errors.push(`Plan exceeds maximum task limit of ${this.MAX_TASKS} (found ${steps.length})`);
    }

    const stepMap = new Map<string, PlanStepDefinition>();
    const stepIds = new Set<string>();

    for (const step of steps) {
      if (!step.id) {
        errors.push('All steps must have an "id" field');
        continue;
      }
      if (stepIds.has(step.id)) {
        errors.push(`Duplicate step ID detected: "${step.id}"`);
      }
      stepIds.add(step.id);
      stepMap.set(step.id, step);

      const taskType = step.task_type || step.action;
      if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(taskType || "")) {
        errors.push(`Step "${step.id}" has an invalid task type.`);
      } else if (!TASK_AGENT_CONTRACT[taskType]) {
        errors.push(`Step "${step.id}" uses an unregistered task type "${taskType}".`);
      } else if (TASK_AGENT_CONTRACT[taskType] !== step.agent_type) {
        errors.push(`Step "${step.id}" assigns task type "${taskType}" to the wrong agent.`);
      }
      if (!step.name || step.name.length > 240 || (step.objective && step.objective.length > 1000)) {
        errors.push(`Step "${step.id}" must have a bounded name and objective.`);
      }
      if (!Array.isArray(step.dependencies) || new Set(step.dependencies).size !== step.dependencies.length) {
        errors.push(`Step "${step.id}" has invalid or duplicate dependencies.`);
      }
      const parameters = step.parameters ?? {};
      if (!parameters || Array.isArray(parameters) || typeof parameters !== "object" || Object.keys(parameters).length > 40 || containsForbiddenParameter(parameters)) {
        errors.push(`Step "${step.id}" has invalid or untrusted execution parameters.`);
      }
      if (step.risk_level && !RISK_LEVELS.has(step.risk_level)) {
        errors.push(`Step "${step.id}" has an invalid risk level.`);
      }

      // Verify agent registered
      const agentProfile = agentRegistry.getAgent(step.agent_type as AgentType);
      if (!agentProfile) {
        errors.push(`Step "${step.id}" references unknown or unpermitted agent: "${step.agent_type}"`);
      } else if (!agentProfile.enabled) {
        errors.push(`Step "${step.id}" references disabled agent: "${step.agent_type}"`);
      } else {
        for (const tool of step.required_tools || []) {
          if (!agentProfile.allowed_tools.includes(tool)) {
            errors.push(`Step "${step.id}" requests tool "${tool}" outside agent "${step.agent_type}" capabilities.`);
          }
        }
      }

      // Check risk levels
      const risk = step.risk_level || ActionRiskLevel.LOW;
      if (this.compareRisk(risk, highestRisk) > 0) {
        highestRisk = risk;
      }
      if (risk === ActionRiskLevel.HIGH || risk === ActionRiskLevel.CRITICAL) {
        requiresApproval = true;
      }
    }

    // Validate dependency references
    for (const step of steps) {
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          if (!stepIds.has(depId)) {
            errors.push(`Step "${step.id}" depends on non-existent step "${depId}"`);
          }
          if (depId === step.id) {
            errors.push(`Step "${step.id}" cannot depend on itself`);
          }
        }
      }
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        errors,
        warnings,
        riskLevel: highestRisk,
        requiresApproval,
        executionOrder: [],
      };
    }

    // Topological Sort & Cycle Detection using Kahn's algorithm
    const { executionOrder, hasCycle, maxDepth } = this.topologicalSort(steps);

    if (hasCycle) {
      errors.push('Cycle detected in workflow plan dependencies. Plan must form a Directed Acyclic Graph (DAG).');
    }

    if (maxDepth > this.MAX_DEPTH) {
      errors.push(`Plan dependency depth (${maxDepth}) exceeds maximum allowed depth of ${this.MAX_DEPTH}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      riskLevel: highestRisk,
      requiresApproval,
      executionOrder: hasCycle ? [] : executionOrder,
    };
  }

  /**
   * Kahn's algorithm with parallel batch levels
   */
  private topologicalSort(steps: PlanStepDefinition[]): {
    executionOrder: string[][];
    hasCycle: boolean;
    maxDepth: number;
  } {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const step of steps) {
      inDegree.set(step.id, 0);
      adj.set(step.id, []);
    }

    for (const step of steps) {
      const deps = step.dependencies || [];
      inDegree.set(step.id, deps.length);
      for (const dep of deps) {
        adj.get(dep)?.push(step.id);
      }
    }

    const executionOrder: string[][] = [];
    let processedCount = 0;

    // Queue of step IDs with inDegree 0
    let currentLevel: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        currentLevel.push(id);
      }
    }

    let depth = 0;
    while (currentLevel.length > 0) {
      executionOrder.push(currentLevel);
      processedCount += currentLevel.length;
      depth++;

      const nextLevel: string[] = [];
      for (const node of currentLevel) {
        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            nextLevel.push(neighbor);
          }
        }
      }
      currentLevel = nextLevel;
    }

    const hasCycle = processedCount < steps.length;
    return {
      executionOrder,
      hasCycle,
      maxDepth: depth,
    };
  }

  private compareRisk(a: ActionRiskLevel, b: ActionRiskLevel): number {
    const weights: Record<ActionRiskLevel, number> = {
      [ActionRiskLevel.LOW]: 1,
      [ActionRiskLevel.MEDIUM]: 2,
      [ActionRiskLevel.HIGH]: 3,
      [ActionRiskLevel.CRITICAL]: 4,
    };
    return (weights[a] || 1) - (weights[b] || 1);
  }
}

export const planValidator = new PlanValidator();
