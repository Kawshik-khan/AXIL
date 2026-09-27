import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSettingsService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (key) {
      const versions = PlatformSettingsService.getSettingVersions(key, context);
      return apiSuccess(versions);
    }

    const settings = PlatformSettingsService.getSettings(context);
    return apiSuccess(settings);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { key, value, reason } = body;
    const updated = PlatformSettingsService.updateSetting(key, value, reason, context);
    return apiSuccess(updated);
  } catch (error) {
    return apiError(error);
  }
}
