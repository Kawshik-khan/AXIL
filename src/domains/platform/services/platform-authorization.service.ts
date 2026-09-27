import {
  PlatformContext,
  PlatformPermission,
  PlatformRole,
  hasPlatformPermission,
} from "@/lib/context";
import {
  PlatformAuthRequiredError,
  PlatformPermissionDeniedError,
  PlatformScopeRequiredError,
  StepUpRequiredError,
} from "@/lib/errors";

export type OperationRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export class PlatformAuthorizationService {
  /**
   * Authoritatively classifies an administrative operation by its blast radius and risk tier.
   */
  public static classifyRisk(action: string): OperationRiskLevel {
    const criticalActions = [
      "tenant.delete",
      "tenant.purge",
      "security.manage",
      "kill_switch.activate",
      "kill_switch.deactivate",
      "platform_config.manage",
      "provider.delete",
      "automation.kill_all",
    ];

    const highActions = [
      "tenant.suspend",
      "support.impersonate",
      "provider.manage",
      "automation.pause",
      "dlq.retry_all",
      "entitlement.manage",
      "plan.archive",
    ];

    const mediumActions = [
      "tenant.create",
      "tenant.update",
      "plan.create",
      "plan.update",
      "subscription.manage",
      "feature_flag.manage",
      "incident.create",
      "incident.resolve",
      "announcement.publish",
      "maintenance.manage",
    ];

    if (criticalActions.some((a) => action.includes(a))) return "CRITICAL";
    if (highActions.some((a) => action.includes(a))) return "HIGH";
    if (mediumActions.some((a) => action.includes(a))) return "MEDIUM";
    return "LOW";
  }

  /**
   * Asserts that the request context has an authentic PLATFORM scope.
   */
  public static assertPlatformScope(context: PlatformContext): void {
    if (context.scope !== "PLATFORM" || !context.platformUser) {
      throw new PlatformScopeRequiredError(
        "Access denied: Operation requires valid PLATFORM authorization scope."
      );
    }
  }

  /**
   * Verifies if the platform context has a specific permission.
   */
  public static can(context: PlatformContext, permission: PlatformPermission): boolean {
    if (context.scope !== "PLATFORM" || !context.platformUser) {
      return false;
    }
    return hasPlatformPermission(context, permission);
  }

  /**
   * Asserts that the platform context has the required permission, otherwise throwing PlatformPermissionDeniedError.
   */
  public static assertCan(context: PlatformContext, permission: PlatformPermission): void {
    this.assertPlatformScope(context);
    if (!this.can(context, permission)) {
      throw new PlatformPermissionDeniedError(
        `Platform operator lacks required permission: "${permission}".`,
        permission
      );
    }
  }

  /**
   * Enforces Step-Up MFA authentication for sensitive HIGH and CRITICAL risk operations.
   */
  public static assertStepUp(context: PlatformContext, action: string): void {
    const risk = this.classifyRisk(action);
    if (risk === "HIGH" || risk === "CRITICAL") {
      if (!context.stepUpVerified) {
        throw new StepUpRequiredError(
          `Operation "${action}" is classified as ${risk} risk and requires Step-Up MFA authentication.`
        );
      }
    }
  }
}
