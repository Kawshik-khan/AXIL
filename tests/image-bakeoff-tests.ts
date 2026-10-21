// Image product-search bake-off harness (docs/image-bakeoff.md): dataset checks, metadata removal, band rules,
// calibration, metrics, provider clients (through a fake transport) and an end-to-end run with mock providers.
import assert from "assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DatasetError,
  loadImage,
  makeSyntheticPng,
  Manifest,
  sniffImageMime,
  stripImageMetadata,
  validateManifest,
} from "@/domains/ai/eval/image-bakeoff/dataset";
import {
  httpEmbedding,
  mockEmbedding,
  mockVision,
  openAiCompatibleVision,
  parseBakeoffConfig,
  parseVisionOutput,
  ProviderCallError,
  VisionOutput,
} from "@/domains/ai/eval/image-bakeoff/providers";
import { renderMarkdown, runBakeoff } from "@/domains/ai/eval/image-bakeoff/run";
import {
  buildSkuIndex,
  calibrate,
  decide,
  measure,
  normalizeSku,
  QueryObservation,
  rankProducts,
  wilsonLower,
} from "@/domains/ai/eval/image-bakeoff/scoring";
import { OutboundResponse, setOutboundTransportForTesting } from "@/lib/outbound-http";

let passed = 0;
let failed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    passed++;
    console.log(`  ✓ PASS - ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ FAIL - ${name}`, error);
  }
}

const catalog: Manifest["catalog"] = [
  { product_id: "p1", name: "Red saree", sku: "KR-101", variants: [{ variant_id: "v1", sku: "KR-101-RED" }], images: [{ file: "c/p1.png", variant_id: "v1" }] },
  { product_id: "p2", name: "Blue panjabi", sku: "KR-102", variants: [], images: [{ file: "c/p2.png" }] },
  { product_id: "p3", name: "Twin of p2", sku: "KR-102", variants: [], images: [{ file: "c/p3.png" }] },
];

function query(id: string, expected: string | null, extra: Partial<Manifest["queries"][number]> = {}): Manifest["queries"][number] {
  return { id, file: `q/${id}.png`, expected_kind: "product", expected_product_id: expected, tags: [], ...extra };
}

const productVision = (sku: string[] = [], kind: VisionOutput["kind"] = "product"): VisionOutput => ({
  kind, category: null, colors: [], text_in_image: null, sku_candidates: sku,
});

function obs(q: Manifest["queries"][number], ranked: Array<[string, number]> | null, vision: VisionOutput | null = productVision()): QueryObservation {
  return {
    query: q,
    vision: { output: vision, error: vision ? null : "TRANSPORT: down", latency_ms: vision ? 900 : null },
    embedding: { ranked: ranked && ranked.map(([product_id, score]) => ({ product_id, variant_id: null, score })), error: null, latency_ms: 100 },
  };
}

async function main() {
  console.log("\nImage bake-off tests\n");

  await test("manifest: cross-checks products, variants, kinds and splits", () => {
    const ok = validateManifest({ version: 1, catalog, queries: [query("a", "p1", { expected_variant_id: "v1" }), query("b", null)] });
    assert.strictEqual(ok.queries[0].tags.length, 0);
    assert.throws(() => validateManifest({ version: 1, catalog, queries: [query("a", "p9")] }), /not in the catalog/);
    assert.throws(() => validateManifest({ version: 1, catalog, queries: [query("a", "p1", { expected_kind: "payment_proof" })] }), /can't expect a product/);
    assert.throws(() => validateManifest({ version: 1, catalog, queries: [query("a", "p2", { expected_variant_id: "v1" })] }), /not a variant/);
    assert.throws(() => validateManifest({ version: 1, catalog, queries: [query("a", "p1", { split: "test" }), query("b", "p2")] }), /every query needs one/);
    assert.throws(() => validateManifest({ version: 1, catalog, queries: [query("a", "p1")], extra: true }), /invalid/);
  });

  await test("images: path traversal, wrong type and size are refused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
    fs.writeFileSync(path.join(dir, "note.png"), "not an image");
    assert.throws(() => loadImage(dir, "../outside.png"), /leaves the dataset directory/);
    assert.throws(() => loadImage(dir, "note.png"), /not a JPEG, PNG or WebP/);
    assert.throws(() => loadImage(dir, "missing.png"), DatasetError);
    fs.writeFileSync(path.join(dir, "big.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.throws(() => loadImage(dir, "big.png"), /over the 5 MB limit/);
  });

  await test("metadata: EXIF/comments removed from JPEG, PNG and WebP; image data kept", () => {
    const seg = (marker: number, payload: Buffer) => {
      const head = Buffer.from([0xff, marker, 0, 0]);
      head.writeUInt16BE(payload.length + 2, 2);
      return Buffer.concat([head, payload]);
    };
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe0, Buffer.from("JFIF\0")),
      seg(0xe1, Buffer.from("Exif\0\0GPS-SECRET")),
      seg(0xfe, Buffer.from("comment")),
      seg(0xe2, Buffer.from("ICC_PROFILE")),
      Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]),
    ]);
    assert.strictEqual(sniffImageMime(jpeg), "image/jpeg");
    const cleanJpeg = stripImageMetadata(jpeg, "image/jpeg");
    assert.ok(!cleanJpeg.includes("GPS-SECRET") && !cleanJpeg.includes("comment"));
    assert.ok(cleanJpeg.includes("ICC_PROFILE") && cleanJpeg.includes("JFIF"), "colour profile kept");
    assert.ok(cleanJpeg.subarray(-4).equals(Buffer.from([0x11, 0x22, 0xff, 0xd9])), "scan data kept");

    const png = makeSyntheticPng([1, 2, 3], [4, 5, 6], 8, "SECRET-ADDRESS");
    const cleanPng = stripImageMetadata(png, "image/png");
    assert.ok(png.includes("SECRET-ADDRESS") && !cleanPng.includes("SECRET-ADDRESS"));
    assert.ok(cleanPng.includes("IDAT") && cleanPng.subarray(-8, -4).toString("latin1") === "IEND");

    const chunk = (fourcc: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.write(fourcc, 0, "latin1");
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x20; // EXIF + XMP + ICC
    const body = Buffer.concat([chunk("VP8X", vp8x), chunk("ICCP", Buffer.from("icc")), chunk("VP8L", Buffer.from("pixels")), chunk("EXIF", Buffer.from("GPS-SECRET")), chunk("XMP ", Buffer.from("<xmp/>"))]);
    const riff = Buffer.alloc(12);
    riff.write("RIFF", 0, "latin1");
    riff.writeUInt32LE(body.length + 4, 4);
    riff.write("WEBP", 8, "latin1");
    const webp = Buffer.concat([riff, body]);
    assert.strictEqual(sniffImageMime(webp), "image/webp");
    const cleanWebp = stripImageMetadata(webp, "image/webp");
    assert.ok(!cleanWebp.includes("GPS-SECRET") && !cleanWebp.includes("<xmp/>") && cleanWebp.includes("pixels"));
    assert.strictEqual(cleanWebp.readUInt32LE(4), cleanWebp.length - 8, "RIFF size updated");
    assert.strictEqual(cleanWebp[20], 0x20, "EXIF/XMP flags cleared, ICC flag kept");
  });

  await test("product codes: Bangla digits, prefixes and separators normalise; shared codes never match", () => {
    assert.strictEqual(normalizeSku("kr-১০১"), "KR101");
    assert.strictEqual(normalizeSku("Code: KR 101"), "KR101");
    const index = buildSkuIndex(catalog);
    assert.deepStrictEqual(index.get("kr101"), { product_id: "p1", variant_id: null });
    assert.deepStrictEqual(index.get("KR-101-RED"), { product_id: "p1", variant_id: "v1" });
    assert.strictEqual(index.get("KR-102"), null, "p2 and p3 share KR-102: ambiguous");
  });

  await test("bands: non-product, code hit, clear visual win, close call, miss", () => {
    const sku = buildSkuIndex(catalog);
    const t = { t_high: 0.8, margin: 0.05, t_low: 0.5 };
    assert.strictEqual(decide(obs(query("a", null), [["p1", 0.99]], productVision([], "payment_proof")), sku, t).source, "non_product");
    const code = decide(obs(query("a", "p1"), [["p2", 0.3]], productVision(["KR-101"])), sku, t);
    assert.strictEqual(code.band, "HIGH");
    assert.strictEqual(code.product_id, "p1", "an exact code beats a low visual score");
    assert.strictEqual(decide(obs(query("a", "p1"), [["p1", 0.9], ["p2", 0.6]]), sku, t).band, "HIGH");
    const close = decide(obs(query("a", "p1"), [["p1", 0.9], ["p2", 0.88], ["p3", 0.7], ["p4", 0.4]]), sku, t);
    assert.strictEqual(close.band, "MEDIUM", "a close runner-up is a question, not an answer");
    assert.deepStrictEqual(close.candidates.map((c) => c.product_id), ["p1", "p2", "p3"]);
    assert.strictEqual(decide(obs(query("a", null), [["p1", 0.3]]), sku, t).band, "NONE");
    assert.strictEqual(decide(obs(query("a", "p1"), [["p1", 0.95]], null), sku, t).band, "HIGH", "a failed vision call still allows a visual match");
  });

  await test("ranking: a product scores by its best image", () => {
    const ranked = rankProducts([1, 0], [
      { product_id: "p1", variant_id: null, vector: [0, 1] },
      { product_id: "p1", variant_id: "v1", vector: [0.8, 0.6] },
      { product_id: "p2", variant_id: null, vector: [0.6, 0.8] },
    ]);
    assert.deepStrictEqual(ranked.map((r) => [r.product_id, r.variant_id]), [["p1", "v1"], ["p2", null]]);
    assert.throws(() => rankProducts([1, 0, 0], [{ product_id: "p1", variant_id: null, vector: [1, 0] }]), /size mismatch/);
  });

  await test("calibration: picks the loosest threshold that keeps the target precision", () => {
    const sku = buildSkuIndex(catalog);
    const set: QueryObservation[] = [
      obs(query("a", "p1"), [["p1", 0.95], ["p2", 0.5]]),
      obs(query("b", "p2"), [["p2", 0.9], ["p1", 0.5]]),
      obs(query("c", "p1"), [["p1", 0.85], ["p2", 0.5]]),
      obs(query("d", "p2"), [["p1", 0.8], ["p2", 0.5]]), // wrong product at 0.8
      obs(query("e", null), [["p1", 0.6], ["p2", 0.2]]), // not ours
    ];
    const cal = calibrate(set, sku, 0.95, 3);
    assert.ok(cal.feasible);
    assert.strictEqual(cal.thresholds.t_high, 0.85, "0.8 would admit the wrong answer");
    assert.ok(cal.thresholds.t_low > 0.6 && cal.thresholds.t_low <= 0.85, "t_low separates the not-ours photo");
    const strict = calibrate(set, sku, 0.95, 4);
    assert.strictEqual(strict.feasible, false, "4 HIGH answers can't be had at 95%");
    assert.strictEqual(strict.thresholds.t_high, Number.POSITIVE_INFINITY);
  });

  await test("metrics: precision, coverage, false HIGH kinds, OCR, latency, tags", () => {
    const sku = buildSkuIndex(catalog);
    const set: QueryObservation[] = [
      obs(query("a", "p1", { tags: ["screenshot"], expected_sku: "KR-101", expected_variant_id: "v1" }), [["p2", 0.4]], productVision(["KR101-RED"])),
      obs(query("b", "p2", { tags: ["customer_photo"] }), [["p2", 0.9], ["p1", 0.3]]),
      obs(query("c", "p2", { tags: ["customer_photo"] }), [["p1", 0.92], ["p2", 0.2]]),
      obs(query("d", null, { tags: ["not_ours"] }), [["p1", 0.91], ["p2", 0.1]]),
      obs(query("e", null, { expected_kind: "payment_proof" }), [["p1", 0.99]], productVision([], "payment_proof")),
    ];
    const m = measure(set, sku, { t_high: 0.85, margin: 0.05, t_low: 0.5 });
    assert.strictEqual(m.high.count, 4);
    assert.strictEqual(m.high.correct, 2);
    assert.strictEqual(m.high.precision, 0.5);
    assert.strictEqual(m.high.wrong_product, 1);
    assert.strictEqual(m.high.on_not_ours, 1);
    assert.strictEqual(m.high.on_non_product, 0, "the payment screenshot was routed, not matched");
    assert.strictEqual(m.high.coverage, 1, "3 of 3 in-catalog queries answered HIGH");
    assert.strictEqual(m.high.from_sku.correct, 1);
    assert.strictEqual(m.variant_accuracy_at_high, 1);
    assert.strictEqual(m.sku_ocr.read, 0, "KR101-RED is not the labelled KR-101");
    assert.strictEqual(m.kind.accuracy, 1);
    assert.strictEqual(m.top1_accuracy, 1 / 3);
    assert.strictEqual(m.latency_ms.parallel.p95, 900);
    assert.strictEqual(m.latency_ms.sequential.p50, 1000);
    assert.strictEqual(m.by_tag.customer_photo.high_correct, 1);
    assert.ok(Math.abs(wilsonLower(19, 20) - 0.7639) < 0.001, "Wilson lower bound");
  });

  await test("config: keys only from BAKEOFF_* variables; no keys or queries in URLs", () => {
    const base = { vision: [{ id: "v", kind: "openai-compatible", base_url: "https://api.example.com/v1", model: "m", api_key_env: "BAKEOFF_V" }], embedding: [{ id: "e", kind: "jina", base_url: "https://api.jina.ai/v1", model: "m", api_key_env: null }] };
    assert.strictEqual(parseBakeoffConfig(base).vision[0].json_mode, true);
    assert.throws(() => parseBakeoffConfig({ ...base, vision: [{ ...base.vision[0], api_key_env: "JWT_SECRET" }] }), /BAKEOFF_/);
    assert.throws(() => parseBakeoffConfig({ ...base, vision: [{ ...base.vision[0], base_url: "https://api.example.com/v1?key=abc" }] }), /without credentials, query/);
    assert.throws(() => parseBakeoffConfig({ ...base, vision: [{ ...base.vision[0], base_url: "https://user:pw@api.example.com" }] }), /without credentials/);
    assert.throws(() => parseBakeoffConfig({ ...base, embedding: [{ ...base.embedding[0], id: "v" }] }), /unique/);
  });

  await test("vision reply parsing: fences and extra keys tolerated, bad kinds refused, fields capped", () => {
    const parsed = parseVisionOutput('```json\n{"kind":"Product","category":"saree","colors":["red"],"text_in_image":"' + "x".repeat(400) + '","sku_candidates":["KR-101",5],"extra":1}\n```', "v");
    assert.strictEqual(parsed.kind, "product");
    assert.strictEqual(parsed.text_in_image?.length, 300);
    assert.deepStrictEqual(parsed.sku_candidates, ["KR-101"]);
    assert.throws(() => parseVisionOutput('{"kind":"shoe"}', "v"), (e: unknown) => e instanceof ProviderCallError && e.code === "INVALID_OUTPUT");
    assert.throws(() => parseVisionOutput("Sure! It is a saree.", "v"), /not JSON/);
  });

  await test("provider clients: request shape, bearer key from env, retry on 429, errors without bodies", async () => {
    const image = { file: "x.png", mime: "image/png" as const, bytes: makeSyntheticPng([1, 1, 1], [2, 2, 2], 4), sha256: "abc" };
    const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    let visionCalls = 0;
    setOutboundTransportForTesting(async (url, options): Promise<OutboundResponse> => {
      seen.push({ url: url.toString(), headers: options.headers ?? {}, body: JSON.parse(String(options.body)) });
      const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, body: JSON.stringify(body), truncated: false, durationMs: 5 });
      if (url.pathname.endsWith("/chat/completions")) {
        visionCalls++;
        if (visionCalls === 1) return reply(429, { error: { message: "slow down" } }, { "retry-after": "0.01" });
        return reply(200, { choices: [{ message: { content: '{"kind":"product","colors":[],"sku_candidates":[]}' } }], usage: { prompt_tokens: 1200, completion_tokens: 40 } });
      }
      if (url.hostname === "api.jina.ai") return reply(200, { data: [{ embedding: [3, 4] }] });
      return reply(500, { error: { message: "model not loaded" }, secret_echo: "do-not-print" });
    });
    process.env.BAKEOFF_TEST_KEY = "test-key-value";
    try {
      const vision = openAiCompatibleVision(parseBakeoffConfig({
        vision: [{ id: "v", kind: "openai-compatible", base_url: "https://vision.example.com/v1/", model: "vm", api_key_env: "BAKEOFF_TEST_KEY" }],
        embedding: [{ id: "e", kind: "jina", base_url: "https://api.jina.ai/v1", model: "jina-clip-v2", api_key_env: null }],
      }).vision[0]);
      const r = await vision.analyse(image);
      assert.strictEqual(r.retries, 1);
      assert.deepStrictEqual(r.usage, { input_tokens: 1200, output_tokens: 40 });
      const call = seen[seen.length - 1];
      assert.strictEqual(call.url, "https://vision.example.com/v1/chat/completions");
      assert.strictEqual(call.headers.authorization, "Bearer test-key-value");
      const parts = (call.body.messages as Array<{ content: unknown }>)[1].content as Array<{ type: string; image_url?: { url: string } }>;
      assert.ok(parts[1].image_url?.url.startsWith("data:image/png;base64,"));
      assert.deepStrictEqual(call.body.response_format, { type: "json_object" });

      const jina = httpEmbedding({ id: "e", kind: "jina", base_url: "https://api.jina.ai/v1", model: "jina-clip-v2", api_key_env: null, extra_body: {}, timeout_ms: 1000 });
      const e = await jina.embed(image);
      assert.deepStrictEqual(e.value, [0.6, 0.8], "vectors are L2-normalised");
      assert.strictEqual(seen[seen.length - 1].headers.authorization, undefined);
      assert.ok(typeof (seen[seen.length - 1].body.input as Array<{ image: string }>)[0].image === "string");

      const local = httpEmbedding({ id: "l", kind: "openai-compatible", base_url: "http://localhost:7997", model: "siglip", api_key_env: null, extra_body: { modality: "image", model: "override-attempt" }, timeout_ms: 1000 });
      await assert.rejects(local.embed(image), (err: unknown) => err instanceof ProviderCallError && err.code === "HTTP_ERROR" && /model not loaded/.test(err.message) && !/do-not-print/.test(err.message));
      assert.strictEqual(seen[seen.length - 1].body.modality, "image");
      assert.strictEqual(seen[seen.length - 1].body.model, "siglip", "extra_body can't override the model");
    } finally {
      setOutboundTransportForTesting(null);
      delete process.env.BAKEOFF_TEST_KEY;
    }
  });

  await test("end to end with mock providers: report, split, cache reuse, markdown", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
    fs.mkdirSync(path.join(dir, "c"));
    fs.mkdirSync(path.join(dir, "q"));
    const colours: Array<[number, number, number]> = [[200, 0, 0], [0, 0, 200], [0, 150, 0], [90, 90, 90]];
    const products: Manifest["catalog"] = colours.map((c, i) => {
      fs.writeFileSync(path.join(dir, "c", `p${i}.png`), makeSyntheticPng(c, [255, 255, 255]));
      return { product_id: `p${i}`, name: `Product ${i}`, sku: `SK-${i}`, variants: [], images: [{ file: `c/p${i}.png` }] };
    });
    const queries: Manifest["queries"] = [];
    colours.forEach((c, i) => {
      for (const split of ["calibration", "test"] as const) {
        const file = `q/${split}-${i}.png`;
        fs.writeFileSync(path.join(dir, file), makeSyntheticPng(c, [255, 255, 255]));
        queries.push({ id: `${split}-${i}`, file, expected_kind: "product", expected_product_id: `p${i}`, tags: ["exact"], split });
      }
    });
    fs.writeFileSync(path.join(dir, "q", "pay.png"), makeSyntheticPng([10, 10, 10], [0, 0, 0]));
    queries.push({ id: "pay", file: "q/pay.png", expected_kind: "payment_proof", expected_product_id: null, tags: ["payment"], split: "test" });
    const manifest = validateManifest({ version: 1, catalog: products, queries });

    const payment = loadImage(dir, "q/pay.png").sha256;
    const vision = mockVision("mv", (img) => productVision([], img.sha256 === payment ? "payment_proof" : "product"));
    const cacheDir = path.join(dir, ".cache");
    const options = { datasetDir: dir, manifest, vision: [vision], embedding: [mockEmbedding("me")], minHigh: 2, cacheDir, mock: true };
    const first = await runBakeoff(options);
    // Query photos here are byte-identical to catalog photos: embedding 4 catalog + 1 payment, vision 4 + 1.
    assert.strictEqual(first.calls.made, 10, "an image is sent to a provider once, however often it appears");
    const combo = first.combos[0];
    assert.strictEqual(combo.calibrated_on, "calibration split");
    assert.strictEqual(combo.metrics.queries, 5, "measured on the test split only");
    assert.strictEqual(combo.metrics.high.precision, 1);
    assert.strictEqual(combo.metrics.high.on_non_product, 0);
    assert.ok(combo.meets_target);
    assert.ok(first.warnings.some((w) => w.includes("MOCK")));

    const second = await runBakeoff(options);
    assert.strictEqual(second.calls.made, 0, "second run is served from the cache");
    const md = renderMarkdown(second);
    assert.ok(md.includes("MOCK") && md.includes("mv × me") && md.includes("| exact |"));
    assert.ok(!JSON.stringify(second).includes("base64"), "the report carries no image data");
  });

  console.log(`\nImage bake-off tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
