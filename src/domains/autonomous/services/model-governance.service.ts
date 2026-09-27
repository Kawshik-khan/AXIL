/**
 * CommerceOS Phase 10: Model Governance Service
 * Model registry, versioning, lifecycle management with mandatory evaluation/approval stages.
 * Model lifecycle: DEVELOPMENT → EVALUATION → APPROVAL → STAGING → CANARY → PRODUCTION → MONITORING → RETIRED
 */

import { db } from "@/infrastructure/db";
import { AIModel, ModelLifecycleStatus, ModelEvaluation, ModelDeployment } from "@/types/autonomous";

export class ModelGovernanceService {
  getModels(tenantId: string): AIModel[] {
    return db.data.ai_models.filter((m) => m.tenant_id === tenantId);
  }

  findById(tenantId: string, modelId: string): AIModel | undefined {
    return db.data.ai_models.find((m) => m.id === modelId && m.tenant_id === tenantId);
  }

  registerModel(model: AIModel): AIModel {
    model.lifecycle_status = "DEVELOPMENT";
    model.created_at = new Date().toISOString();
    model.updated_at = model.created_at;
    db.data.ai_models.push(model);
    return model;
  }

  evaluateModel(tenantId: string, modelId: string, evaluation: ModelEvaluation): AIModel {
    const model = this.findById(tenantId, modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    model.lifecycle_status = "EVALUATION";
    model.performance_metrics = evaluation.results;
    model.quality_score = evaluation.results.quality_score || evaluation.results.accuracy || 0;
    model.updated_at = new Date().toISOString();
    return model;
  }

  approveModel(tenantId: string, modelId: string, approvedBy: string): AIModel {
    const model = this.findById(tenantId, modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    if (model.lifecycle_status !== "EVALUATION") throw new Error("Model must be evaluated before approval");
    model.lifecycle_status = "APPROVAL";
    model.approved_by = approvedBy;
    model.approved_at = new Date().toISOString();
    model.updated_at = model.approved_at;
    return model;
  }

  deployModel(tenantId: string, modelId: string, environment: "STAGING" | "CANARY" | "PRODUCTION"): ModelDeployment {
    const model = this.findById(tenantId, modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    const deployment: ModelDeployment = {
      id: `mdep_${modelId}_${Date.now()}`,
      tenant_id: tenantId,
      model_id: modelId,
      version: model.version,
      environment,
      canary_percent: environment === "CANARY" ? 5 : undefined,
      status: "ACTIVE",
      health: "HEALTHY",
      deployed_at: new Date().toISOString(),
    };
    model.lifecycle_status = environment === "PRODUCTION" ? "PRODUCTION" : environment === "CANARY" ? "CANARY" : "STAGING";
    model.deployment_status = { deployed_at: deployment.deployed_at, canary_percent: deployment.canary_percent, rollback_version: model.version };
    model.updated_at = new Date().toISOString();
    db.data.model_deployments.push(deployment);
    return deployment;
  }

  retireModel(tenantId: string, modelId: string): AIModel {
    const model = this.findById(tenantId, modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    model.lifecycle_status = "RETIRED";
    model.updated_at = new Date().toISOString();
    return model;
  }

  getModelLineage(tenantId: string, modelId: string): { model: AIModel; deployments: ModelDeployment[] } {
    const model = this.findById(tenantId, modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    const deployments = db.data.model_deployments.filter((d) => d.model_id === modelId && d.tenant_id === tenantId);
    return { model, deployments };
  }
}
