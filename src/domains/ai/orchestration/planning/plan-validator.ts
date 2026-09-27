import { ActionRiskLevel } from '@/types/orchestration';
import { agentRegistry } from '../agent-registry';
import { AgentType } from '@/types/ai';

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

      // Verify agent registered
      const agentProfile = agentRegistry.getAgent(step.agent_type as AgentType);
      if (!agentProfile) {
        errors.push(`Step "${step.id}" references unknown or unpermitted agent: "${step.agent_type}"`);
      } else if (!agentProfile.enabled) {
        errors.push(`Step "${step.id}" references disabled agent: "${step.agent_type}"`);
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
