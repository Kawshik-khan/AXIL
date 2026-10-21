import { extractRequestContext, apiError } from "@/lib/api-response";
import { NotFoundError } from "@/lib/errors";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { MediaService } from "@/domains/media/media.service";
import { getLocalMediaStorage } from "@/domains/media/media-storage";
import { sniffImageMime } from "@/domains/media/image-bytes";
import { withStore } from "@/lib/store-unit";

/**
 * GET /api/v1/media/files/tenants/<tenant>/...: serves an image stored with MEDIA_STORAGE=local (development only,
 * ADR-120). Only the caller's own workspace's files, only to someone who can read products. With R2, images are
 * served from the bucket's public URL and this route answers 404.
 */
async function handleGET(request: Request, { params: rawParams }: { params: Promise<{ key: string[] }> }) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);
    const storage = getLocalMediaStorage();
    const key = (params.key || []).join("/");
    // Another workspace's file is "not found", the same as a missing one
    if (!storage || !(await MediaService.tenantOwnsKey(context.tenant.id, key))) throw new NotFoundError("Image not found.");
    const bytes = await storage.read(key);
    const mime = bytes && sniffImageMime(bytes);
    if (!bytes || !mime) throw new NotFoundError("Image not found.");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": mime,
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
