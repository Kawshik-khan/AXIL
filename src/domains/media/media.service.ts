/**
 * Product image uploads (ADR-120). The browser shrinks a photo before sending it; this service trusts nothing it
 * receives: the type comes from the bytes, the size and pixel count are capped, metadata (EXIF/GPS, XMP, IPTC,
 * comments) is removed, and the tenant comes from the session. The same image uploaded twice by one tenant is stored
 * once.
 */
import crypto from "node:crypto";
import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { readTenantRows } from "@/infrastructure/db/tenant-rows";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError, PlanLimitError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { RequestContext } from "@/lib/context";
import type { MediaAsset } from "@/types/media";
import { IMAGE_EXTENSIONS, ImageFormatError, readImageDimensions, sniffImageMime, stripImageMetadata } from "./image-bytes";
import { getMediaStorage } from "./media-storage";

export const MEDIA_LIMITS = {
  /** After the browser's resize a product photo is ~200-600 KB; 5 MB leaves room for an unresized PNG. */
  maxBytes: 5 * 1024 * 1024,
  maxSidePx: 8000,
  maxPixels: 40_000_000,
  /** Stored images per workspace (storage cost and abuse ceiling until plans carry a media entitlement). */
  maxAssetsPerTenant: 5000,
  uploadsPerHour: 300,
  /** One member can't use up the whole workspace's hourly allowance. */
  uploadsPerUserPerHour: 120,
} as const;

export interface UploadedImage {
  id: string;
  url: string;
  content_type: MediaAsset["content_type"];
  bytes: number;
  width: number;
  height: number;
  /** True when this workspace had already uploaded the same image: nothing new was stored. */
  reused: boolean;
}

function toUploaded(asset: MediaAsset, reused: boolean): UploadedImage {
  return { id: asset.id, url: asset.url, content_type: asset.content_type, bytes: asset.bytes, width: asset.width, height: asset.height, reused };
}

export class MediaService {
  /** Images are added while creating or editing a product: either permission is enough. */
  public static assertCanUpload(context: RequestContext): void {
    if (!RbacService.can(context, PERMISSIONS.PRODUCTS_CREATE)) RbacService.assertCan(context, PERMISSIONS.PRODUCTS_UPDATE);
  }

  /** Permission and rate limits: the route calls this before reading up to 5 MB of body. */
  public static async assertUploadAllowed(context: RequestContext): Promise<void> {
    this.assertCanUpload(context);
    const hour = 60 * 60 * 1000;
    await enforceRateLimit(`media-upload:user:${context.tenant.id}:${context.user.id}`, MEDIA_LIMITS.uploadsPerUserPerHour, hour);
    await enforceRateLimit(`media-upload:${context.tenant.id}`, MEDIA_LIMITS.uploadsPerHour, hour);
  }

  /** Validates, cleans and stores one product image for the caller's workspace (after assertUploadAllowed). */
  public static async uploadProductImage(context: RequestContext, raw: Buffer): Promise<UploadedImage> {
    this.assertCanUpload(context);
    const tenantId = context.tenant.id;

    if (raw.length === 0) throw new BadRequestError("The file is empty.");
    if (raw.length > MEDIA_LIMITS.maxBytes) {
      throw new AppError("MEDIA_TOO_LARGE", `Images can be at most ${MEDIA_LIMITS.maxBytes / 1024 / 1024} MB.`, 413);
    }
    const mime = sniffImageMime(raw);
    if (!mime) throw new AppError("MEDIA_TYPE_UNSUPPORTED", "Only JPEG, PNG and WebP images can be uploaded.", 415);

    let bytes: Buffer;
    try {
      bytes = stripImageMetadata(raw, mime);
    } catch (err) {
      if (err instanceof ImageFormatError) throw new BadRequestError("The image file is damaged or incomplete.");
      throw err;
    }
    const size = readImageDimensions(bytes, mime);
    if (!size || size.width < 1 || size.height < 1) throw new BadRequestError("The image file is damaged or incomplete.");
    if (size.width > MEDIA_LIMITS.maxSidePx || size.height > MEDIA_LIMITS.maxSidePx || size.width * size.height > MEDIA_LIMITS.maxPixels) {
      throw new BadRequestError(`Images can be at most ${MEDIA_LIMITS.maxSidePx} pixels on a side.`);
    }

    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const [existing] = await readTenantRows<MediaAsset>("media_assets", tenantId, { field: "sha256", values: [sha256] });
    if (existing) return toUploaded(existing, true);

    const count = (await readTenantRows<MediaAsset>("media_assets", tenantId)).length;
    if (count >= MEDIA_LIMITS.maxAssetsPerTenant) throw new PlanLimitError("max_images", MEDIA_LIMITS.maxAssetsPerTenant, count);

    const storage = getMediaStorage();
    const key = `tenants/${tenantId}/products/${sha256.slice(0, 40)}.${IMAGE_EXTENSIONS[mime]}`;
    // Stored before the record commits: if the request then fails, the same upload later rewrites the same key
    try {
      await storage.put(key, bytes, mime);
    } catch (err) {
      // The bucket's error code and host (the account id) stay in the server log
      logger.warn("media.storage_put_failed", { tenant_id: tenantId, storage: storage.kind, error: err instanceof Error ? err.message : String(err) });
      throw new AppError("MEDIA_STORAGE_FAILED", "The image couldn't be stored right now. Try again in a minute.", 502);
    }

    const now = new Date().toISOString();
    const asset = db.createMediaAsset({
      id: `med_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      tenant_id: tenantId,
      purpose: "PRODUCT_IMAGE",
      storage: storage.kind,
      key,
      url: storage.publicUrl(key),
      content_type: mime,
      bytes: bytes.length,
      width: size.width,
      height: size.height,
      sha256,
      created_by: context.user.id,
      created_at: now,
    });
    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: context.user.id,
      action: "MEDIA_UPLOADED",
      resource_type: "media_asset",
      resource_id: asset.id,
      metadata: { purpose: asset.purpose, bytes: asset.bytes, content_type: asset.content_type, storage: asset.storage },
      created_at: now,
    });
    return toUploaded(asset, false);
  }

  /** Whether `key` is one of this workspace's files (the dev file route serves nothing else). */
  public static async tenantOwnsKey(tenantId: string, key: string): Promise<boolean> {
    if (!key.startsWith(`tenants/${tenantId}/`)) return false;
    const rows = await readTenantRows<MediaAsset>("media_assets", tenantId, { field: "key", values: [key] });
    return rows.length > 0;
  }
}
