import { db } from "@/infrastructure/db";
import { PlatformSettingRecord, PlatformSettingVersionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { AppError } from "@/lib/errors";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { SETTINGS_REGISTRY, findSettingSpec, validateSettingValue, type SettingSpec } from "../settings-registry";

/** A registered setting with the value in force and where it comes from. */
export interface EffectiveSetting {
  key: string;
  label: string;
  description: string;
  category: SettingSpec["category"];
  unit?: string;
  risk: SettingSpec["risk"];
  editable: boolean;
  read_by: string | null;
  value: unknown;
  default_value: unknown;
  source: "STORED" | "DEFAULT";
  updated_at: string | null;
}

export class PlatformSettingsService {
  /**
   * The value of a registered setting for system code: the stored value when it passes the registry schema,
   * otherwise the code default. No context: callers are services enforcing the setting, not operators reading it.
   */
  public static getEffectiveSetting<T>(key: string): T {
    const spec = findSettingSpec(key);
    if (!spec) throw new Error(`Unregistered platform setting "${key}".`);
    const stored = db.findPlatformSetting(key);
    if (stored) {
      const parsed = spec.schema.safeParse(stored.value);
      if (parsed.success) return parsed.data as T;
    }
    return spec.default as T;
  }

  /** Every registered setting with its value in force, for the console (sensitive values masked). */
  public static listEffectiveSettings(context: PlatformContext): EffectiveSetting[] {
    PlatformAuthorizationService.assertCan(context, "platform_config.read");
    return SETTINGS_REGISTRY.map((spec) => {
      const stored = db.findPlatformSetting(spec.key);
      const valid = stored ? spec.schema.safeParse(stored.value).success : false;
      const value = valid ? stored!.value : spec.default;
      return {
        key: spec.key,
        label: spec.label,
        description: spec.description,
        category: spec.category,
        unit: spec.unit,
        risk: spec.risk,
        editable: spec.readBy !== null,
        read_by: spec.readBy,
        value: spec.sensitive ? "********" : value,
        default_value: spec.sensitive ? "********" : spec.default,
        source: valid ? "STORED" : "DEFAULT",
        updated_at: valid ? stored!.updated_at : null,
      };
    });
  }

  /**
   * Retrieves all platform settings. Masks sensitive values unless explicitly authorized.
   */
  public static getSettings(context: PlatformContext): PlatformSettingRecord[] {
    PlatformAuthorizationService.assertCan(context, "platform_config.read");

    const settings = db.getPlatformSettings();
    return settings.map((s) => {
      if (s.is_sensitive) {
        return { ...s, value: "********" };
      }
      return s;
    });
  }

  /**
   * Updates a platform setting with version history and audit log.
   */
  public static updateSetting(
    key: string,
    value: unknown,
    reason: string,
    context: PlatformContext,
    options: { ticketRef?: string; approvalId?: string } = {}
  ): PlatformSettingRecord {
    PlatformAuthorizationService.assertCan(context, "platform_config.manage");
    const spec = findSettingSpec(key);
    let validated: unknown;
    try {
      validated = validateSettingValue(key, value);
    } catch (err) {
      throw new AppError("SETTING_REJECTED", (err as Error).message, 400, { key });
    }
    // HIGH/CRITICAL settings govern approvals and billing policy: a second operator must approve the exact value
    // (security review M5); others need step-up and a reason
    const governed = spec!.risk === "HIGH" || spec!.risk === "CRITICAL";
    PrivilegedActionGate.assert(context, governed ? "platform_config.update_governed" : "platform_config.update", {
      reason,
      ticketRef: options.ticketRef,
      approvalId: options.approvalId,
      payload: { key, value: validated },
    });

    const existing = db.findPlatformSetting(key);
    const beforeState = { value: existing ? existing.value : spec!.default, source: existing ? "STORED" : "DEFAULT" };

    const updated: PlatformSettingRecord = {
      key,
      category: spec!.category,
      description: spec!.description,
      is_sensitive: spec!.sensitive,
      ...existing,
      value: validated,
      updated_at: new Date().toISOString(),
    };

    db.savePlatformSetting(updated, context.platformUser.id, reason);

    PlatformAuditService.record(
      {
        action: "platform_config.update",
        resource_type: "platform_setting",
        resource_id: key,
        reason,
        before_state: beforeState,
        after_state: { key, value: spec!.sensitive ? "********" : validated },
        result: "SUCCESS",
      },
      context
    );

    return updated;
  }

  /**
   * Retrieves setting version change history.
   */
  public static getSettingVersions(key: string, context: PlatformContext): PlatformSettingVersionRecord[] {
    PlatformAuthorizationService.assertCan(context, "platform_config.read");
    return db.getPlatformSettingVersions(key);
  }
}
