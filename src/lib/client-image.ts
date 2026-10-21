/**
 * Browser-side photo shrinking before upload (ADR-120). A phone photo (3-8 MB, often HEIC on iPhone) becomes a
 * ~200-600 KB WebP (JPEG where the browser can't encode WebP) at most 1600 px on its longest side. Drawing to a canvas
 * also applies the EXIF rotation and drops all metadata, including GPS. The server re-checks everything.
 */

export const UPLOAD_MAX_SIDE_PX = 1600;
const QUALITY = 0.85;
const SERVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file isn't a photo this browser can open. Try a JPEG, PNG or WebP."));
    };
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** The image to upload: shrunk and re-encoded, or the original when that is already smaller and acceptable. */
export async function shrinkImageForUpload(file: File): Promise<Blob> {
  const img = await decode(file);
  const scale = Math.min(1, UPLOAD_MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the photo for upload.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let blob = await encode(canvas, "image/webp");
  // Browsers that can't encode WebP silently return PNG; JPEG is much smaller for photos
  if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg");
  if (!blob) throw new Error("This browser can't prepare the photo for upload.");
  if (scale === 1 && SERVER_TYPES.has(file.type) && file.size <= blob.size) return file;
  return blob;
}
