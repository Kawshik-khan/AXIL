/**
 * Live "test connection" checks (FIX_IMPLEMENTATION_PLAN FX-53): one lightweight authenticated read per provider, only
 * to learn whether the credentials work. Everything goes through the SSRF-guarded outbound client with a 5 s deadline.
 * Results never contain the credentials, the request URL or the provider's response body — only a reason class.
 *
 * Endpoints follow each provider's official API documentation (checked 2026-09-29):
 *   Anthropic GET /v1/models (x-api-key, anthropic-version) · Gemini GET /v1beta/models (x-goog-api-key)
 *   OpenAI-compatible GET {base}/models (Bearer) · Meta Graph GET /me · WhatsApp Cloud GET /{phone-number-id}
 *   Telegram GET /bot{token}/getMe · Steadfast GET https://portal.packzy.com/api/v1/get_balance (Api-Key, Secret-Key)
 *   Pinecone GET https://api.pinecone.io/indexes (Api-Key) · Qdrant GET {url}/collections (api-key)
 *   Upstash GET {rest_url}/ping (Bearer) · HubSpot GET /account-info/v3/details (Bearer)
 *   Shopify GET https://{shop}.myshopify.com/admin/api/{version}/shop.json (X-Shopify-Access-Token)
 * Providers not listed here stay NOT_VERIFIED.
 *
 * Every URL here is treated as tenant-supplied: the platform allow-list never applies and only standard https ports are
 * allowed, so a tenant can't reach the platform's private services. Failures after the URL check (DNS, connect,
 * timeout, an address refused at connect time) all read UNREACHABLE with one message, so the test can't be used to
 * map internal names or ports (Phase 5 review M6, L7).
 */
import { OutboundBlockedError, OutboundNetworkError, OutboundTimeoutError, outboundRequest, parseSafeUrl } from "@/lib/outbound-http";
import type { TestConnectionResult } from "@/types/connector";

const TIMEOUT_MS = 5_000;
const OPENAI_COMPATIBLE = new Set(["openai", "deepseek", "groq", "openrouter", "ollama", "vllm"]);
const STEADFAST_BASE = "https://portal.packzy.com/api/v1";
const GRAPH_BASE = "https://graph.facebook.com";
const SHOPIFY_DEFAULT_API_VERSION = "2025-07";

export type LiveCheckReason = "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMITED" | "PROVIDER_ERROR" | "UNREACHABLE" | "BLOCKED_URL" | "INVALID_INPUT";

interface CheckRequest {
  url: string;
  headers: Record<string, string>;
  /** Some APIs answer 200 with an error in the body (Telegram `ok:false`); true means the body says it worked. */
  bodyOk?: (body: string) => boolean;
}

interface LiveCheckInput {
  providerId: string;
  providerName: string;
  credentials: Record<string, unknown>;
  /** Endpoint the user entered, if any (custom base URL, self-hosted server). */
  endpoint?: string;
  defaultEndpoint?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v).trim());
const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** The request that proves the credentials work, or null when there is no live check for this provider. */
function requestFor(input: LiveCheckInput): CheckRequest | { invalid: string } | null {
  const c = input.credentials;
  const id = input.providerId;
  if (OPENAI_COMPATIBLE.has(id)) {
    const base = str(c.custom_base_url) || str(input.endpoint) || str(input.defaultEndpoint);
    if (!base) return { invalid: "an endpoint URL is required" };
    const key = str(c.api_key) || str(c.bearer_token);
    return { url: `${trimSlash(base)}/models`, headers: key ? { Authorization: `Bearer ${key}` } : {} };
  }
  switch (id) {
    case "anthropic": {
      const base = str(c.custom_base_url) || str(input.endpoint) || str(input.defaultEndpoint) || "https://api.anthropic.com/v1";
      return { url: `${trimSlash(base)}/models?limit=1`, headers: { "x-api-key": str(c.api_key), "anthropic-version": "2023-06-01" } };
    }
    case "google_gemini": {
      const base = str(c.custom_base_url) || str(input.endpoint) || str(input.defaultEndpoint) || "https://generativelanguage.googleapis.com/v1beta";
      return { url: `${trimSlash(base)}/models?pageSize=1`, headers: { "x-goog-api-key": str(c.api_key) } };
    }
    case "meta_graph": {
      const token = str(c.page_access_token);
      if (!token) return { invalid: "a Page access token is required" };
      return { url: `${GRAPH_BASE}/me?fields=id`, headers: { Authorization: `Bearer ${token}` } };
    }
    case "whatsapp_cloud": {
      const phoneId = str(c.phone_number_id);
      const token = str(c.permanent_access_token);
      if (!/^\d{5,25}$/.test(phoneId)) return { invalid: "the phone number ID must be digits" };
      if (!token) return { invalid: "an access token is required" };
      return { url: `${GRAPH_BASE}/${phoneId}?fields=id`, headers: { Authorization: `Bearer ${token}` } };
    }
    case "telegram": {
      const token = str(c.bot_token);
      if (!/^\d{3,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) return { invalid: "the bot token format is 123456789:ABC..." };
      return { url: `https://api.telegram.org/bot${token}/getMe`, headers: {}, bodyOk: (b) => /"ok"\s*:\s*true/.test(b) };
    }
    case "steadfast": {
      const apiKey = str(c.api_key);
      const secret = str(c.secret_key);
      if (!apiKey || !secret) return { invalid: "the API key and secret key are required" };
      return { url: `${STEADFAST_BASE}/get_balance`, headers: { "Api-Key": apiKey, "Secret-Key": secret, "Content-Type": "application/json" } };
    }
    case "qdrant": {
      const base = str(c.endpoint_url) || str(input.endpoint);
      if (!base) return { invalid: "the Qdrant URL is required" };
      const key = str(c.api_key);
      return { url: `${trimSlash(base)}/collections`, headers: key ? { "api-key": key } : {} };
    }
    case "prov_hubspot_crm": {
      const token = str(c.access_token);
      if (!token) return { invalid: "an access token is required" };
      return { url: "https://api.hubapi.com/account-info/v3/details", headers: { Authorization: `Bearer ${token}` } };
    }
    case "prov_shopify_plus": {
      const shop = str(c.shop_domain).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(shop)) return { invalid: "the shop domain must be your-store.myshopify.com" };
      const version = /^\d{4}-\d{2}$/.test(str(c.api_version)) ? str(c.api_version) : SHOPIFY_DEFAULT_API_VERSION;
      return { url: `https://${shop}/admin/api/${version}/shop.json`, headers: { "X-Shopify-Access-Token": str(c.access_token) } };
    }
    default:
      return null;
  }
}

function failed(providerName: string, reason: LiveCheckReason, message: string, latencyMs: number | null): TestConnectionResult {
  return { success: false, status: "FAILED", latency_ms: latencyMs, message: `${providerName}: ${message}`, details: { reason } };
}

/** Runs the provider's live check; null when there is none (the caller reports NOT_VERIFIED). */
export async function runLiveCheck(input: LiveCheckInput): Promise<TestConnectionResult | null> {
  const req = requestFor(input);
  if (req === null) return null;
  if ("invalid" in req) return failed(input.providerName, "INVALID_INPUT", `${req.invalid}.`, null);
  try {
    parseSafeUrl(req.url, { tenantSupplied: true });
  } catch (err) {
    if (err instanceof OutboundBlockedError) {
      return failed(input.providerName, "BLOCKED_URL", `${err.message} Self-hosted servers on a private network can't be tested from here.`, null);
    }
    throw err;
  }
  try {
    const res = await outboundRequest(req.url, {
      method: "GET",
      headers: { Accept: "application/json", ...req.headers },
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: 64 * 1024,
      tenantSupplied: true,
    });
    const latency = res.durationMs;
    if (res.status >= 200 && res.status < 300 && (!req.bodyOk || req.bodyOk(res.body))) {
      return { success: true, status: "VERIFIED", latency_ms: latency, message: `${input.providerName} accepted the credentials.`, details: { reason: null } };
    }
    if (res.status === 401 || res.status === 403 || (res.status >= 200 && res.status < 300)) {
      return failed(input.providerName, "UNAUTHORIZED", "the credentials were refused.", latency);
    }
    if (res.status === 404) return failed(input.providerName, "NOT_FOUND", "the account or endpoint was not found.", latency);
    if (res.status === 429) return failed(input.providerName, "RATE_LIMITED", "the provider is rate limiting; try again later.", latency);
    return failed(input.providerName, "PROVIDER_ERROR", `the provider answered HTTP ${res.status}.`, latency);
  } catch (err) {
    if (err instanceof OutboundBlockedError || err instanceof OutboundTimeoutError || err instanceof OutboundNetworkError) {
      return failed(input.providerName, "UNREACHABLE", "the server could not be reached in time, or its address is not one this service may call.", null);
    }
    throw err;
  }
}

/** Provider ids with a live check (for the UI and STATUS). */
export const LIVE_CHECK_PROVIDERS = [
  ...OPENAI_COMPATIBLE,
  "anthropic",
  "google_gemini",
  "meta_graph",
  "whatsapp_cloud",
  "telegram",
  "steadfast",
  "qdrant",
  "prov_hubspot_crm",
  "prov_shopify_plus",
];
