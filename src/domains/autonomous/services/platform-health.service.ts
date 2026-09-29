/**
 * CommerceOS Phase 10: Platform Health Service
 * System-wide health across 11 dimensions with quality scorecard.
 */

import { db } from "@/infrastructure/db";
import { PlatformHealth, HealthStatus, HealthDimension, DomainHealthRecord, AutonomousQualityScorecard } from "@/types/autonomous";
import { randomSuffix } from "@/lib/ids";

export class PlatformHealthService {
  getSystemHealth(tenantId: string): PlatformHealth | undefined {
    return db.data.platform_health_records.find((h) => h.tenant_id === tenantId);
  }

  getDomainHealth(tenantId: string, dimension: HealthDimension): DomainHealthRecord | undefined {
    const health = this.getSystemHealth(tenantId);
    return health?.dimensions[dimension];
  }

  /** Compute quality scorecard from actual system metrics. */
  getQualityScorecard(tenantId: string, period: "DAILY" | "WEEKLY" | "MONTHLY"): AutonomousQualityScorecard {
    const now = new Date();
    const periodStart = new Date(now);
    if (period === "DAILY") periodStart.setDate(periodStart.getDate() - 1);
    else if (period === "WEEKLY") periodStart.setDate(periodStart.getDate() - 7);
    else periodStart.setMonth(periodStart.getMonth() - 1);

    const decisions = db.data.global_decisions.filter((d) => d.tenant_id === tenantId && new Date(d.created_at) >= periodStart);
    const verified = decisions.filter((d) => d.status === "VERIFIED");
    const failed = decisions.filter((d) => d.status === "FAILED");
    const objectives = db.data.business_objectives.filter((o) => o.tenant_id === tenantId && o.status === "ACTIVE");

    return {
      id: `qs_${tenantId}_${period}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      period,
      period_start: periodStart.toISOString(),
      period_end: now.toISOString(),
      // Measured from recorded decisions and objectives, or null (FX-30). The rest were literals (0.98, 0.85, 0.08,
      // 0.01, 0.02, 0.82, 0.65, 3.2) and "100%" defaults when nothing had happened.
      decision_accuracy: decisions.length > 0 ? verified.length / decisions.length : null,
      verification_success_rate: verified.length + failed.length > 0 ? verified.length / (verified.length + failed.length) : null,
      policy_compliance_rate: null,
      exception_recovery_rate: null,
      human_escalation_rate: null,
      duplicate_execution_rate: null,
      false_automation_rate: null,
      autonomous_action_failure_rate: decisions.length > 0 ? failed.length / decisions.length : null,
      forecast_accuracy: null,
      recommendation_adoption_rate: null,
      objective_achievement_rate: objectives.length > 0
        ? objectives.filter((o) => o.progress_percent >= 80).length / objectives.length
        : null,
      cost_efficiency_ratio: null,
      computed_at: now.toISOString(),
    };
  }

  /** Detect anomalies in system health. */
  detectAnomalies(tenantId: string): Array<{ dimension: HealthDimension; issue: string; severity: HealthStatus }> {
    const health = this.getSystemHealth(tenantId);
    if (!health) return [];
    const anomalies: Array<{ dimension: HealthDimension; issue: string; severity: HealthStatus }> = [];
    for (const [dim, record] of Object.entries(health.dimensions)) {
      if (record.status === "CRITICAL" || record.status === "AT_RISK") {
        anomalies.push({ dimension: dim as HealthDimension, issue: `${dim} health score: ${record.score}`, severity: record.status });
      }
      for (const indicator of record.indicators) {
        if (indicator.value < indicator.threshold) {
          anomalies.push({ dimension: dim as HealthDimension, issue: `${indicator.name}: ${indicator.value} below threshold ${indicator.threshold}`, severity: "AT_RISK" });
        }
      }
    }
    return anomalies;
  }

  /** Update a health dimension score. */
  updateDimensionHealth(tenantId: string, dimension: HealthDimension, score: number, status: HealthStatus): void {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const health = this.getSystemHealth(tenantId);
    if (!health) return;
    if (health.dimensions[dimension]) {
      health.dimensions[dimension].score = score;
      health.dimensions[dimension].status = status;
      health.dimensions[dimension].last_checked_at = new Date().toISOString();
    }
    // Recalculate overall status
    const scores = Object.values(health.dimensions).map((d) => d.score);
    const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    health.overall_status = avgScore >= 90 ? "HEALTHY" : avgScore >= 70 ? "DEGRADED" : avgScore >= 50 ? "AT_RISK" : "CRITICAL";
    health.assessed_at = new Date().toISOString();
  }
}
