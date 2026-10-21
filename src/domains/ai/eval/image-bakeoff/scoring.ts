/**
 * Image bake-off scoring: turns one vision result and one visual ranking into the spec's answer bands
 * (image-product-search.md §4.5), calibrates the thresholds per combo, and measures them.
 *
 * Band rules (same as the spec):
 *   - the vision model says it isn't a product photo → no match (the agent asks or hands off);
 *   - a product code read from the image equals exactly one catalog SKU → HIGH, whatever the visual score;
 *   - visual top-1 ≥ t_high and (top-1 − top-2) ≥ margin → HIGH;
 *   - top-1 ≥ t_low → MEDIUM (up to 3 candidates shown);
 *   - otherwise NONE.
 * A failed vision call counts as "product" with no codes: the visual match still runs, as it would live.
 */
import { BakeoffQuery, CatalogProduct, ImageKind } from "./dataset";
import { Usage, VisionOutput } from "./providers";

export type Band = "HIGH" | "MEDIUM" | "NONE";

export interface RankedProduct {
  product_id: string;
  variant_id: string | null;
  /** Cosine similarity of the best-matching catalog image of this product. */
  score: number;
}

export interface Thresholds {
  t_high: number;
  margin: number;
  t_low: number;
}

/** One query as seen by one vision model and one embedding model. */
export interface QueryObservation {
  query: BakeoffQuery;
  vision: { output: VisionOutput | null; error: string | null; latency_ms: number | null; usage?: Usage };
  embedding: { ranked: RankedProduct[] | null; error: string | null; latency_ms: number | null };
}

export interface Decision {
  band: Band;
  source: "sku" | "visual" | "non_product" | "none";
  /** The product the agent would name (HIGH only). */
  product_id: string | null;
  variant_id: string | null;
  /** Shown to the customer for MEDIUM (max 3). */
  candidates: RankedProduct[];
}

export const MARGINS = [0, 0.01, 0.02, 0.05, 0.1] as const;

// ---- Matching ----------------------------------------------------------------------------------------------------------

const BANGLA_DIGITS = /[০-৯]/g;

/** "kr-১০২", "KR 102" and "KR102" are the same code. */
export function normalizeSku(raw: string): string {
  return raw
    .replace(BANGLA_DIGITS, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/^\s*(code|sku|product code|কোড)\s*[:#.-]?\s*/i, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export interface SkuIndex {
  get(code: string): { product_id: string; variant_id: string | null } | null;
}

/** Codes that name more than one product are left out: an ambiguous code must not produce a HIGH answer. */
export function buildSkuIndex(catalog: CatalogProduct[]): SkuIndex {
  const map = new Map<string, { product_id: string; variant_id: string | null } | "AMBIGUOUS">();
  const add = (sku: string | undefined, product_id: string, variant_id: string | null) => {
    if (!sku) return;
    const code = normalizeSku(sku);
    if (code.length < 2) return;
    const existing = map.get(code);
    if (existing && (existing === "AMBIGUOUS" || existing.product_id !== product_id || existing.variant_id !== variant_id)) {
      map.set(code, "AMBIGUOUS");
    } else {
      map.set(code, { product_id, variant_id });
    }
  };
  for (const product of catalog) {
    add(product.sku, product.product_id, null);
    for (const variant of product.variants) add(variant.sku, product.product_id, variant.variant_id);
  }
  return {
    get(code) {
      const hit = map.get(normalizeSku(code));
      return hit && hit !== "AMBIGUOUS" ? hit : null;
    },
  };
}

/** The first code read from the image that names exactly one product; conflicting codes give no hit. */
export function skuHit(vision: VisionOutput | null, index: SkuIndex): { product_id: string; variant_id: string | null } | null {
  if (!vision) return null;
  const hits = vision.sku_candidates.map((c) => index.get(c)).filter((h): h is { product_id: string; variant_id: string | null } => h !== null);
  if (!hits.length) return null;
  return hits.every((h) => h.product_id === hits[0].product_id) ? hits[0] : null;
}

export interface CatalogVector {
  product_id: string;
  variant_id: string | null;
  vector: number[];
}

/** Products ranked by their best image (vectors are L2-normalised, so the dot product is the cosine). */
export function rankProducts(query: number[], catalog: CatalogVector[]): RankedProduct[] {
  const best = new Map<string, RankedProduct>();
  for (const item of catalog) {
    if (item.vector.length !== query.length) throw new Error(`vector size mismatch: ${item.vector.length} vs ${query.length}`);
    let score = 0;
    for (let i = 0; i < query.length; i++) score += query[i] * item.vector[i];
    const current = best.get(item.product_id);
    if (!current || score > current.score) best.set(item.product_id, { product_id: item.product_id, variant_id: item.variant_id, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.product_id.localeCompare(b.product_id));
}

function predictedKind(observation: QueryObservation): ImageKind {
  return observation.vision.output?.kind ?? "product";
}

export function decide(observation: QueryObservation, sku: SkuIndex, t: Thresholds): Decision {
  if (predictedKind(observation) !== "product") return { band: "NONE", source: "non_product", product_id: null, variant_id: null, candidates: [] };
  const hit = skuHit(observation.vision.output, sku);
  if (hit) return { band: "HIGH", source: "sku", product_id: hit.product_id, variant_id: hit.variant_id, candidates: [] };
  const ranked = observation.embedding.ranked ?? [];
  const top1 = ranked[0];
  if (!top1) return { band: "NONE", source: "none", product_id: null, variant_id: null, candidates: [] };
  const gap = top1.score - (ranked[1]?.score ?? -1);
  if (top1.score >= t.t_high && gap >= t.margin) {
    return { band: "HIGH", source: "visual", product_id: top1.product_id, variant_id: top1.variant_id, candidates: [top1] };
  }
  if (top1.score >= t.t_low) {
    return { band: "MEDIUM", source: "visual", product_id: null, variant_id: null, candidates: ranked.filter((r) => r.score >= t.t_low).slice(0, 3) };
  }
  return { band: "NONE", source: "none", product_id: null, variant_id: null, candidates: [] };
}

// ---- Calibration -------------------------------------------------------------------------------------------------------

export interface Calibration {
  thresholds: Thresholds;
  /** False when no t_high reaches the target precision with enough HIGH answers: only SKU hits answer HIGH. */
  feasible: boolean;
  notes: string[];
}

/**
 * Picks the (t_high, margin) that answers HIGH most often while precision on these observations stays ≥ target,
 * with at least `minHigh` HIGH answers (fewer when the set has fewer in-catalog queries). Ties go to the stricter
 * threshold. t_low maximises Youden's J between in-catalog and not-ours product photos.
 */
export function calibrate(observations: QueryObservation[], sku: SkuIndex, target: number, minHigh: number): Calibration {
  const notes: string[] = [];
  const inCatalog = observations.filter((o) => o.query.expected_product_id !== null).length;
  const needHigh = Math.max(1, Math.min(minHigh, inCatalog));
  if (inCatalog < minHigh) notes.push(`only ${inCatalog} in-catalog queries to calibrate on (want ≥ ${minHigh}); thresholds are rough`);

  const scores = [...new Set(observations.map((o) => o.embedding.ranked?.[0]?.score).filter((s): s is number => s !== undefined))].sort((a, b) => a - b);
  let best: { t: number; margin: number; high: number } | null = null;
  for (const margin of MARGINS) {
    for (const t of [...scores, Number.POSITIVE_INFINITY]) {
      const { high, correct } = countHigh(observations, sku, { t_high: t, margin, t_low: Number.NEGATIVE_INFINITY });
      if (high < needHigh || correct / high < target) continue;
      if (!best || high > best.high || (high === best.high && (t > best.t || (t === best.t && margin > best.margin)))) {
        best = { t, margin, high };
      }
    }
  }
  const feasible = best !== null && Number.isFinite(best.t);
  if (!feasible) notes.push(`no visual threshold reaches ${pct(target)} precision here; only exact product codes answer HIGH`);
  const t_high = best?.t ?? Number.POSITIVE_INFINITY;
  const margin = best?.margin ?? 0;

  const productPhotos = observations.filter((o) => o.query.expected_kind === "product" && o.embedding.ranked?.length);
  const positives = productPhotos.filter((o) => o.query.expected_product_id !== null).map((o) => o.embedding.ranked![0].score);
  const negatives = productPhotos.filter((o) => o.query.expected_product_id === null).map((o) => o.embedding.ranked![0].score);
  let t_low: number;
  if (!positives.length) {
    t_low = t_high;
    notes.push("no in-catalog product photos with a visual ranking: MEDIUM band not calibrated");
  } else if (!negatives.length) {
    t_low = percentile([...positives].sort((a, b) => a - b), 5);
    notes.push('no "not ours" product photos: t_low is the 5th percentile of in-catalog scores, not calibrated against misses');
  } else {
    let bestJ = Number.NEGATIVE_INFINITY;
    t_low = positives[0];
    for (const t of [...new Set([...positives, ...negatives])].sort((a, b) => a - b)) {
      const j = positives.filter((s) => s >= t).length / positives.length - negatives.filter((s) => s >= t).length / negatives.length;
      if (j > bestJ) {
        bestJ = j;
        t_low = t;
      }
    }
  }
  return { thresholds: { t_high, margin, t_low: Math.min(t_low, t_high) }, feasible, notes };
}

function countHigh(observations: QueryObservation[], sku: SkuIndex, t: Thresholds): { high: number; correct: number } {
  let high = 0;
  let correct = 0;
  for (const o of observations) {
    const d = decide(o, sku, t);
    if (d.band !== "HIGH") continue;
    high++;
    if (d.product_id === o.query.expected_product_id) correct++;
  }
  return { high, correct };
}

// ---- Metrics -----------------------------------------------------------------------------------------------------------

export interface LatencyStats {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface ComboMetrics {
  queries: number;
  in_catalog: number;
  not_ours: number;
  non_product: number;
  high: {
    count: number;
    correct: number;
    /** null when there was no HIGH answer. */
    precision: number | null;
    /** Wilson 95% lower bound: what the precision could honestly be with this many answers. */
    precision_lower_95: number | null;
    /** HIGH answers / in-catalog queries. */
    coverage: number | null;
    from_sku: { count: number; correct: number };
    from_visual: { count: number; correct: number };
    wrong_product: number;
    on_not_ours: number;
    on_non_product: number;
  };
  /** Visual ranking only, in-catalog product photos with a ranking. */
  top1_accuracy: number | null;
  recall_at_3: number | null;
  medium: { count: number; contains_expected: number };
  /** Not-ours product photos that got NONE (the honest "we don't have it"). */
  none_on_not_ours: number | null;
  variant_accuracy_at_high: number | null;
  kind: { accuracy: number | null; confusion: Record<string, Record<string, number>> };
  sku_ocr: { labelled: number; read: number; rate: number | null };
  errors: { vision: number; vision_invalid_output: number; embedding: number };
  latency_ms: { vision: LatencyStats; embedding: LatencyStats; sequential: LatencyStats; parallel: LatencyStats };
  tokens: { input: number; output: number; calls_with_usage: number };
  by_tag: Record<string, { queries: number; high: number; high_correct: number; in_catalog: number; top1_correct: number; top1_ranked: number }>;
}

export function measure(observations: QueryObservation[], sku: SkuIndex, t: Thresholds): ComboMetrics {
  const m: ComboMetrics = {
    queries: observations.length,
    in_catalog: 0,
    not_ours: 0,
    non_product: 0,
    high: {
      count: 0, correct: 0, precision: null, precision_lower_95: null, coverage: null,
      from_sku: { count: 0, correct: 0 }, from_visual: { count: 0, correct: 0 },
      wrong_product: 0, on_not_ours: 0, on_non_product: 0,
    },
    top1_accuracy: null,
    recall_at_3: null,
    medium: { count: 0, contains_expected: 0 },
    none_on_not_ours: null,
    variant_accuracy_at_high: null,
    kind: { accuracy: null, confusion: {} },
    sku_ocr: { labelled: 0, read: 0, rate: null },
    errors: { vision: 0, vision_invalid_output: 0, embedding: 0 },
    latency_ms: { vision: emptyStats(), embedding: emptyStats(), sequential: emptyStats(), parallel: emptyStats() },
    tokens: { input: 0, output: 0, calls_with_usage: 0 },
    by_tag: {},
  };
  let ranked = 0, top1 = 0, top3 = 0, notOursNone = 0, kindSeen = 0, kindRight = 0, variantLabelled = 0, variantRight = 0;
  const vLat: number[] = [], eLat: number[] = [], seq: number[] = [], par: number[] = [];

  for (const o of observations) {
    const q = o.query;
    const d = decide(o, sku, t);
    const isInCatalog = q.expected_product_id !== null;
    const isNotOurs = q.expected_kind === "product" && !isInCatalog;
    if (isInCatalog) m.in_catalog++;
    if (isNotOurs) m.not_ours++;
    if (q.expected_kind !== "product") m.non_product++;

    if (d.band === "HIGH") {
      m.high.count++;
      const right = d.product_id === q.expected_product_id;
      const bucket = d.source === "sku" ? m.high.from_sku : m.high.from_visual;
      bucket.count++;
      if (right) {
        m.high.correct++;
        bucket.correct++;
        if (q.expected_variant_id) {
          variantLabelled++;
          if (d.variant_id === q.expected_variant_id) variantRight++;
        }
      } else if (isNotOurs) m.high.on_not_ours++;
      else if (q.expected_kind !== "product") m.high.on_non_product++;
      else m.high.wrong_product++;
    }
    if (d.band === "MEDIUM") {
      m.medium.count++;
      if (isInCatalog && d.candidates.some((c) => c.product_id === q.expected_product_id)) m.medium.contains_expected++;
    }
    if (isNotOurs && d.band === "NONE") notOursNone++;

    const list = o.embedding.ranked;
    if (isInCatalog && q.expected_kind === "product" && list?.length) {
      ranked++;
      if (list[0].product_id === q.expected_product_id) top1++;
      if (list.slice(0, 3).some((r) => r.product_id === q.expected_product_id)) top3++;
    }

    if (o.vision.output) {
      kindSeen++;
      const predicted = o.vision.output.kind;
      if (predicted === q.expected_kind) kindRight++;
      m.kind.confusion[q.expected_kind] ??= {};
      m.kind.confusion[q.expected_kind][predicted] = (m.kind.confusion[q.expected_kind][predicted] ?? 0) + 1;
    }
    if (q.expected_sku) {
      m.sku_ocr.labelled++;
      const want = normalizeSku(q.expected_sku);
      if (o.vision.output?.sku_candidates.some((c) => normalizeSku(c) === want)) m.sku_ocr.read++;
    }
    if (o.vision.error) {
      m.errors.vision++;
      if (o.vision.error.startsWith("INVALID_OUTPUT")) m.errors.vision_invalid_output++;
    }
    if (o.embedding.error) m.errors.embedding++;
    if (o.vision.usage) {
      m.tokens.input += o.vision.usage.input_tokens;
      m.tokens.output += o.vision.usage.output_tokens;
      m.tokens.calls_with_usage++;
    }
    if (o.vision.latency_ms !== null) vLat.push(o.vision.latency_ms);
    if (o.embedding.latency_ms !== null) eLat.push(o.embedding.latency_ms);
    if (o.vision.latency_ms !== null && o.embedding.latency_ms !== null) {
      seq.push(o.vision.latency_ms + o.embedding.latency_ms);
      par.push(Math.max(o.vision.latency_ms, o.embedding.latency_ms));
    }

    for (const tag of q.tags.length ? q.tags : ["(untagged)"]) {
      const b = (m.by_tag[tag] ??= { queries: 0, high: 0, high_correct: 0, in_catalog: 0, top1_correct: 0, top1_ranked: 0 });
      b.queries++;
      if (isInCatalog) b.in_catalog++;
      if (d.band === "HIGH") {
        b.high++;
        if (d.product_id === q.expected_product_id) b.high_correct++;
      }
      if (isInCatalog && q.expected_kind === "product" && list?.length) {
        b.top1_ranked++;
        if (list[0].product_id === q.expected_product_id) b.top1_correct++;
      }
    }
  }

  m.high.precision = ratio(m.high.correct, m.high.count);
  m.high.precision_lower_95 = m.high.count ? wilsonLower(m.high.correct, m.high.count) : null;
  m.high.coverage = ratio(m.high.correct + m.high.wrong_product, m.in_catalog);
  m.top1_accuracy = ratio(top1, ranked);
  m.recall_at_3 = ratio(top3, ranked);
  m.none_on_not_ours = ratio(notOursNone, m.not_ours);
  m.variant_accuracy_at_high = ratio(variantRight, variantLabelled);
  m.kind.accuracy = ratio(kindRight, kindSeen);
  m.sku_ocr.rate = ratio(m.sku_ocr.read, m.sku_ocr.labelled);
  m.latency_ms = { vision: stats(vLat), embedding: stats(eLat), sequential: stats(seq), parallel: stats(par) };
  return m;
}

// ---- Small helpers -----------------------------------------------------------------------------------------------------

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

/** Wilson score interval lower bound, 95%. */
export function wilsonLower(successes: number, n: number): number {
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - spread) / denom);
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function emptyStats(): LatencyStats {
  return { n: 0, p50: null, p95: null, max: null };
}

function stats(values: number[]): LatencyStats {
  if (!values.length) return emptyStats();
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
