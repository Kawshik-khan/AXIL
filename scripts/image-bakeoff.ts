/**
 * Image product-search bake-off: vision × image-embedding combos on a labelled dataset → precision at the HIGH band,
 * coverage and latency. Runbook: docs/image-bakeoff.md. Spec: .agent/specs/customer-agent/image-product-search.md §8.
 *
 *   node tests/ts-runner.cjs ./scripts/image-bakeoff.ts --init-sample            write a tiny synthetic dataset
 *   node tests/ts-runner.cjs ./scripts/image-bakeoff.ts --mock                   offline run with mock providers
 *   node tests/ts-runner.cjs ./scripts/image-bakeoff.ts --live                   call the providers in the config
 *
 * Options: --data <dir> (default eval-data/image-bakeoff), --config <file> (default <data>/bakeoff.config.json),
 * --out <dir> (default eval-out/image-bakeoff/<time>), --target 0.95, --min-high 10, --concurrency 2, --no-cache,
 * --gate (exit 1 when no combo meets the target).
 *
 * --live sends dataset images to the hosts in the config. Use images you may share with those providers.
 */
import fs from "node:fs";
import path from "node:path";
import { DatasetError, makeSyntheticPng, Manifest, readManifest } from "@/domains/ai/eval/image-bakeoff/dataset";
import { destinationHosts, mockEmbedding, mockVision, parseBakeoffConfig, providersFromConfig } from "@/domains/ai/eval/image-bakeoff/providers";
import { renderMarkdown, runBakeoff } from "@/domains/ai/eval/image-bakeoff/run";
import { pct } from "@/domains/ai/eval/image-bakeoff/scoring";

const out = (line = "") => process.stdout.write(`${line}\n`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

function numberArg(name: string, fallback: number, min: number, max: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
  return value;
}

const EXAMPLE_CONFIG = {
  vision: [
    {
      id: "gemini-flash",
      kind: "openai-compatible",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "REPLACE-with-a-current-Gemini-Flash-model-id",
      api_key_env: "BAKEOFF_GEMINI_API_KEY",
      json_mode: true,
      note: "Pick the model id from the provider's model list on the day you run.",
    },
    {
      id: "openai-mini",
      kind: "openai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "REPLACE-with-a-current-mini-vision-model-id",
      api_key_env: "BAKEOFF_OPENAI_API_KEY",
      json_mode: true,
    },
  ],
  embedding: [
    {
      id: "siglip2-local",
      kind: "openai-compatible",
      base_url: "http://localhost:7997",
      model: "google/siglip2-base-patch16-384",
      api_key_env: null,
      extra_body: { modality: "image" },
      note: "Self-hosted, e.g. an Infinity server; see docs/image-bakeoff.md.",
    },
    {
      id: "jina-clip-v2",
      kind: "jina",
      base_url: "https://api.jina.ai/v1",
      model: "jina-clip-v2",
      api_key_env: "BAKEOFF_JINA_API_KEY",
    },
  ],
};

/** Four synthetic "products" (striped squares) and a few queries: enough to run the pipeline, nothing more. */
function initSample(dataDir: string): void {
  if (fs.existsSync(path.join(dataDir, "manifest.json"))) throw new Error(`${dataDir} already has a manifest.json; not overwriting it`);
  const colours: Array<[string, [number, number, number], [number, number, number]]> = [
    ["red-saree", [200, 30, 40], [240, 200, 60]],
    ["blue-panjabi", [30, 60, 190], [250, 250, 250]],
    ["green-three-piece", [30, 150, 70], [250, 180, 200]],
    ["black-sneakers", [20, 20, 20], [230, 230, 230]],
  ];
  fs.mkdirSync(path.join(dataDir, "catalog"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "queries"), { recursive: true });
  const catalog: Manifest["catalog"] = colours.map(([name, a, b], i) => {
    fs.writeFileSync(path.join(dataDir, "catalog", `${name}-1.png`), makeSyntheticPng(a, b));
    fs.writeFileSync(path.join(dataDir, "catalog", `${name}-2.png`), makeSyntheticPng(a, b, 24));
    return { product_id: `p${i + 1}`, name, sku: `KR-10${i + 1}`, variants: [], images: [{ file: `catalog/${name}-1.png` }, { file: `catalog/${name}-2.png` }] };
  });
  colours.forEach(([name, a, b]) => fs.writeFileSync(path.join(dataDir, "queries", `${name}.png`), makeSyntheticPng(a, b)));
  fs.writeFileSync(path.join(dataDir, "queries", "not-ours.png"), makeSyntheticPng([120, 60, 10], [10, 200, 200]));
  const queries: Manifest["queries"] = [
    ...colours.map(([name], i) => ({ id: `q${i + 1}`, file: `queries/${name}.png`, expected_kind: "product" as const, expected_product_id: `p${i + 1}`, tags: ["exact_catalog_photo"] })),
    { id: "q5", file: "queries/not-ours.png", expected_kind: "product", expected_product_id: null, tags: ["not_ours"] },
  ];
  const manifest: Manifest = { version: 1, shop: "Synthetic sample (not real data)", catalog, queries };
  fs.writeFileSync(path.join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const configFile = path.join(dataDir, "bakeoff.config.example.json");
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, `${JSON.stringify(EXAMPLE_CONFIG, null, 2)}\n`);
  out(`Sample dataset written to ${dataDir} (synthetic images; replace them with real ones, see docs/image-bakeoff.md).`);
  out(`Example provider config: ${configFile} (copy to bakeoff.config.json and fill in model ids).`);
}

async function main(): Promise<void> {
  const dataDir = path.resolve(arg("--data") ?? path.join("eval-data", "image-bakeoff"));
  if (flag("--init-sample")) return initSample(dataDir);

  const mock = flag("--mock");
  const live = flag("--live");
  if (mock === live) throw new Error("choose exactly one of --mock (offline) or --live (calls the providers in the config)");

  const manifest = readManifest(dataDir);
  let providers;
  if (mock) {
    providers = { vision: [mockVision()], embedding: [mockEmbedding()] };
  } else {
    const configFile = path.resolve(arg("--config") ?? path.join(dataDir, "bakeoff.config.json"));
    if (!fs.existsSync(configFile)) throw new Error(`no provider config at ${configFile} (start from bakeoff.config.example.json)`);
    const config = parseBakeoffConfig(JSON.parse(fs.readFileSync(configFile, "utf8")));
    providers = providersFromConfig(config);
    const images = manifest.catalog.reduce((n, p) => n + p.images.length, 0);
    out(`Live run: ${config.vision.length} vision × ${config.embedding.length} embedding models.`);
    out(`Up to ${config.vision.length * manifest.queries.length} vision calls and ${config.embedding.length * (images + manifest.queries.length)} embedding calls (cached results are reused).`);
    out(`Images (metadata removed) will be sent to: ${destinationHosts(config).join(", ")}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(arg("--out") ?? path.join("eval-out", "image-bakeoff", `${mock ? "mock-" : ""}${stamp}`));
  const report = await runBakeoff({
    datasetDir: dataDir,
    manifest,
    vision: providers.vision,
    embedding: providers.embedding,
    targetPrecision: numberArg("--target", 0.95, 0.5, 1),
    minHigh: numberArg("--min-high", 10, 1, 10_000),
    concurrency: numberArg("--concurrency", 2, 1, 16),
    cacheDir: flag("--no-cache") ? undefined : path.join(dataDir, ".bakeoff-cache"),
    mock,
    onProgress: (message) => out(`  ${message}`),
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "report.md"), renderMarkdown(report));

  out("");
  for (const w of report.warnings) out(`WARNING: ${w}`);
  for (const c of report.combos) {
    const m = c.metrics;
    out(
      `${c.meets_target ? "PASS" : "----"}  ${c.vision_id} × ${c.embedding_id}: precision@HIGH ${pct(m.high.precision)} (95% low ${pct(m.high.precision_lower_95)}, ${m.high.count} HIGH), coverage ${pct(m.high.coverage)}, p95 ${m.latency_ms.parallel.p95 ?? "n/a"} ms`,
    );
  }
  out(`\nReport: ${path.join(outDir, "report.md")}`);
  if (flag("--gate") && !report.combos.some((c) => c.meets_target)) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof DatasetError ? "Dataset error: " : "Error: "}${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
