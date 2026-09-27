import { db } from "@/infrastructure/db";
import { PlatformFeatureFlagRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { NotFoundError } from "@/lib/errors";

export class PlatformFeatureFlagService {
  /**
   * Lists all platform feature flags.
   */
  public static listFlags(context: PlatformContext): PlatformFeatureFlagRecord[] {
    PlatformAuthorizationService.assertCan(context, "feature_flag.read");
    return db.getPlatformFeatureFlags();
  }

  /**
   * Retrieves a single feature flag by key.
   */
  public static getFlag(key: string, context: PlatformContext): PlatformFeatureFlagRecord | undefined {
    PlatformAuthorizationService.assertCan(context, "feature_flag.read");
    return db.findPlatformFeatureFlag(key);
  }

  /**
   * Updates or creates a feature flag.
   */
  public static saveFlag(
    input: {
      key: string;
      description: string;
      is_enabled_globally: boolean;
      percentage_rollout?: number;
      scope?: "GLOBAL" | "TENANT" | "USER" | "ENVIRONMENT";
      tenant_allowlist?: string[];
      rules?: Record<string, unknown>;
    },
    reason: string,
    context: PlatformContext
  ): PlatformFeatureFlagRecord {
    PlatformAuthorizationService.assertCan(context, "feature_flag.manage");

    const existing = db.findPlatformFeatureFlag(input.key);
    const now = new Date().toISOString();
    const beforeState = existing ? { is_enabled: existing.is_enabled_globally, rollout: existing.percentage_rollout } : null;

    const flag: PlatformFeatureFlagRecord = {
      id: existing?.id || `flag_${input.key.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()}`,
      key: input.key,
      description: input.description,
      is_enabled_globally: input.is_enabled_globally,
      percentage_rollout: input.percentage_rollout ?? 100,
      scope: input.scope || "GLOBAL",
      tenant_allowlist: input.tenant_allowlist || [],
      rules: input.rules || {},
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    db.savePlatformFeatureFlag(flag);

    PlatformAuditService.record(
      {
        action: "feature_flag.save",
        resource_type: "feature_flag",
        resource_id: flag.id,
        reason: reason || `Updated feature flag ${flag.key}`,
        before_state: beforeState,
        after_state: { key: flag.key, is_enabled: flag.is_enabled_globally, percentage_rollout: flag.percentage_rollout },
        result: "SUCCESS",
      },
      context
    );

    return flag;
  }
}
