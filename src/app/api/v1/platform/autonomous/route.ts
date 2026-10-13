import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";
import {
  autonomousControlPlaneService,
  businessObjectivesService,
  globalDecisionEngineService,
  platformHealthService,
  continuousLearningService,
  modelGovernanceService,
  autonomousCyclesService,
} from "@/domains/autonomous/services";
import { AUTONOMOUS_SAFETY_BOUNDARIES } from "@/types/autonomous";
import { AppError } from "@/lib/errors";

const PauseAutonomySchema = z.object({
  action: z.literal("PAUSE_AUTONOMY"),
  tenant_id: z.string().min(1),
  domain: z.string().optional(),
  level: z.enum(["ALL", "DOMAIN", "WORKFLOW", "AGENT"]).optional(),
  reason: z.string().optional(),
}).strict();

const ResumeAutonomySchema = z.object({
  action: z.literal("RESUME_AUTONOMY"),
  tenant_id: z.string().min(1),
  domain: z.string().optional(),
  level: z.enum(["ALL", "DOMAIN", "WORKFLOW", "AGENT"]).optional(),
}).strict();

const TriggerCycleSchema = z.object({
  action: z.literal("TRIGGER_CYCLE"),
  tenant_id: z.string().min(1),
  cycle_type: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
}).strict();

const ApproveDecisionSchema = z.object({
  action: z.literal("APPROVE_DECISION"),
  tenant_id: z.string().min(1),
  decision_id: z.string().min(1),
  notes: z.string().optional(),
}).strict();

const RejectDecisionSchema = z.object({
  action: z.literal("REJECT_DECISION"),
  tenant_id: z.string().min(1),
  decision_id: z.string().min(1),
  reason: z.string().optional(),
}).strict();

const ActionBodySchema = z.discriminatedUnion("action", [
  PauseAutonomySchema,
  ResumeAutonomySchema,
  TriggerCycleSchema,
  ApproveDecisionSchema,
  RejectDecisionSchema,
]);

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "autonomous.platform.read");

    const tenants = (db.data.tenants || []).map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
    }));

    const { searchParams } = new URL(request.url);
    const requestedTenantId = searchParams.get("tenant_id");
    const selectedTenantId = requestedTenantId || tenants[0]?.id || "";

    let overview = null;
    let objectives: unknown[] = [];
    let decisions: unknown[] = [];
    let health = null;
    let candidates: unknown[] = [];
    let models: unknown[] = [];

    if (selectedTenantId) {
      overview = autonomousControlPlaneService.getAutonomousOverview(selectedTenantId);
      objectives = businessObjectivesService.getObjectives(selectedTenantId);
      decisions = globalDecisionEngineService.getDecisions(selectedTenantId);
      health = platformHealthService.getSystemHealth(selectedTenantId);
      candidates = continuousLearningService.getCandidates(selectedTenantId);
      models = modelGovernanceService.getModels(selectedTenantId);
    }

    // Fleet-wide summaries
    const pendingDecisionsFleet = (db.data.global_decisions || []).filter(
      (d: any) => d.status === "AWAITING_APPROVAL"
    ).length;

    return apiSuccess({
      selected_tenant_id: selectedTenantId,
      tenants,
      overview,
      objectives,
      decisions,
      health,
      learning: {
        candidates,
        models,
      },
      safety_boundaries: AUTONOMOUS_SAFETY_BOUNDARIES,
      fleet_summary: {
        total_tenants: tenants.length,
        pending_decisions_count: pendingDecisionsFleet,
        total_objectives_count: (db.data.business_objectives || []).length,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "autonomous.platform.manage");

    const body = ActionBodySchema.parse(await request.json());
    const operatorName = context.platformUser.name || context.platformUser.email || "Platform Operator";

    switch (body.action) {
      case "PAUSE_AUTONOMY": {
        const scopeLevel = body.level || (body.domain ? "DOMAIN" : "ALL");
        const result = autonomousControlPlaneService.pauseAutonomy(
          body.tenant_id,
          { level: scopeLevel, target: body.domain },
          body.reason || `Paused by operator ${operatorName} from Super Admin Control Tower`,
          context.platformUser.id
        );
        return apiSuccess({ action: body.action, result });
      }

      case "RESUME_AUTONOMY": {
        const scopeLevel = body.level || (body.domain ? "DOMAIN" : "ALL");
        const result = autonomousControlPlaneService.resumeAutonomy(
          body.tenant_id,
          { level: scopeLevel, target: body.domain },
          context.platformUser.id
        );
        return apiSuccess({ action: body.action, result });
      }

      case "TRIGGER_CYCLE": {
        const cycleType = body.cycle_type || "DAILY";
        const run =
          cycleType === "WEEKLY"
            ? autonomousCyclesService.startWeeklyCycle(body.tenant_id, "MANUAL")
            : cycleType === "MONTHLY"
              ? autonomousCyclesService.startMonthlyCycle(body.tenant_id, "MANUAL")
              : autonomousCyclesService.startDailyCycle(body.tenant_id, "MANUAL");
        return apiSuccess({ action: body.action, run, executed: false, note: "Cycle recorded at its first step." });
      }

      case "APPROVE_DECISION": {
        const approved = globalDecisionEngineService.approveDecision(
          body.tenant_id,
          body.decision_id,
          operatorName
        );
        return apiSuccess({ action: body.action, decision: approved });
      }

      case "REJECT_DECISION": {
        const rejected = globalDecisionEngineService.rejectDecision(
          body.tenant_id,
          body.decision_id,
          body.reason || `Rejected by operator ${operatorName} from Super Admin Control Tower`
        );
        return apiSuccess({ action: body.action, decision: rejected });
      }
    }
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
