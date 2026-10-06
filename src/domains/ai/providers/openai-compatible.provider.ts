/**
 * A real LLM provider for any server exposing OpenAI-style `/chat/completions` and `/embeddings`: OpenAI, OpenRouter,
 * Groq, DeepSeek, Ollama, vLLM (FIX_IMPLEMENTATION_PLAN FX-32, audit H14). Configured from the environment by the
 * model router; nothing here is tenant-controlled, so the base URL isn't user input.
 */
import { AppError } from "@/lib/errors";
import { OutboundTimeoutError, outboundRequest, type OutboundResponse } from "@/lib/outbound-http";
import type {
  LLMMessage,
  LLMProvider,
  LLMProviderOptions,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
} from "./llm-provider.interface";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  name?: string;
  timeoutMs?: number;
  /** Sent as `dimensions` on embedding calls (providers that support shortened vectors). */
  embeddingDimensions?: number;
  models: { TIER_1_FAST: string; TIER_2_REASONING: string; TIER_3_EMBEDDING: string };
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface WireResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: WireToolCall[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  data?: Array<{ embedding?: number[] }>;
}

function safeJsonParse(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Messages in the wire format; an assistant turn that called tools must carry them before the tool results. */
function toWireMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) } })),
    };
  }
  if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
  return { role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) };
}

function usageOf(data: WireResponse): LLMUsage {
  const prompt = data.usage?.prompt_tokens ?? 0;
  const completion = data.usage?.completion_tokens ?? 0;
  const cached = data.usage?.prompt_tokens_details?.cached_tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: data.usage?.total_tokens ?? prompt + completion,
    ...(typeof cached === "number" && cached > 0 ? { cached_tokens: Math.min(cached, prompt) } : {}), // FX-70
  };
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly providerName: string;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.providerName = cfg.name ?? "openai-compatible";
  }

  public modelFor(tier: keyof OpenAICompatibleConfig["models"]): string {
    return this.cfg.models[tier];
  }

  private async post(path: string, body: unknown, timeoutMs = this.cfg.timeoutMs ?? 30_000): Promise<WireResponse> {
    // The base URL is platform configuration (LLM_BASE_URL), so a local Ollama/vLLM works; limits still apply
    let res: OutboundResponse;
    try {
      res = await outboundRequest(`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
        body: JSON.stringify(body),
        timeoutMs,
        maxResponseBytes: 16 * 1024 * 1024,
        platformConfigured: true,
      });
    } catch (err) {
      // Network errors name the provider's host (it can be internal): tenants see only that it failed (Phase 3 F3)
      const code = err instanceof OutboundTimeoutError ? "timed out" : "could not be reached";
      throw new AppError("LLM_PROVIDER_ERROR", `AI provider ${this.providerName} ${code}.`, 502);
    }
    if (res.status < 200 || res.status >= 300) {
      // The provider's own error text can include account details; keep it short and out of tenant-facing messages
      throw new AppError("LLM_PROVIDER_ERROR", `AI provider ${this.providerName} answered HTTP ${res.status}.`, 502, { status: res.status });
    }
    try {
      return JSON.parse(res.body) as WireResponse;
    } catch {
      throw new AppError("LLM_PROVIDER_ERROR", `AI provider ${this.providerName} answered with something that isn't JSON.`, 502);
    }
  }

  public async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], options?: LLMProviderOptions): Promise<LLMResponse> {
    const started = Date.now();
    const model = options?.model ?? this.cfg.models.TIER_1_FAST;
    const data = await this.post(
      "/chat/completions",
      {
        model,
        messages: messages.map(toWireMessage),
        ...(tools?.length
          ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
        temperature: options?.temperature ?? 0.2,
        ...(options?.max_tokens ? { max_tokens: options.max_tokens } : {}),
      },
      options?.timeout_ms
    );
    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: LLMToolCall[] = (msg.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc, i) => ({ id: tc.id ?? `call_${i}`, name: tc.function?.name as string, arguments: safeJsonParse(tc.function?.arguments) }));
    return {
      content: msg.content ?? "",
      tool_calls: toolCalls,
      usage: usageOf(data),
      model: data.model ?? model,
      latency_ms: Date.now() - started,
    };
  }

  public async generate(prompt: string, options?: { systemPrompt?: string; temperature?: number; max_tokens?: number }): Promise<string> {
    const messages: LLMMessage[] = [
      ...(options?.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user", content: prompt },
    ];
    const res = await this.chat(messages, undefined, { temperature: options?.temperature, max_tokens: options?.max_tokens });
    return res.content;
  }

  public async structuredOutput<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMProviderOptions
  ): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    const instructed: LLMMessage[] = [
      ...messages,
      { role: "system", content: `Reply with a single JSON object matching ${schemaDescription}. No prose, no code fences.` },
    ];
    const res = await this.chat(instructed, undefined, { ...options, temperature: options?.temperature ?? 0 });
    const text = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    const parsed: unknown = JSON.parse(text);
    return { data: parsed as T, usage: res.usage, latency_ms: res.latency_ms };
  }

  public async embed(text: string): Promise<number[]> {
    if (!this.cfg.models.TIER_3_EMBEDDING) {
      // No vendor default (FX-88): a wrong model name would silently fail or return vectors of another size
      throw new AppError("AI_PROVIDER_NOT_CONFIGURED", `LLM_EMBEDDING_MODEL is not set for AI provider ${this.providerName}.`, 424);
    }
    const data = await this.post("/embeddings", { model: this.cfg.models.TIER_3_EMBEDDING, input: text, ...(this.cfg.embeddingDimensions ? { dimensions: this.cfg.embeddingDimensions } : {}) });
    const embedding = data.data?.[0]?.embedding;
    if (!embedding?.length) throw new AppError("LLM_PROVIDER_ERROR", `AI provider ${this.providerName} returned no embedding.`, 502);
    return embedding;
  }
}

/**
 * Used when no AI provider is configured and demo mode is off: every call refuses with a clear 424, instead of the
 * keyword mock silently answering as if it were a model (FX-32).
 */
export class UnconfiguredProvider implements LLMProvider {
  public readonly providerName = "not-configured";
  constructor(
    private readonly reason = "No AI provider is configured. Set LLM_BASE_URL (and LLM_API_KEY), or AI_DEMO_MODE=1 for the offline demo."
  ) {}
  private refuse(): never {
    throw new AppError("AI_PROVIDER_NOT_CONFIGURED", this.reason, 424);
  }
  public async chat(): Promise<LLMResponse> {
    return this.refuse();
  }
  public async generate(): Promise<string> {
    return this.refuse();
  }
  public async structuredOutput<T>(): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    return this.refuse();
  }
  public async embed(): Promise<number[]> {
    return this.refuse();
  }
}
