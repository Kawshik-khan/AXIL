import { outboundRequest, type OutboundResponse } from "@/lib/outbound-http";
import { logger } from "@/lib/logger";

/**
 * Readiness of the external services the app leans on besides Postgres (production readiness R1, docs/production-readiness.md).
 *
 * Each service is probed only if it is configured, with a short deadline, and the answer is cached so the
 * unauthenticated /health/ready endpoint can't be used to hammer a provider (or run up its bill). READY_REQUIRED lists
 * the services whose outage makes the app report not-ready; the rest are reported "down" without failing readiness.
 * Default: all three. The response carries service names and states only, never URLs or provider error text.
 */
export type DependencyName = "qdrant" | "redis" | "llm";
export type DependencyState = "ok" | "down" | "not_configured";

export interface DependencyStatus {
  state: DependencyState;
  required: boolean;
}

const ALL: DependencyName[] = ["qdrant", "redis", "llm"];
const PROBE_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS: Record<DependencyName, number> = { qdrant: 15_000, redis: 15_000, llm: 60_000 };

type Probe = () => Promise<OutboundResponse>;
const cache = new Map<DependencyName, { at: number; state: DependencyState }>();
const inflight = new Map<DependencyName, Promise<DependencyState>>();

/** Services whose outage fails readiness. Unknown names are ignored; an empty value means none. */
export function requiredDependencies(env: NodeJS.ProcessEnv = process.env): Set<DependencyName> {
  const raw = env.READY_REQUIRED;
  if (raw === undefined) return new Set(ALL);
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s): s is DependencyName => (ALL as string[]).includes(s)));
}

function probeFor(name: DependencyName, env: NodeJS.ProcessEnv): Probe | null {
  if (name === "qdrant") {
    const url = env.QDRANT_URL?.trim().replace(/\/+$/, "");
    if (!url) return null;
    const key = env.QDRANT_API_KEY?.trim();
    return () => outboundRequest(`${url}/collections`, { headers: key ? { "api-key": key } : {}, timeoutMs: PROBE_TIMEOUT_MS, maxResponseBytes: 4_096, platformConfigured: true });
  }
  if (name === "redis") {
    const url = env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
    const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) return null;
    return () => outboundRequest(`${url}/ping`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: PROBE_TIMEOUT_MS, maxResponseBytes: 1_024, platformConfigured: true });
  }
  const base = env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null; // AI_DEMO_MODE, or no provider yet: nothing to depend on
  const apiKey = env.LLM_API_KEY?.trim();
  return () => outboundRequest(`${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs: PROBE_TIMEOUT_MS, maxResponseBytes: 1_024, platformConfigured: true });
}

/** Up means the service answered and didn't reject our credentials. 404 counts: some providers have no /models. */
function isUp(name: DependencyName, res: OutboundResponse): boolean {
  if (name === "llm") return res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429;
  return res.status >= 200 && res.status < 300;
}

async function checkOne(name: DependencyName, env: NodeJS.ProcessEnv): Promise<DependencyState> {
  const probe = probeFor(name, env);
  if (!probe) return "not_configured";
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS[name]) return hit.state;
  const running = inflight.get(name);
  if (running) return running;
  const started = (async (): Promise<DependencyState> => {
    let state: DependencyState;
    try {
      state = isUp(name, await probe()) ? "ok" : "down";
    } catch (err) {
      state = "down";
      logger.warn("health.dependency_probe_failed", { dependency: name, error_name: err instanceof Error ? err.name : "Error" });
    }
    cache.set(name, { at: Date.now(), state });
    return state;
  })().finally(() => inflight.delete(name));
  inflight.set(name, started);
  return started;
}

export async function checkDependencies(env: NodeJS.ProcessEnv = process.env): Promise<Record<DependencyName, DependencyStatus>> {
  const required = requiredDependencies(env);
  const states = await Promise.all(ALL.map((n) => checkOne(n, env)));
  return Object.fromEntries(ALL.map((n, i) => [n, { state: states[i], required: required.has(n) }])) as Record<DependencyName, DependencyStatus>;
}

/** The first required service that is down, as a readiness reason code. */
export function failingDependencyReason(deps: Record<DependencyName, DependencyStatus>): string | null {
  const down = ALL.find((n) => deps[n].required && deps[n].state === "down");
  return down ? `${down.toUpperCase()}_UNREACHABLE` : null;
}

export function resetDependencyHealthForTesting(): void {
  cache.clear();
  inflight.clear();
}
