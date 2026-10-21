/**
 * Runs the image bake-off: every vision model × every embedding model on one labelled dataset, then reports
 * precision at the HIGH band, coverage and latency per combo (runbook: docs/image-bakeoff.md).
 *
 * Calls: each vision model sees every query once, each embedding model embeds every catalog and query image once;
 * combos are scored from those results, so V vision × E embedding models cost V·Q + E·(C+Q) calls, not V·E·(…).
 * Results are cached per provider and image hash, so changing thresholds or adding a model doesn't repeat calls.
 */
import fs from "node:fs";
import path from "node:path";
import { BakeoffQuery, LoadedImage, loadImage, Manifest } from "./dataset";
import { CallResult, EmbeddingProvider, ProviderCallError, Usage, VisionOutput, VisionProvider } from "./providers";
import {
  buildSkuIndex,
  calibrate,
  Calibration,
  CatalogVector,
  ComboMetrics,
  measure,
  pct,
  QueryObservation,
  rankProducts,
} from "./scoring";

export interface BakeoffOptions {
  datasetDir: string;
  manifest: Manifest;
  vision: VisionProvider[];
  embedding: EmbeddingProvider[];
  /** Precision the HIGH band must reach (spec KPI: 0.95). */
  targetPrecision?: number;
  /** Fewest HIGH answers a threshold must produce on the calibration set. */
  minHigh?: number;
  concurrency?: number;
  /** Directory for cached provider results; omit to call every provider fresh. */
  cacheDir?: string;
  /** True when the providers are the offline mocks: the report says the numbers mean nothing. */
  mock?: boolean;
  onProgress?: (message: string) => void;
}

export interface ComboResult {
  vision_id: string;
  embedding_id: string;
  calibration: Calibration;
  calibrated_on: "calibration split" | "same queries (optimistic)";
  metrics: ComboMetrics;
  meets_target: boolean;
}

export interface BakeoffReport {
  generated_at: string;
  mock: boolean;
  shop: string | null;
  target_precision: number;
  min_high: number;
  dataset: { catalog_products: number; catalog_images: number; queries: number; evaluated_queries: number; split: boolean };
  catalog_index: Record<string, { images: number; errors: number; mean_latency_ms: number | null }>;
  calls: { made: number; from_cache: number };
  combos: ComboResult[];
  warnings: string[];
}

interface Cached<T> {
  value: T | null;
  error: string | null;
  latency_ms: number | null;
  usage?: Usage;
}

class ResultCache {
  private readonly stores = new Map<string, Record<string, Cached<unknown>>>();
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>();
  made = 0;
  hits = 0;

  constructor(private readonly dir: string | undefined) {}

  /** Identical images (same hash) share one call, also when they are requested at the same time. */
  async get<T>(providerKey: string, image: LoadedImage, call: () => Promise<CallResult<T>>): Promise<Cached<T>> {
    const store = this.store(providerKey);
    const existing = store[image.sha256] as Cached<T> | undefined;
    // Transport errors and rate limits are retried on the next run; a bad answer is a result and stays cached.
    if (existing && !(existing.error && !existing.error.startsWith("INVALID_OUTPUT"))) {
      this.hits++;
      return existing;
    }
    const key = `${providerKey}/${image.sha256}`;
    const pending = this.inflight.get(key) as Promise<Cached<T>> | undefined;
    if (pending) {
      this.hits++;
      return pending;
    }
    const promise = this.call(store, image.sha256, call);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async call<T>(store: Record<string, Cached<unknown>>, sha256: string, call: () => Promise<CallResult<T>>): Promise<Cached<T>> {
    this.made++;
    let result: Cached<T>;
    try {
      const r = await call();
      result = { value: r.value, error: null, latency_ms: r.latency_ms, usage: r.usage };
    } catch (err) {
      const code = err instanceof ProviderCallError ? err.code : "ERROR";
      result = { value: null, error: `${code}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300), latency_ms: null };
    }
    store[sha256] = result;
    return result;
  }

  flush(): void {
    if (!this.dir) return;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const [key, store] of this.stores) fs.writeFileSync(path.join(this.dir, `${key}.json`), JSON.stringify(store));
  }

  private store(key: string): Record<string, Cached<unknown>> {
    let store = this.stores.get(key);
    if (!store) {
      const file = this.dir ? path.join(this.dir, `${key}.json`) : null;
      store = file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Cached<unknown>>) : {};
      this.stores.set(key, store);
    }
    return store;
  }
}

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(workers);
}

export async function runBakeoff(options: BakeoffOptions): Promise<BakeoffReport> {
  const target = options.targetPrecision ?? 0.95;
  const minHigh = options.minHigh ?? 10;
  const concurrency = options.concurrency ?? 2;
  const progress = options.onProgress ?? (() => undefined);
  const { manifest, datasetDir } = options;
  const warnings: string[] = [];
  const cache = new ResultCache(options.cacheDir);

  // Load every image first: a broken dataset fails before any call is made.
  const catalogImages = manifest.catalog.flatMap((p) => p.images.map((img) => ({ product_id: p.product_id, variant_id: img.variant_id ?? null, image: loadImage(datasetDir, img.file) })));
  const queryImages = new Map<string, LoadedImage>(manifest.queries.map((q) => [q.id, loadImage(datasetDir, q.file)]));

  const catalogIndex: BakeoffReport["catalog_index"] = {};
  const catalogVectors = new Map<string, CatalogVector[]>();
  for (const provider of options.embedding) {
    progress(`embedding ${catalogImages.length} catalog images with ${provider.id}`);
    const vectors: CatalogVector[] = [];
    const latencies: number[] = [];
    let errors = 0;
    await pool(catalogImages, concurrency, async (item) => {
      const r = await cache.get(provider.cacheKey, item.image, () => provider.embed(item.image));
      if (r.value) vectors.push({ product_id: item.product_id, variant_id: item.variant_id, vector: r.value as number[] });
      else errors++;
      if (r.latency_ms !== null) latencies.push(r.latency_ms);
    });
    if (errors) warnings.push(`${provider.id}: ${errors} catalog image(s) could not be embedded and are missing from its index`);
    catalogIndex[provider.id] = {
      images: vectors.length,
      errors,
      mean_latency_ms: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    };
    catalogVectors.set(provider.id, vectors);
  }

  const visionResults = new Map<string, Map<string, Cached<VisionOutput>>>();
  for (const provider of options.vision) {
    progress(`analysing ${manifest.queries.length} query images with ${provider.id}`);
    const results = new Map<string, Cached<VisionOutput>>();
    await pool(manifest.queries, concurrency, async (q) => {
      const image = queryImages.get(q.id)!;
      results.set(q.id, await cache.get(provider.cacheKey, image, () => provider.analyse(image)));
    });
    visionResults.set(provider.id, results);
  }

  const queryVectors = new Map<string, Map<string, Cached<number[]>>>();
  for (const provider of options.embedding) {
    progress(`embedding ${manifest.queries.length} query images with ${provider.id}`);
    const results = new Map<string, Cached<number[]>>();
    await pool(manifest.queries, concurrency, async (q) => {
      const image = queryImages.get(q.id)!;
      results.set(q.id, await cache.get(provider.cacheKey, image, () => provider.embed(image)));
    });
    queryVectors.set(provider.id, results);
  }
  cache.flush();

  const split = manifest.queries.some((q) => q.split);
  const isCalibration = (q: BakeoffQuery) => q.split === "calibration";
  if (!split) warnings.push("no calibration/test split: thresholds are tuned and measured on the same queries, so precision is optimistic");

  const sku = buildSkuIndex(manifest.catalog);
  const combos: ComboResult[] = [];
  for (const vision of options.vision) {
    for (const embedding of options.embedding) {
      const index = catalogVectors.get(embedding.id)!;
      const observations: QueryObservation[] = manifest.queries.map((query) => {
        const v = visionResults.get(vision.id)!.get(query.id)!;
        const e = queryVectors.get(embedding.id)!.get(query.id)!;
        let ranked = e.value && index.length ? rankProducts(e.value, index) : null;
        let error = e.error;
        if (e.value && !index.length) error = "NO_INDEX: no catalog image was embedded";
        if (ranked && !ranked.length) ranked = null;
        return {
          query,
          vision: { output: v.value, error: v.error, latency_ms: v.latency_ms, usage: v.usage },
          embedding: { ranked, error, latency_ms: e.latency_ms },
        };
      });
      const calibrationSet = split ? observations.filter((o) => isCalibration(o.query)) : observations;
      const evaluationSet = split ? observations.filter((o) => !isCalibration(o.query)) : observations;
      const calibration = calibrate(calibrationSet, sku, target, minHigh);
      const metrics = measure(evaluationSet, sku, calibration.thresholds);
      combos.push({
        vision_id: vision.id,
        embedding_id: embedding.id,
        calibration,
        calibrated_on: split ? "calibration split" : "same queries (optimistic)",
        metrics,
        meets_target: metrics.high.precision !== null && metrics.high.precision >= target && metrics.high.count >= Math.min(minHigh, metrics.in_catalog),
      });
    }
  }
  combos.sort(
    (a, b) =>
      Number(b.meets_target) - Number(a.meets_target) ||
      (b.metrics.high.coverage ?? 0) - (a.metrics.high.coverage ?? 0) ||
      (a.metrics.latency_ms.parallel.p95 ?? Infinity) - (b.metrics.latency_ms.parallel.p95 ?? Infinity),
  );

  const evaluated = split ? manifest.queries.filter((q) => !isCalibration(q)).length : manifest.queries.length;
  if (evaluated < 100) warnings.push(`${evaluated} evaluated queries: one wrong answer moves precision by ${(100 / Math.max(1, evaluated)).toFixed(1)} points or more; read the 95% lower bound`);
  if (options.mock) warnings.push("MOCK providers: these numbers test the harness, not any model");

  return {
    generated_at: new Date().toISOString(),
    mock: options.mock === true,
    shop: manifest.shop ?? null,
    target_precision: target,
    min_high: minHigh,
    dataset: {
      catalog_products: manifest.catalog.length,
      catalog_images: catalogImages.length,
      queries: manifest.queries.length,
      evaluated_queries: evaluated,
      split,
    },
    catalog_index: catalogIndex,
    calls: { made: cache.made, from_cache: cache.hits },
    combos,
    warnings,
  };
}

// ---- Report ------------------------------------------------------------------------------------------------------------

function ms(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value)}`;
}

function threshold(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "off";
}

export function renderMarkdown(report: BakeoffReport): string {
  const lines: string[] = [];
  lines.push(`# Image product-search bake-off${report.mock ? " (MOCK — not a model result)" : ""}`);
  lines.push("");
  lines.push(`Generated ${report.generated_at}${report.shop ? ` for ${report.shop}` : ""}. Target: HIGH-band precision ≥ ${pct(report.target_precision)} with at least ${report.min_high} HIGH answers.`);
  lines.push(
    `Dataset: ${report.dataset.catalog_products} products / ${report.dataset.catalog_images} catalog images; ${report.dataset.queries} queries, ${report.dataset.evaluated_queries} evaluated (${report.dataset.split ? "held-out test split" : "no split"}). Provider calls: ${report.calls.made} made, ${report.calls.from_cache} from cache.`,
  );
  lines.push("");
  if (report.warnings.length) {
    lines.push("**Warnings**");
    lines.push("");
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  lines.push("## Summary");
  lines.push("");
  lines.push("| Vision × Embedding | Meets target | Precision@HIGH (95% low) | HIGH answers | Coverage | Top-1 | Recall@3 | Wrong HIGH (wrong product / not ours / non-product) | Kind acc. | Code OCR | p50 / p95 ms (parallel) | p95 ms (sequential) | Errors (vision / embed) |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of report.combos) {
    const m = c.metrics;
    lines.push(
      `| ${c.vision_id} × ${c.embedding_id} | ${c.meets_target ? "yes" : "no"} | ${pct(m.high.precision)} (${pct(m.high.precision_lower_95)}) | ${m.high.count} | ${pct(m.high.coverage)} | ${pct(m.top1_accuracy)} | ${pct(m.recall_at_3)} | ${m.high.wrong_product} / ${m.high.on_not_ours} / ${m.high.on_non_product} | ${pct(m.kind.accuracy)} | ${m.sku_ocr.labelled ? `${m.sku_ocr.read}/${m.sku_ocr.labelled}` : "n/a"} | ${ms(m.latency_ms.parallel.p50)} / ${ms(m.latency_ms.parallel.p95)} | ${ms(m.latency_ms.sequential.p95)} | ${m.errors.vision} / ${m.errors.embedding} |`,
    );
  }
  lines.push("");
  lines.push("Coverage = in-catalog queries answered HIGH. Top-1 / Recall@3 = visual ranking alone. Parallel latency assumes vision and embedding run at the same time (as planned live); sequential adds them. Media download from the channel is not included.");
  lines.push("");
  lines.push("## Catalog index");
  lines.push("");
  lines.push("| Embedding | Images indexed | Errors | Mean ms/image |");
  lines.push("|---|---|---|---|");
  for (const [id, idx] of Object.entries(report.catalog_index)) lines.push(`| ${id} | ${idx.images} | ${idx.errors} | ${ms(idx.mean_latency_ms)} |`);
  lines.push("");
  for (const c of report.combos) {
    const m = c.metrics;
    const t = c.calibration.thresholds;
    lines.push(`## ${c.vision_id} × ${c.embedding_id}`);
    lines.push("");
    lines.push(`- Thresholds (calibrated on ${c.calibrated_on}): t_high ${threshold(t.t_high)}, margin ${t.margin}, t_low ${threshold(t.t_low)}${c.calibration.feasible ? "" : " — visual HIGH is off"}`);
    for (const note of c.calibration.notes) lines.push(`- Note: ${note}`);
    lines.push(`- HIGH from product code: ${m.high.from_sku.correct}/${m.high.from_sku.count} right; from visual match: ${m.high.from_visual.correct}/${m.high.from_visual.count} right`);
    lines.push(`- MEDIUM answers: ${m.medium.count}, of which ${m.medium.contains_expected} list the right product. Not-ours photos answered NONE: ${pct(m.none_on_not_ours)}. Variant right at HIGH: ${pct(m.variant_accuracy_at_high)}`);
    lines.push(`- Vision: ${m.errors.vision} errors (${m.errors.vision_invalid_output} unusable replies); tokens in/out ${m.tokens.input}/${m.tokens.output} over ${m.tokens.calls_with_usage} calls. Latency ms p50/p95/max — vision ${ms(m.latency_ms.vision.p50)}/${ms(m.latency_ms.vision.p95)}/${ms(m.latency_ms.vision.max)}, embedding ${ms(m.latency_ms.embedding.p50)}/${ms(m.latency_ms.embedding.p95)}/${ms(m.latency_ms.embedding.max)}`);
    const kinds = Object.entries(m.kind.confusion).map(([expected, row]) => `${expected} → ${Object.entries(row).map(([p, n]) => `${p} ${n}`).join(", ")}`);
    if (kinds.length) lines.push(`- Image kind (expected → predicted): ${kinds.join("; ")}`);
    lines.push("");
    lines.push("| Tag | Queries | HIGH right / HIGH | Top-1 |");
    lines.push("|---|---|---|---|");
    for (const [tag, b] of Object.entries(m.by_tag).sort(([a], [b2]) => a.localeCompare(b2))) {
      lines.push(`| ${tag} | ${b.queries} | ${b.high_correct}/${b.high} | ${b.top1_ranked ? `${b.top1_correct}/${b.top1_ranked}` : "n/a"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
