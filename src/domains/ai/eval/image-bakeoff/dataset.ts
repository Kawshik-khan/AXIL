/**
 * Image product-search bake-off (spec: .agent/specs/customer-agent/image-product-search.md §8, runbook:
 * docs/image-bakeoff.md): the labelled dataset and safe image loading.
 *
 * A dataset is one shop's catalog images plus customer-style query images, described by `manifest.json`. Query
 * images are often real customer photos (faces, addresses, payment details): keep datasets in `eval-data/`, which git
 * ignores, and never commit them. Images are sniffed by magic bytes and their metadata (EXIF/GPS, XMP, comments) is
 * removed before any bytes leave the machine.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { z } from "zod";
import { ImageFormatError, sniffImageMime, stripImageMetadata as stripBytes, type ImageMime } from "@/domains/media/image-bytes";

export { sniffImageMime, type ImageMime };

export const IMAGE_KINDS = ["product", "payment_proof", "person", "document", "other"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** Larger files are refused, not resized: resize them before adding them to the dataset. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

// ---- Manifest --------------------------------------------------------------------------------------------------------

const Id = z.string().trim().min(1).max(120);
const RelFile = z.string().trim().min(1).max(500);
const Sku = z.string().trim().min(1).max(120);

const CatalogProductSchema = z
  .object({
    product_id: Id,
    name: z.string().trim().min(1).max(300),
    sku: Sku.optional(),
    variants: z.array(z.object({ variant_id: Id, sku: Sku.optional() }).strict()).max(100).default([]),
    images: z.array(z.object({ file: RelFile, variant_id: Id.optional() }).strict()).min(1).max(50),
  })
  .strict();

const QuerySchema = z
  .object({
    id: Id,
    file: RelFile,
    expected_kind: z.enum(IMAGE_KINDS),
    /** null: the shop doesn't sell this item (or it isn't a product photo). */
    expected_product_id: Id.nullable(),
    expected_variant_id: Id.nullable().optional(),
    /** A product code visible in the image, for measuring OCR. */
    expected_sku: Sku.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    /** Thresholds are calibrated on "calibration" and measured on "test"; without splits both use every query. */
    split: z.enum(["calibration", "test"]).optional(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    version: z.literal(1),
    shop: z.string().trim().max(200).optional(),
    catalog: z.array(CatalogProductSchema).min(1).max(5000),
    queries: z.array(QuerySchema).min(1).max(5000),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type CatalogProduct = Manifest["catalog"][number];
export type BakeoffQuery = Manifest["queries"][number];

/** Parses and cross-checks a manifest. Throws DatasetError listing every problem found. */
export function validateManifest(raw: unknown): Manifest {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new DatasetError(`manifest.json is invalid:\n  ${issues.join("\n  ")}`);
  }
  const manifest = parsed.data;
  const problems: string[] = [];
  const products = new Map<string, CatalogProduct>();
  for (const product of manifest.catalog) {
    if (products.has(product.product_id)) problems.push(`duplicate product_id ${product.product_id}`);
    products.set(product.product_id, product);
    const variantIds = new Set(product.variants.map((v) => v.variant_id));
    if (variantIds.size !== product.variants.length) problems.push(`product ${product.product_id} has duplicate variant ids`);
    for (const image of product.images) {
      if (image.variant_id && !variantIds.has(image.variant_id)) {
        problems.push(`product ${product.product_id}: image ${image.file} names unknown variant ${image.variant_id}`);
      }
    }
  }
  const queryIds = new Set<string>();
  for (const query of manifest.queries) {
    if (queryIds.has(query.id)) problems.push(`duplicate query id ${query.id}`);
    queryIds.add(query.id);
    if (query.expected_kind !== "product" && query.expected_product_id !== null) {
      problems.push(`query ${query.id}: a ${query.expected_kind} image can't expect a product`);
    }
    if (query.expected_product_id !== null) {
      const product = products.get(query.expected_product_id);
      if (!product) {
        problems.push(`query ${query.id}: expected_product_id ${query.expected_product_id} is not in the catalog`);
      } else if (query.expected_variant_id && !product.variants.some((v) => v.variant_id === query.expected_variant_id)) {
        problems.push(`query ${query.id}: expected_variant_id ${query.expected_variant_id} is not a variant of ${product.product_id}`);
      }
    } else if (query.expected_variant_id) {
      problems.push(`query ${query.id}: expected_variant_id needs an expected_product_id`);
    }
  }
  const splits = new Set(manifest.queries.map((q) => q.split ?? "none"));
  if (splits.size > 1 && (!splits.has("calibration") || !splits.has("test") || splits.has("none"))) {
    problems.push(`when any query has a split, every query needs one and both "calibration" and "test" must be present`);
  }
  if (problems.length) throw new DatasetError(`manifest.json has ${problems.length} problem(s):\n  ${problems.slice(0, 30).join("\n  ")}`);
  return manifest;
}

export function readManifest(datasetDir: string): Manifest {
  const file = path.join(datasetDir, "manifest.json");
  if (!fs.existsSync(file)) throw new DatasetError(`no manifest.json in ${datasetDir} (see docs/image-bakeoff.md)`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new DatasetError("manifest.json is not valid JSON");
  }
  return validateManifest(raw);
}

// ---- Images ----------------------------------------------------------------------------------------------------------

export interface LoadedImage {
  /** Path relative to the dataset directory, as written in the manifest. */
  file: string;
  mime: ImageMime;
  /** Bytes with metadata removed: exactly what is sent to a provider. */
  bytes: Buffer;
  /** Of `bytes`; the cache key. */
  sha256: string;
}

export function toDataUri(image: LoadedImage): string {
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}

/** Reads one image of the dataset. The path must stay inside the dataset directory. */
export function loadImage(datasetDir: string, relFile: string): LoadedImage {
  const root = path.resolve(datasetDir);
  const full = path.resolve(root, relFile);
  if (full !== root && !full.startsWith(root + path.sep)) throw new DatasetError(`${relFile}: path leaves the dataset directory`);
  if (!fs.existsSync(full)) throw new DatasetError(`${relFile}: file not found`);
  const size = fs.statSync(full).size;
  if (size > MAX_IMAGE_BYTES) throw new DatasetError(`${relFile}: ${Math.round(size / 1024)} KB is over the 5 MB limit; resize it`);
  const raw = fs.readFileSync(full);
  const mime = sniffImageMime(raw);
  if (!mime) throw new DatasetError(`${relFile}: not a JPEG, PNG or WebP image`);
  const bytes = stripImageMetadata(raw, mime, relFile);
  return { file: relFile, mime, bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

/** Removes EXIF/GPS, XMP, IPTC and text comments (see image-bytes.ts). Throws DatasetError on a malformed file. */
export function stripImageMetadata(buf: Buffer, mime: ImageMime, label = "image"): Buffer {
  try {
    return stripBytes(buf, mime, label);
  } catch (err) {
    if (err instanceof ImageFormatError) throw new DatasetError(err.message);
    throw err;
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- Synthetic images (sample dataset and tests) ---------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A small two-colour striped PNG. Only for the synthetic sample dataset and tests; a real bake-off needs real
 * product photos. `textChunk` adds a tEXt chunk (to test metadata removal).
 */
export function makeSyntheticPng(rgb: [number, number, number], stripe: [number, number, number], size = 16, textChunk?: string): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0
    for (let x = 0; x < size; x++) row.set(Math.floor(y / 4) % 2 ? stripe : rgb, 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const chunks = [pngChunk("IHDR", ihdr)];
  if (textChunk) chunks.push(pngChunk("tEXt", Buffer.from(`Comment\0${textChunk}`, "latin1")));
  chunks.push(pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}
