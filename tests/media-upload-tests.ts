/**
 * Product image uploads (ADR-120): image byte checks (type from magic bytes, pixel size, metadata removal), the upload
 * route through its real module and session (RBAC, tenant scoping, limits, dedupe, "not configured"), the dev file
 * route (own workspace only), and the R2 driver's signed PUT through a fake outbound transport.
 * Run: node tests/ts-runner.cjs ./tests/media-upload-tests.ts
 */
// @ts-ignore
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { readTenantRows } from "@/infrastructure/db/tenant-rows";
import { AuthService } from "@/domains/auth/service";
import { signSessionToken } from "@/lib/security";
import type { RoleName } from "@/lib/permissions";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
import { OutboundResponse, setOutboundTransportForTesting } from "@/lib/outbound-http";
import { makeSyntheticPng } from "@/domains/ai/eval/image-bakeoff/dataset";
import { readImageDimensions, sniffImageMime, stripImageMetadata } from "@/domains/media/image-bytes";
import { MEDIA_LIMITS } from "@/domains/media/media.service";
import { createMediaStorageForTesting, getMediaStorage, setMediaStorageForTesting, signS3Request } from "@/domains/media/media-storage";
import type { MediaAsset } from "@/types/media";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

const BASE = "http://localhost:3000/api/v1";

// ---- Synthetic images ------------------------------------------------------------------------------------------------

/** A JPEG skeleton: SOI, an EXIF APP1 with a fake GPS string, a baseline frame header (SOF0), a scan, EOI. */
function makeJpeg(width: number, height: number, exifText = "GPS 23.8103N 90.4125E"): Buffer {
  const segment = (marker: number, data: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([head, data]);
  };
  const sof = Buffer.alloc(9);
  sof[0] = 8; // precision
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 1; // one component
  sof[6] = 1;
  sof[7] = 0x11;
  sof[8] = 0;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    segment(0xe1, Buffer.from(`Exif\0\0${exifText}`, "latin1")),
    segment(0xc0, sof),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

/** A lossless WebP header (VP8L) of the given size; enough for sniffing and size reading. */
function makeWebpLossless(width: number, height: number): Buffer {
  const bits = Buffer.alloc(4);
  bits.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 0);
  const payload = Buffer.concat([Buffer.from([0x2f]), bits, Buffer.alloc(5)]);
  const chunkHead = Buffer.alloc(8);
  chunkHead.write("VP8L", 0, "latin1");
  chunkHead.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([chunkHead, payload]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

/** Inserts a raw PNG chunk before IEND (CRC not checked by the server; it drops the chunk anyway). */
function pngWithChunk(type: string, data: Buffer): Buffer {
  const png = makeSyntheticPng([30, 160, 90], [10, 10, 10], 16);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), head, data, Buffer.alloc(4), png.subarray(iend)]);
}

/** A WebP with an extra chunk of the given type, plus `trailing` bytes after the RIFF end. */
function webpWithChunk(fourcc: string, data: Buffer, trailing = Buffer.alloc(0)): Buffer {
  const base = makeWebpLossless(64, 64);
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([base.subarray(12), head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, body, trailing]);
}

function pngWithSize(width: number, height: number): Buffer {
  const png = Buffer.from(makeSyntheticPng([200, 30, 30], [30, 30, 200], 16));
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

// ---- Calling the routes ----------------------------------------------------------------------------------------------

async function tokenFor(tenantId: string, userId: string, role: RoleName, email: string): Promise<string> {
  return signSessionToken({ userId, tenantId, role, email, name: `Media ${role}` });
}

async function member(tenantId: string, role: RoleName): Promise<string> {
  const id = `usr_media_${role.toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  const email = `${id}@media.test`;
  const now = new Date().toISOString();
  db.createUser({ id, email, name: `Media ${role}`, password_hash: "!disabled", status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${id}`, tenant_id: tenantId, user_id: id, role, created_at: now, updated_at: now });
  return tokenFor(tenantId, id, role, email);
}

async function upload(token: string | null, body: Buffer, contentType = "image/png") {
  const { POST } = await import("@/app/api/v1/media/product-images/route");
  const headers: Record<string, string> = { "content-type": contentType };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request(`${BASE}/media/product-images`, { method: "POST", headers, body: new Uint8Array(body) }));
  const json = (await res.json()) as { data?: { image?: { id: string; url: string; width: number; height: number; reused: boolean; bytes: number } }; error?: { code: string } };
  return { status: res.status, image: json.data?.image, code: json.error?.code };
}

async function getFile(token: string, key: string) {
  const { GET } = await import("@/app/api/v1/media/files/[...key]/route");
  return GET(new Request(`${BASE}/media/files/${key}`, { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

const assetsOf = (tenantId: string) => readTenantRows<MediaAsset>("media_assets", tenantId);

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   PRODUCT IMAGE UPLOADS (ADR-120)                  ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  resetRateLimitsForTesting();
  const stamp = Date.now();
  const regA = await AuthService.registerTenantWithOwner({ workspaceName: `Media Shop A ${stamp}`, name: "Owner A", email: `media-a-${stamp}@example.com`, password: "Password12345!" });
  const regB = await AuthService.registerTenantWithOwner({ workspaceName: `Media Shop B ${stamp}`, name: "Owner B", email: `media-b-${stamp}@example.com`, password: "Password12345!" });
  const A = regA.tenant.id;
  const B = regB.tenant.id;
  const ownerA = await tokenFor(A, regA.user.id, "OWNER", regA.user.email);
  const ownerB = await tokenFor(B, regB.user.id, "OWNER", regB.user.email);
  const supportA = await member(A, "SUPPORT");

  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "commerceos-media-"));
  setMediaStorageForTesting(createMediaStorageForTesting.local(mediaDir));

  console.log(`${ANSI_BOLD}[Image bytes]${ANSI_RESET}`);

  await runTest("type comes from the magic bytes; SVG, HTML and text are not images", () => {
    assert.strictEqual(sniffImageMime(makeJpeg(10, 10)), "image/jpeg");
    assert.strictEqual(sniffImageMime(makeSyntheticPng([1, 2, 3], [4, 5, 6])), "image/png");
    assert.strictEqual(sniffImageMime(makeWebpLossless(10, 10)), "image/webp");
    assert.strictEqual(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.strictEqual(sniffImageMime(Buffer.from("<html></html>")), null);
  });

  await runTest("pixel size is read from JPEG, PNG and WebP headers", () => {
    assert.deepStrictEqual(readImageDimensions(makeJpeg(1200, 800), "image/jpeg"), { width: 1200, height: 800 });
    assert.deepStrictEqual(readImageDimensions(makeSyntheticPng([1, 2, 3], [4, 5, 6], 16), "image/png"), { width: 16, height: 16 });
    assert.deepStrictEqual(readImageDimensions(makeWebpLossless(1600, 900), "image/webp"), { width: 1600, height: 900 });
  });

  await runTest("JPEG EXIF (with GPS) is removed and the frame survives", () => {
    const clean = stripImageMetadata(makeJpeg(640, 480), "image/jpeg");
    assert.ok(!clean.includes(Buffer.from("GPS 23.8103N")), "GPS text gone");
    assert.deepStrictEqual(readImageDimensions(clean, "image/jpeg"), { width: 640, height: 480 });
  });

  await runTest("allow-list: private PNG chunks, extra JPEG APP segments, MPF and trailing data, unknown WebP chunks are dropped", () => {
    const payload = Buffer.from("HIDDEN-PAYLOAD-".repeat(64));
    const png = stripImageMetadata(pngWithChunk("zzZz", payload), "image/png");
    assert.ok(!png.includes(payload.subarray(0, 15)), "PNG private chunk dropped");
    assert.deepStrictEqual(readImageDimensions(png, "image/png"), { width: 16, height: 16 });

    const seg = (marker: number, data: Buffer) => {
      const head = Buffer.from([0xff, marker, 0, 0]);
      head.writeUInt16BE(data.length + 2, 2);
      return Buffer.concat([head, data]);
    };
    const base = makeJpeg(320, 240, "GPS 1");
    const withExtras = Buffer.concat([
      base.subarray(0, 2),
      seg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01profile-bytes", "latin1")),
      seg(0xe2, Buffer.from("MPF\0secondary-index", "latin1")),
      seg(0xe5, payload),
      base.subarray(2),
      makeJpeg(160, 120, "GPS 23.81N 90.41E IN SECOND IMAGE"), // an MPF-style second image after end-of-image
    ]);
    const jpeg = stripImageMetadata(withExtras, "image/jpeg");
    assert.ok(jpeg.includes(Buffer.from("profile-bytes")), "ICC profile kept");
    for (const gone of ["MPF\0", "HIDDEN-PAYLOAD", "GPS 23.81N", "GPS 1"]) assert.ok(!jpeg.includes(Buffer.from(gone, "latin1")), `${gone} dropped`);
    assert.deepStrictEqual([jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]], [0xff, 0xd9], "ends at end-of-image");

    const webp = stripImageMetadata(webpWithChunk("ZZZZ", payload, payload), "image/webp");
    assert.ok(!webp.includes(payload.subarray(0, 15)), "WebP unknown chunk and trailing bytes dropped");
    assert.strictEqual(webp.readUInt32LE(4) + 8, webp.length, "RIFF size matches");
  });

  console.log(`\n${ANSI_BOLD}[Upload route]${ANSI_RESET}`);

  let firstKey = "";
  await runTest("owner uploads a PNG: 201, metadata removed, stored under the tenant's prefix, audited", async () => {
    const png = makeSyntheticPng([10, 120, 40], [240, 240, 240], 16, "Shop owner home address");
    const res = await upload(ownerA, png);
    assert.strictEqual(res.status, 201, `got ${res.status} ${res.code}`);
    assert.ok(res.image && !res.image.reused);
    assert.strictEqual(res.image!.width, 16);
    const [asset] = await assetsOf(A);
    assert.ok(asset, "record created");
    assert.ok(asset.key.startsWith(`tenants/${A}/products/`), asset.key);
    assert.strictEqual(asset.url, `/api/v1/media/files/${asset.key}`);
    const stored = fs.readFileSync(path.join(mediaDir, asset.key));
    assert.ok(!stored.includes(Buffer.from("Shop owner home address")), "tEXt chunk removed before storing");
    assert.strictEqual(crypto.createHash("sha256").update(stored).digest("hex"), asset.sha256);
    assert.ok(db.data.audit_logs.some((l) => l.action === "MEDIA_UPLOADED" && l.resource_id === asset.id && l.tenant_id === A));
    firstKey = asset.key;
  });

  await runTest("the same image again is reused: 200, no second record", async () => {
    const png = makeSyntheticPng([10, 120, 40], [240, 240, 240], 16, "a different comment, same pixels");
    const res = await upload(ownerA, png);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.image?.reused, true);
    assert.strictEqual((await assetsOf(A)).length, 1);
  });

  await runTest("the same image in another workspace is that workspace's own copy", async () => {
    const res = await upload(ownerB, makeSyntheticPng([10, 120, 40], [240, 240, 240], 16));
    assert.strictEqual(res.status, 201);
    const [assetB] = await assetsOf(B);
    assert.ok(assetB.key.startsWith(`tenants/${B}/`));
    assert.strictEqual((await assetsOf(A)).length, 1, "A unchanged");
  });

  await runTest("JPEG and WebP are accepted; the stored type comes from the bytes", async () => {
    const jpeg = await upload(ownerA, makeJpeg(800, 600), "image/jpeg");
    assert.strictEqual(jpeg.status, 201, `jpeg ${jpeg.status} ${jpeg.code}`);
    const webp = await upload(ownerA, makeWebpLossless(1600, 900), "image/png"); // header says PNG, bytes say WebP
    assert.strictEqual(webp.status, 201, `webp ${webp.status} ${webp.code}`);
    const stored = (await assetsOf(A)).find((a) => a.id === webp.image?.id);
    assert.strictEqual(stored?.content_type, "image/webp");
    assert.ok(stored?.key.endsWith(".webp"));
  });

  await runTest("no session: 401; a role without product create/update (SUPPORT): 403, nothing stored", async () => {
    const before = (await assetsOf(A)).length;
    assert.strictEqual((await upload(null, makeSyntheticPng([1, 1, 1], [2, 2, 2]))).status, 401);
    assert.strictEqual((await upload(supportA, makeSyntheticPng([1, 1, 1], [2, 2, 2]))).status, 403);
    assert.strictEqual((await assetsOf(A)).length, before);
  });

  await runTest("non-image Content-Type (form posts, JSON) is refused: 415", async () => {
    for (const type of ["multipart/form-data; boundary=x", "application/x-www-form-urlencoded", "text/plain", "application/json", "image/svg+xml"]) {
      const res = await upload(ownerA, makeSyntheticPng([5, 5, 5], [6, 6, 6]), type);
      assert.strictEqual(res.status, 415, `${type} → ${res.status}`);
    }
  });

  await runTest("bytes that aren't JPEG/PNG/WebP are refused even with an image Content-Type: 415", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    assert.strictEqual((await upload(ownerA, svg, "image/png")).status, 415);
  });

  await runTest("empty, truncated and over-sized images are refused, nothing stored", async () => {
    const before = (await assetsOf(A)).length;
    assert.strictEqual((await upload(ownerA, Buffer.alloc(0))).status, 400);
    const png = makeSyntheticPng([7, 7, 7], [8, 8, 8]);
    assert.strictEqual((await upload(ownerA, png.subarray(0, png.length - 20))).status, 400, "truncated PNG");
    assert.strictEqual((await upload(ownerA, pngWithSize(9000, 100))).status, 400, "over 8000 px");
    assert.strictEqual((await upload(ownerA, pngWithSize(7000, 7000))).status, 400, "over 40 megapixels");
    assert.strictEqual((await upload(ownerA, makeWebpLossless(9000, 100), "image/webp")).status, 400, "WebP over 8000 px");
    const tooBig = Buffer.concat([makeSyntheticPng([9, 9, 9], [1, 1, 1]), Buffer.alloc(MEDIA_LIMITS.maxBytes)]);
    assert.strictEqual((await upload(ownerA, tooBig)).status, 413);
    assert.strictEqual((await assetsOf(A)).length, before);
  });

  await runTest("workspace image limit: refused at the cap", async () => {
    const now = new Date().toISOString();
    const existing = (await assetsOf(B)).length;
    for (let i = existing; i < MEDIA_LIMITS.maxAssetsPerTenant; i++) {
      db.createMediaAsset({
        id: `med_fill_${i}`, tenant_id: B, purpose: "PRODUCT_IMAGE", storage: "local", key: `tenants/${B}/products/${i.toString(16).padStart(40, "0")}.png`,
        url: "", content_type: "image/png", bytes: 1, width: 1, height: 1, sha256: `fill${i}`, created_by: regB.user.id, created_at: now,
      });
    }
    const res = await upload(ownerB, makeSyntheticPng([50, 60, 70], [80, 90, 100]));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.code, "PLAN_LIMIT_REACHED");
  });

  await runTest("storage not configured: 424 INTEGRATION_NOT_CONFIGURED, no record", async () => {
    setMediaStorageForTesting(null);
    const saved = process.env.MEDIA_STORAGE;
    delete process.env.MEDIA_STORAGE;
    try {
      const before = (await assetsOf(A)).length;
      const res = await upload(ownerA, makeSyntheticPng([90, 1, 1], [1, 90, 1]));
      assert.strictEqual(res.status, 424);
      assert.strictEqual(res.code, "INTEGRATION_NOT_CONFIGURED");
      assert.strictEqual((await assetsOf(A)).length, before);
    } finally {
      if (saved !== undefined) process.env.MEDIA_STORAGE = saved;
      setMediaStorageForTesting(createMediaStorageForTesting.local(mediaDir));
    }
  });

  await runTest("MEDIA_STORAGE=local is refused in production", () => {
    setMediaStorageForTesting(null);
    const saved = { kind: process.env.MEDIA_STORAGE, env: process.env.NODE_ENV };
    process.env.MEDIA_STORAGE = "local";
    process.env.NODE_ENV = "production";
    try {
      assert.throws(() => getMediaStorage(), /development only/);
    } finally {
      process.env.NODE_ENV = saved.env;
      if (saved.kind === undefined) delete process.env.MEDIA_STORAGE;
      else process.env.MEDIA_STORAGE = saved.kind;
      setMediaStorageForTesting(createMediaStorageForTesting.local(mediaDir));
    }
  });

  console.log(`\n${ANSI_BOLD}[Dev file route]${ANSI_RESET}`);

  await runTest("own workspace's image is served with its sniffed type and nosniff", async () => {
    // The route serves only from the configured local store
    process.env.MEDIA_STORAGE = "local";
    process.env.MEDIA_LOCAL_DIR = mediaDir;
    setMediaStorageForTesting(null);
    const res = await getFile(supportA, firstKey);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "image/png");
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
  });

  await runTest("another workspace's image is 404, the same as a missing one", async () => {
    assert.strictEqual((await getFile(ownerB, firstKey)).status, 404);
    assert.strictEqual((await getFile(ownerA, `tenants/${A}/products/${"0".repeat(40)}.png`)).status, 404);
  });

  await runTest("path tricks are refused", async () => {
    for (const key of [`tenants/${A}/products\\..\\..\\${B}\\x.png`, `tenants/${A}/products/C:\\x.png`, `tenants/${A}/products/../../${B}/products/x.png`, `tenants/${A}/../../../etc/passwd`, `tenants/${A}/products/%2e%2e.png`]) {
      const status = (await getFile(ownerA, key)).status;
      assert.ok(status === 404 || status === 400, `${key} → ${status}`);
    }
    delete process.env.MEDIA_STORAGE;
    delete process.env.MEDIA_LOCAL_DIR;
    setMediaStorageForTesting(createMediaStorageForTesting.local(mediaDir));
  });

  console.log(`\n${ANSI_BOLD}[R2 driver]${ANSI_RESET}`);

  const r2 = createMediaStorageForTesting.r2({
    accountId: "acct123",
    accessKeyId: "AKIDTEST",
    secretAccessKey: "test-secret-key",
    bucket: "commerceos-media",
    publicBaseUrl: "https://media.example.test",
    endpoint: "https://acct123.r2.cloudflarestorage.com",
  });

  await runTest("SigV4 signer matches AWS's published S3 PUT example", () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "Example: PUT Object"
    const signed = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test%24file.text"),
      body: Buffer.from("Welcome to Amazon S3."),
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    assert.strictEqual(signed["x-amz-content-sha256"], "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    assert.strictEqual(
      signed.authorization,
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    );
  });

  await runTest("R2 upload: one SigV4-signed PUT of the cleaned bytes; the URL is the public bucket URL", async () => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: Buffer }> = [];
    setOutboundTransportForTesting(async (url, options): Promise<OutboundResponse> => {
      seen.push({ url: url.toString(), method: options.method, headers: options.headers ?? {}, body: Buffer.from(options.body ?? "") });
      return { status: 200, headers: {}, body: "", truncated: false, durationMs: 3 };
    });
    setMediaStorageForTesting(r2);
    try {
      const res = await upload(ownerA, makeJpeg(400, 300, "GPS should not reach R2"), "image/jpeg");
      assert.strictEqual(res.status, 201, `got ${res.status} ${res.code}`);
      assert.strictEqual(seen.length, 1);
      const call = seen[0];
      assert.strictEqual(call.method, "PUT");
      assert.ok(call.url.startsWith(`https://acct123.r2.cloudflarestorage.com/commerceos-media/tenants/${A}/products/`), call.url);
      assert.ok(!call.body.includes(Buffer.from("GPS should not reach R2")));
      assert.strictEqual(call.headers["x-amz-content-sha256"], crypto.createHash("sha256").update(call.body).digest("hex"));
      assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(call.headers).includes("test-secret-key"), "secret never sent");
      assert.strictEqual(call.headers["content-type"], "image/jpeg");
      assert.ok(res.image!.url.startsWith(`https://media.example.test/tenants/${A}/products/`));
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("R2 refusing the PUT: 502 MEDIA_STORAGE_FAILED, no record, no bucket code, host or message in the reply", async () => {
    setOutboundTransportForTesting(async (): Promise<OutboundResponse> => ({
      status: 403, headers: {}, body: "<Error><Code>AccessDenied</Code><Message>bucket commerceos-media key secret</Message></Error>", truncated: false, durationMs: 3,
    }));
    try {
      const before = (await assetsOf(A)).length;
      const { POST } = await import("@/app/api/v1/media/product-images/route");
      const res = await POST(new Request(`${BASE}/media/product-images`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerA}`, "content-type": "image/jpeg" },
        body: new Uint8Array(makeJpeg(300, 200, "other")),
      }));
      const text = await res.text();
      assert.strictEqual(res.status, 502);
      assert.ok(text.includes("MEDIA_STORAGE_FAILED"));
      for (const leak of ["AccessDenied", "key secret", "acct123", "r2.cloudflarestorage.com"]) assert.ok(!text.includes(leak), `${leak} not echoed`);
      assert.strictEqual((await assetsOf(A)).length, before);
    } finally {
      setOutboundTransportForTesting(null);
      setMediaStorageForTesting(null);
    }
  });

  await runTest("R2 unreachable: 502 without the account host in the reply", async () => {
    setMediaStorageForTesting(r2);
    setOutboundTransportForTesting(async () => {
      throw new Error("connect ECONNREFUSED acct123.r2.cloudflarestorage.com:443");
    });
    try {
      const { POST } = await import("@/app/api/v1/media/product-images/route");
      const res = await POST(new Request(`${BASE}/media/product-images`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerA}`, "content-type": "image/png" },
        body: new Uint8Array(makeSyntheticPng([3, 200, 3], [200, 3, 3])),
      }));
      const text = await res.text();
      assert.strictEqual(res.status, 502);
      assert.ok(!text.includes("acct123") && !text.includes("cloudflarestorage"), text);
    } finally {
      setOutboundTransportForTesting(null);
      setMediaStorageForTesting(createMediaStorageForTesting.local(mediaDir));
    }
  });

  await runTest("per-member hourly limit: the 121st upload is 429, refused before the body is read", async () => {
    resetRateLimitsForTesting();
    const admin = await member(A, "ADMIN");
    const png = makeSyntheticPng([10, 120, 40], [240, 240, 240], 16); // already stored: each one is a cheap reuse
    for (let i = 0; i < MEDIA_LIMITS.uploadsPerUserPerHour; i++) {
      const res = await upload(admin, png);
      assert.ok(res.status === 200 || res.status === 201, `upload ${i + 1}: ${res.status}`);
    }
    assert.strictEqual((await upload(admin, png)).status, 429);
    // Refused on the limit, not on the body: an oversized body still answers 429
    assert.strictEqual((await upload(admin, Buffer.alloc(MEDIA_LIMITS.maxBytes + 10))).status, 429);
    assert.ok([200, 201].includes((await upload(ownerA, png)).status), "another member of the workspace isn't blocked");
    resetRateLimitsForTesting();
  });

  fs.rmSync(mediaDir, { recursive: true, force: true });

  console.log(`\n${ANSI_BOLD}Media upload tests: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
