/**
 * CommerceOS Phase 10: Autonomous Platform Service Index
 * Central export for all Phase 10 services.
 */

export { AutonomousControlPlaneService } from "./autonomous-control-plane.service";
export { BusinessObjectivesService } from "./business-objectives.service";
export { GlobalDecisionEngineService } from "./global-decision-engine.service";
export { StrategyEngineService } from "./strategy-engine.service";
export { CrossDomainOrchestratorService } from "./cross-domain-orchestrator.service";
export { UnifiedContextService } from "./unified-context.service";
export { ContinuousLearningService } from "./continuous-learning.service";
export { ModelGovernanceService } from "./model-governance.service";
export { AIProviderAbstractionService } from "./ai-provider-abstraction.service";
export { ModelRoutingService } from "./model-routing.service";
export { OptimizationEngineService } from "./optimization-engine.service";
export { AutonomyAdaptationService } from "./autonomy-adaptation.service";
export { PlatformHealthService } from "./platform-health.service";
export { PlatformEconomicsService } from "./platform-economics.service";
export { AutonomousRollbackService } from "./autonomous-rollback.service";
export { GlobalIncidentService } from "./global-incident.service";
export { DataResidencyService } from "./data-residency.service";
export { SLOEngineService } from "./slo-engine.service";
export { AutonomousCyclesService } from "./autonomous-cycles.service";
export { AutonomousWorkflowsService } from "./autonomous-workflows.service";

import { AutonomousControlPlaneService } from "./autonomous-control-plane.service";
import { BusinessObjectivesService } from "./business-objectives.service";
import { GlobalDecisionEngineService } from "./global-decision-engine.service";
import { StrategyEngineService } from "./strategy-engine.service";
import { CrossDomainOrchestratorService } from "./cross-domain-orchestrator.service";
import { UnifiedContextService } from "./unified-context.service";
import { ContinuousLearningService } from "./continuous-learning.service";
import { ModelGovernanceService } from "./model-governance.service";
import { AIProviderAbstractionService } from "./ai-provider-abstraction.service";
import { ModelRoutingService } from "./model-routing.service";
import { OptimizationEngineService } from "./optimization-engine.service";
import { AutonomyAdaptationService } from "./autonomy-adaptation.service";
import { PlatformHealthService } from "./platform-health.service";
import { PlatformEconomicsService } from "./platform-economics.service";
import { AutonomousRollbackService } from "./autonomous-rollback.service";
import { GlobalIncidentService } from "./global-incident.service";
import { DataResidencyService } from "./data-residency.service";
import { SLOEngineService } from "./slo-engine.service";
import { AutonomousCyclesService } from "./autonomous-cycles.service";
import { AutonomousWorkflowsService } from "./autonomous-workflows.service";

export const autonomousControlPlaneService = new AutonomousControlPlaneService();
export const businessObjectivesService = new BusinessObjectivesService();
export const globalDecisionEngineService = new GlobalDecisionEngineService();
export const strategyEngineService = new StrategyEngineService();
export const crossDomainOrchestratorService = new CrossDomainOrchestratorService();
export const unifiedContextService = new UnifiedContextService();
export const continuousLearningService = new ContinuousLearningService();
export const modelGovernanceService = new ModelGovernanceService();
export const aiProviderAbstractionService = new AIProviderAbstractionService();
export const modelRoutingService = new ModelRoutingService();
export const optimizationEngineService = new OptimizationEngineService();
export const autonomyAdaptationService = new AutonomyAdaptationService();
export const platformHealthService = new PlatformHealthService();
export const platformEconomicsService = new PlatformEconomicsService();
export const autonomousRollbackService = new AutonomousRollbackService();
export const globalIncidentService = new GlobalIncidentService();
export const dataResidencyService = new DataResidencyService();
export const sloEngineService = new SLOEngineService();
export const autonomousCyclesService = new AutonomousCyclesService();
export const autonomousWorkflowsService = new AutonomousWorkflowsService();

