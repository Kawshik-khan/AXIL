import { db } from "@/infrastructure/db";
import { PlatformSettingRecord, PlatformSettingVersionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { AppError, NotFoundError } from "@/lib/errors";

export class PlatformSettingsService {
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
    context: PlatformContext
  ): PlatformSettingRecord {
    PlatformAuthorizationService.assertCan(context, "platform_config.manage");
    PlatformAuthorizationService.assertStepUp(context, "platform_config.manage");

    if (!reason || reason.trim().length < 5) {
      throw new AppError("REASON_REQUIRED", "Updating platform configuration requires an operational justification (min 5 chars).", 400);
    }

    const existing = db.findPlatformSetting(key);
    if (!existing) throw new NotFoundError(`Platform setting "${key}" not found.`);

    const beforeState = { value: existing.value };

    const updated: PlatformSettingRecord = {
      ...existing,
      value,
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
        after_state: { key, value },
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
