import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { MediaService, MEDIA_LIMITS } from "@/domains/media/media.service";
import { withStore } from "@/lib/store-unit";

/**
 * POST /api/v1/media/product-images: one product image as the raw request body (ADR-120).
 * The Content-Type must be an image type; besides naming the format it makes a cross-site request need a CORS
 * preflight, which this API never grants, so a page on another site can't upload with a merchant's cookie.
 * The stored type comes from the bytes, not this header.
 */
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function readBody(request: Request, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new AppError("MEDIA_TOO_LARGE", `Images can be at most ${maxBytes / 1024 / 1024} MB.`, 413);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw tooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await MediaService.assertUploadAllowed(context); // before reading up to 5 MB from a caller who can't upload
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_TYPES.has(type)) {
      throw new AppError("MEDIA_TYPE_UNSUPPORTED", "Send the image as the request body with an image/jpeg, image/png or image/webp Content-Type.", 415);
    }
    const image = await MediaService.uploadProductImage(context, await readBody(request, MEDIA_LIMITS.maxBytes));
    return apiSuccess({ image }, undefined, image.reused ? 200 : 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
