/**
 * Where uploaded media is stored (ADR-120). Chosen by `MEDIA_STORAGE`:
 *   - `r2`: a Cloudflare R2 bucket (S3 API, SigV4-signed PUT through outboundRequest). Files are served from the
 *     bucket's public URL (`MEDIA_PUBLIC_BASE_URL`, an r2.dev or custom domain), never through the app.
 *   - `local`: files under `MEDIA_LOCAL_DIR` (default `.data/media`), served by the authenticated
 *     `/api/v1/media/files/...` route. Development only: refused when NODE_ENV is production (Render's disk is
 *     ephemeral and there is no shared disk between servers).
 * Unset (or misconfigured) means uploads report "not configured"; nothing is stored anywhere else.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IntegrationNotConfiguredError, AppError } from "@/lib/errors";
import { outboundRequest } from "@/lib/outbound-http";
import type { MediaStorageKind } from "@/types/media";

export interface MediaStorage {
  readonly kind: MediaStorageKind;
  /** Stores the bytes at `key` (overwriting: keys are content-addressed, so the bytes are the same). */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The URL the stored file is served from. */
  publicUrl(key: string): string;
}

/** Keys are `tenants/<tenant>/<folder>/<hex>.<ext>`: no dots, slashes or encodings a path or URL could misread. */
const KEY_PATTERN = /^tenants\/[A-Za-z0-9_-]{1,80}\/[a-z-]{1,40}\/[a-f0-9]{16,64}\.(jpg|png|webp)$/;

export function assertValidMediaKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new AppError("MEDIA_KEY_INVALID", "Invalid media key.", 400);
}

// ---- Cloudflare R2 ---------------------------------------------------------------------------------------------------

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  /** Normally https://<account>.r2.cloudflarestorage.com; overridable for an S3-compatible test endpoint. */
  endpoint: string;
}

const UNSIGNED_SEGMENT = /[^A-Za-z0-9\-._~]/g;
const encodeSegment = (s: string) => s.replace(UNSIGNED_SEGMENT, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
const sha256Hex = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

class R2Storage implements MediaStorage {
  readonly kind = "r2" as const;
  constructor(private readonly config: R2Config) {}

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertValidMediaKey(key);
    const url = new URL(`${this.config.endpoint}/${encodeSegment(this.config.bucket)}/${key.split("/").map(encodeSegment).join("/")}`);
    const headers = this.sign("PUT", url, bytes, {
      "content-type": contentType,
      // Content-addressed keys never change content, so browsers and the CDN may keep them for a year
      "cache-control": "public, max-age=31536000, immutable",
    });
    const res = await outboundRequest(url.toString(), {
      method: "PUT",
      headers,
      body: bytes,
      timeoutMs: 20_000,
      maxResponseBytes: 16_384,
      platformConfigured: true,
    });
    if (res.status < 200 || res.status >= 300) {
      // The bucket's error XML can name the bucket and key but never the credentials; still, keep only the code
      const code = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(res.body)?.[1] ?? "unknown";
      throw new AppError("MEDIA_STORAGE_FAILED", `Image storage refused the upload (HTTP ${res.status}, ${code}).`, 502);
    }
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key}`;
  }

  private sign(method: string, url: URL, body: Buffer, extra: Record<string, string>): Record<string, string> {
    return signS3Request({ method, url, body, headers: extra, accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, region: "auto" });
  }
}

/**
 * AWS Signature Version 4 headers for one S3 request (R2 uses region "auto"). Returns the given headers plus
 * x-amz-date, x-amz-content-sha256 and authorization; Host is signed but left to the transport.
 */
export function signS3Request(input: {
  method: string;
  url: URL;
  body: Buffer;
  headers: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now?: Date;
}): Record<string, string> {
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v;
  Object.assign(headers, { host: input.url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate });
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const { host: _host, ...sent } = headers; // the transport sets Host from the URL
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---- Local disk (development) ----------------------------------------------------------------------------------------

export const LOCAL_MEDIA_ROUTE = "/api/v1/media/files";

class LocalStorage implements MediaStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, bytes);
  }

  publicUrl(key: string): string {
    return `${LOCAL_MEDIA_ROUTE}/${key}`;
  }

  /** The stored bytes, or null when there is no such file. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private pathFor(key: string): string {
    assertValidMediaKey(key);
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new AppError("MEDIA_KEY_INVALID", "Invalid media key.", 400);
    return full;
  }
}

// ---- Selection -------------------------------------------------------------------------------------------------------

let storageForTesting: MediaStorage | null = null;

/** The configured storage. Throws IntegrationNotConfiguredError (424) when uploads can't be stored. */
export function getMediaStorage(): MediaStorage {
  if (storageForTesting) return storageForTesting;
  const env = process.env;
  const kind = (env.MEDIA_STORAGE || "").trim().toLowerCase();
  if (kind === "r2") {
    const missing = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "MEDIA_PUBLIC_BASE_URL"].filter((k) => !env[k]?.trim());
    if (missing.length) throw new IntegrationNotConfiguredError("Image storage", `missing ${missing.join(", ")}`);
    const publicBaseUrl = env.MEDIA_PUBLIC_BASE_URL!.trim().replace(/\/+$/, "");
    if (!/^https:\/\//.test(publicBaseUrl)) throw new IntegrationNotConfiguredError("Image storage", "MEDIA_PUBLIC_BASE_URL must be https");
    const accountId = env.R2_ACCOUNT_ID!.trim();
    // Signed PUTs carry the image and the request signature: never in cleartext outside development
    if (env.R2_ENDPOINT?.trim() && !/^https:\/\//.test(env.R2_ENDPOINT.trim()) && env.NODE_ENV === "production") {
      throw new IntegrationNotConfiguredError("Image storage", "R2_ENDPOINT must be https");
    }
    return new R2Storage({
      accountId,
      accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
      bucket: env.R2_BUCKET!.trim(),
      publicBaseUrl,
      endpoint: (env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, ""),
    });
  }
  if (kind === "local") {
    if (env.NODE_ENV === "production") throw new IntegrationNotConfiguredError("Image storage", "MEDIA_STORAGE=local is for development only");
    return new LocalStorage(env.MEDIA_LOCAL_DIR?.trim() || path.join(process.cwd(), ".data", "media"));
  }
  throw new IntegrationNotConfiguredError("Image storage", "set MEDIA_STORAGE");
}

/** The local store when that is the configured one (the dev file route serves only from it), else null. */
export function getLocalMediaStorage(): LocalStorage | null {
  try {
    const storage = getMediaStorage();
    return storage instanceof LocalStorage ? storage : null;
  } catch {
    return null;
  }
}

/** Tests only: a fixed storage (null restores the environment's). */
export function setMediaStorageForTesting(storage: MediaStorage | null): void {
  storageForTesting = storage;
}

/** Tests only: build the real drivers with explicit settings. */
export const createMediaStorageForTesting = {
  r2: (config: R2Config): MediaStorage => new R2Storage(config),
  local: (root: string): LocalStorage => new LocalStorage(root),
};
