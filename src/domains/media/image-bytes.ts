/**
 * Image bytes without an image library: what kind of image a buffer really is (magic bytes, never the file name or the
 * declared type), its pixel size, and the same image with its metadata removed. Shared by product image uploads and
 * the image-search bake-off (spec: .agent/specs/customer-agent/image-product-search.md).
 *
 * Only JPEG, PNG and WebP are accepted anywhere. SVG never is: it can carry script.
 */

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS: Record<ImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A buffer that isn't a well-formed JPEG, PNG or WebP. */
export class ImageFormatError extends Error {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// ---- Pixel size ------------------------------------------------------------------------------------------------------

/** Width and height from the image header, or null when the header can't be read. */
export function readImageDimensions(buf: Buffer, mime: ImageMime): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (mime === "image/jpeg") return jpegDimensions(buf);
  return webpDimensions(buf);
}

function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but aren't frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const fourcc = buf.toString("latin1", 12, 16);
  if (fourcc === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  if (fourcc === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (fourcc === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

// ---- Metadata removal ------------------------------------------------------------------------------------------------

/**
 * Keeps only what draws the image (allow-list): pixel data, palettes, transparency and colour profiles. Everything
 * else goes: EXIF/GPS, XMP, IPTC, comments, MPF secondary images, unknown chunks and bytes after the image ends, so a
 * stored file can't carry hidden data. Throws ImageFormatError on a malformed file.
 */
export function stripImageMetadata(buf: Buffer, mime: ImageMime, label = "image"): Buffer {
  if (mime === "image/jpeg") return stripJpeg(buf, label);
  if (mime === "image/png") return stripPng(buf, label);
  return stripWebp(buf, label);
}

const ICC_PROFILE = Buffer.from("ICC_PROFILE\0", "latin1");

function keepJpegSegment(marker: number, data: Buffer): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true; // tables, frame headers, restart interval: needed to decode
  if (marker === 0xe0 || marker === 0xee) return true; // APP0 (JFIF), APP14 (Adobe colour transform)
  return marker === 0xe2 && data.subarray(4, 4 + ICC_PROFILE.length).equals(ICC_PROFILE); // APP2 ICC, not MPF
}

function stripJpeg(buf: Buffer, label: string): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) throw new ImageFormatError(`${label}: malformed JPEG`);
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: image data (and, in progressive files, more tables and scans) up to the end-of-image marker.
      // Inside entropy-coded data a 0xFF byte is always followed by 0x00 or a restart marker, so the first FF D9 is
      // the real end; anything after it (an MPF second image, an appended file) is dropped.
      for (let j = i + 2; j + 1 < buf.length; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          parts.push(buf.subarray(i, j + 2));
          return Buffer.concat(parts);
        }
      }
      throw new ImageFormatError(`${label}: JPEG has no end-of-image marker`);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) throw new ImageFormatError(`${label}: malformed JPEG segment`);
    const segment = buf.subarray(i, i + 2 + length);
    if (keepJpegSegment(marker, segment)) parts.push(segment);
    i += 2 + length;
  }
  throw new ImageFormatError(`${label}: JPEG has no image data`);
}

/** Critical chunks plus the ones that affect how pixels look. Text, EXIF, time and private chunks are dropped. */
const PNG_KEPT = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs"]);

function stripPng(buf: Buffer, label: string): Buffer {
  const parts: Buffer[] = [PNG_SIGNATURE];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) throw new ImageFormatError(`${label}: malformed PNG chunk`);
    if (PNG_KEPT.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  throw new ImageFormatError(`${label}: PNG has no IEND chunk`);
}

const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_XMP = 0x04;
const WEBP_KEPT = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);

function stripWebp(buf: Buffer, label: string): Buffer {
  const parts: Buffer[] = [];
  // The RIFF size says where the file ends; bytes after it are not part of the image
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  let i = 12;
  while (i + 8 <= riffEnd) {
    const fourcc = buf.toString("latin1", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > buf.length) throw new ImageFormatError(`${label}: malformed WebP chunk`);
    const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
    if (fourcc === "VP8X" && size >= 1) chunk[8] &= ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
    if (WEBP_KEPT.has(fourcc)) parts.push(chunk);
    i = end;
  }
  if (!parts.length) throw new ImageFormatError(`${label}: WebP has no image chunks`);
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}
