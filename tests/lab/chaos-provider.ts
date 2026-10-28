/**
 * Agent lab: models for experiments that don't need a live provider.
 *
 * - `ScriptedCustomerModel`: a deterministic stand-in that drives the real customer tools (search, policy, handoff) and
 *   answers without amounts. It doesn't measure answer quality; it gives the chaos layer real tool traffic to break.
 * - `ChaosProvider`: wraps any provider and injects faults from a profile with a seeded PRNG, so a run is reproducible:
 *   transport failures (timeout, 429, 5xx), slow calls, and hostile outputs (unknown or staff-only tools, malformed
 *   arguments, empty or non-message replies, invented prices, fake order and payment claims). Every injected fault is
 *   logged, so the report can tie each fault to what the runtime did with it.
 */
import { AppError } from "@/lib/errors";
import type { LLMMessage, LLMProvider, LLMProviderOptions, LLMResponse, LLMToolDefinition, LLMUsage } from "@/domains/ai/providers/llm-provider.interface";

// ------------------------------------------------------------------------------------------------ seeded randomness
/** mulberry32: small, fast and identical on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ fault profiles
export const FAULT_KINDS = [
  "timeout", "rate_limit", "server_error", "slow",
  "unknown_tool", "staff_tool", "malformed_args", "empty_reply", "not_a_message", "invented_price", "fake_order_claim", "fake_payment_claim",
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];
/** Probability per model call of each fault; at most one fault fires per call. */
export type FaultProfile = Partial<Record<FaultKind, number>>;

export const FAULT_PROFILES: Record<string, FaultProfile> = {
  none: {},
  /** A provider having a bad day: transient errors and slow answers. */
  flaky: { timeout: 0.05, rate_limit: 0.08, server_error: 0.05, slow: 0.1 },
  /** A model producing bad output: the runtime's guards have to catch every one of these. */
  hostile: { unknown_tool: 0.1, staff_tool: 0.1, malformed_args: 0.1, empty_reply: 0.08, not_a_message: 0.08, invented_price: 0.12, fake_order_claim: 0.08, fake_payment_claim: 0.08 },
  /** Both at once. */
  storm: { timeout: 0.05, rate_limit: 0.05, server_error: 0.05, slow: 0.05, unknown_tool: 0.06, staff_tool: 0.06, malformed_args: 0.06, empty_reply: 0.05, not_a_message: 0.05, invented_price: 0.08, fake_order_claim: 0.05, fake_payment_claim: 0.05 },
  /** The provider is down: every call fails. */
  outage: { server_error: 1 },
};

export function parseFaultProfile(spec: string): FaultProfile {
  if (FAULT_PROFILES[spec]) return FAULT_PROFILES[spec];
  // Custom: "timeout=0.2,invented_price=0.5"
  const profile: FaultProfile = {};
  for (const part of spec.split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (!(FAULT_KINDS as readonly string[]).includes(k)) throw new Error(`unknown fault "${k}" (known: ${FAULT_KINDS.join(", ")})`);
    const p = Number(v);
    if (!(p >= 0 && p <= 1)) throw new Error(`fault "${k}" needs a probability between 0 and 1`);
    profile[k as FaultKind] = p;
  }
  return profile;
}

export const TRANSPORT_FAULTS = new Set<FaultKind>(["timeout", "rate_limit", "server_error"]);
export interface FaultEvent { scope: string; call: number; kind: FaultKind }

const usage = (): LLMUsage => ({ prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 });
const reply = (content: string, model: string): LLMResponse => ({ content, tool_calls: [], usage: usage(), model, latency_ms: 0 });
const toolCall = (name: string, args: Record<string, unknown>, model: string, n: number): LLMResponse => ({
  content: "", tool_calls: [{ id: `chaos_${n}`, name, arguments: args }], usage: usage(), model, latency_ms: 0,
});

// ------------------------------------------------------------------------------------------------ chaos wrapper
export class ChaosProvider implements LLMProvider {
  public readonly providerName: string;
  /** Faults injected since the last `take()`, labelled with the scope set by `setScope`. */
  private events: FaultEvent[] = [];
  private scope = "";
  private calls = 0;
  private readonly rand: () => number;

  constructor(private readonly inner: LLMProvider, private readonly profile: FaultProfile, seed: number, private readonly slowMs = 40) {
    this.providerName = inner.providerName;
    this.rand = seededRandom(seed);
  }
  modelFor(tier: "TIER_1_FAST" | "TIER_2_REASONING" | "TIER_3_EMBEDDING"): string {
    const named = this.inner as LLMProvider & { modelFor?: (t: typeof tier) => string };
    return typeof named.modelFor === "function" ? named.modelFor(tier) : "chaos";
  }
  setScope(scope: string) {
    this.scope = scope;
  }
  take(): FaultEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** One roll per call; the first fault whose band the roll lands in fires. */
  private roll(): FaultKind | null {
    const r = this.rand();
    let edge = 0;
    for (const kind of FAULT_KINDS) {
      edge += this.profile[kind] ?? 0;
      if (r < edge) return kind;
    }
    return null;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], options?: LLMProviderOptions): Promise<LLMResponse> {
    const n = this.calls++;
    const kind = this.roll();
    if (kind) this.events.push({ scope: this.scope, call: n, kind });
    const model = "chaos";
    switch (kind) {
      case "timeout":
        throw new AppError("LLM_PROVIDER_ERROR", "AI provider chaos timed out.", 502, { failure_kind: "timeout" });
      case "rate_limit":
        throw new AppError("LLM_PROVIDER_ERROR", "AI provider chaos answered 429.", 502, { status: 429 });
      case "server_error":
        throw new AppError("LLM_PROVIDER_ERROR", "AI provider chaos answered 503.", 502, { status: 503 });
      case "slow":
        await new Promise((r) => setTimeout(r, this.slowMs));
        return this.inner.chat(messages, tools, options);
      case "unknown_tool":
        return toolCall("delete_all_orders", { confirm: true }, model, n);
      case "staff_tool":
        return toolCall("verify_payment_transaction", { order_id: "ORD-1", status: "PAID" }, model, n);
      case "malformed_args":
        return toolCall("place_order", { quote_id: 42, phone: ["x"], payment_method: "FREE" }, model, n);
      case "empty_reply":
        return reply("", model);
      case "not_a_message":
        return reply('{"tool":"search_products","arguments":{"query":"shirt"}}', model);
      case "invented_price":
        return reply("Ei product er dam matro 123 taka, delivery free!", model);
      case "fake_order_claim":
        return reply("Apnar order confirm hoyeche! Order number ORD-99999. Dhonnobad.", model);
      case "fake_payment_claim":
        return reply("Apnar bKash payment received hoyeche, order ta paid.", model);
      default:
        return this.inner.chat(messages, tools, options);
    }
  }
  generate(prompt: string, options?: { systemPrompt?: string; temperature?: number; max_tokens?: number }): Promise<string> {
    return this.inner.generate(prompt, options);
  }
  structuredOutput<T>(messages: LLMMessage[], schemaDescription: string, options?: LLMProviderOptions): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    return this.inner.structuredOutput<T>(messages, schemaDescription, options);
  }
  embed(text: string): Promise<number[]> {
    return this.inner.embed(text);
  }
}

// ------------------------------------------------------------------------------------------------ scripted model
const POLICY = /return|exchange|refund|policy|ferot|ফেরত|রিটার্ন|warranty/i;
const HUMAN = /human|manush|মানুষ|agent er sathe|complain|অভিযোগ|angry|baje|cancel/i;

/** First call picks a real customer tool from the last customer message; the call after a tool result answers. */
export class ScriptedCustomerModel implements LLMProvider {
  public readonly providerName = "lab-scripted";
  constructor(private readonly embedder: Pick<LLMProvider, "embed">) {}
  modelFor(): string {
    return "lab-scripted";
  }
  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const model = "lab-scripted";
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const bangla = /[ঀ-৿]/.test(lastUser);
    const afterTool = messages[messages.length - 1]?.role === "tool";
    const offered = new Set((tools ?? []).map((t) => t.name));
    if (!afterTool && offered.size) {
      const text = lastUser.replace(/\s+/g, " ").trim().slice(0, 60) || "product";
      if (HUMAN.test(lastUser) && offered.has("handoff_to_human")) return toolCall("handoff_to_human", { reason: "customer_request", summary: text }, model, 0);
      if (POLICY.test(lastUser) && offered.has("search_policy")) return toolCall("search_policy", { query: text }, model, 0);
      if (offered.has("search_products")) return toolCall("search_products", { query: text }, model, 0);
    }
    return reply(bangla ? "জি, দেখে নিলাম। আর কিছু জানতে চান?" : "Ji, check kore dekhlam. Ar kichu janben?", model);
  }
  async generate(): Promise<string> {
    return "";
  }
  async structuredOutput<T>(): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    throw new Error("the scripted lab model has no structured output");
  }
  embed(text: string): Promise<number[]> {
    return this.embedder.embed(text);
  }
}
