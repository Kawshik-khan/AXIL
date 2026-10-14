/**
 * A real LLM provider for any server exposing OpenAI-style `/chat/completions` and `/embeddings`: OpenAI, OpenRouter,
 * Groq, DeepSeek, Ollama, vLLM (FIX_IMPLEMENTATION_PLAN FX-32, audit H14). Configured from the environment by the
 * model router; nothing here is tenant-controlled, so the base URL isn't user input.
 */
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  OutboundCancelledError,
  OutboundNetworkError,
  OutboundTimeoutError,
  outboundRequest,
  type OutboundResponse,
} from "@/lib/outbound-http";
import type {
  LLMMessage,
  LLMProvider,
  LLMProviderOptions,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
} from "./llm-provider.interface";
import {
  type CallFailure,
  Semaphore,
  retryAfterMs,
  withRetries,
} from "./resilience";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  name?: string;
  timeoutMs?: number;
  /** Sent as `dimensions` on embedding calls (providers that support shortened vectors). */
  embeddingDimensions?: number;
  models: {
    TIER_1_FAST: string;
    TIER_2_REASONING: string;
    TIER_3_EMBEDDING: string;
  };
  /** At most this many calls in flight to this provider (LLM_MAX_CONCURRENCY, FX-79). Unset: no limit. */
  maxConcurrency?: number;
}

import { envNumber } from "@/lib/env-number";

/** Default output bound for a chat call (FX-79): no turn can run away with tokens. */
export const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_CALL_BUDGET_MS = envNumber("LLM_TIMEOUT_MS", 45_000, 5_000);


interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface WireResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: WireToolCall[] };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  data?: Array<{ embedding?: number[] }>;
}

function parseToolArguments(text: string | undefined): Record<string, unknown> {
  if (typeof text !== "string" || !text.trim()) {
    throw new AppError(
      "AI_TOOL_VALIDATION_FAILED",
      "AI provider returned a tool call without JSON arguments.",
      502,
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new AppError(
      "AI_TOOL_VALIDATION_FAILED",
      "AI provider returned malformed JSON for a tool call.",
      502,
    );
  }
}

/** Messages in the wire format; an assistant turn that called tools must carry them before the tool results. */
function toWireMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? {}),
        },
      })),
    };
  }
  if (m.role === "tool")
    return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
  return {
    role: m.role,
    content: m.content,
    ...(m.name ? { name: m.name } : {}),
  };
}

function usageOf(data: WireResponse): LLMUsage {
  const prompt = data.usage?.prompt_tokens ?? 0;
  const completion = data.usage?.completion_tokens ?? 0;
  const cached = data.usage?.prompt_tokens_details?.cached_tokens;
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: data.usage?.total_tokens ?? prompt + completion,
    ...(typeof cached === "number" && cached > 0
      ? { cached_tokens: Math.min(cached, prompt) }
      : {}), // FX-70
    ...(typeof reasoning === "number" && reasoning > 0
      ? { reasoning_tokens: reasoning }
      : {}), // FX-79
  };
}

function classifyFailure(err: unknown): CallFailure {
  if (err instanceof AppError && err.details) {
    const d = err.details as {
      status?: number;
      retryAfterMs?: number;
      failure_kind?: string;
    };
    return {
      status: d.status,
      retryAfterMs: d.retryAfterMs,
      timedOut: d.failure_kind === "timeout",
    };
  }
  return {};
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly providerName: string;
  private readonly slots: Semaphore | null;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.providerName = cfg.name ?? "openai-compatible";
    this.slots =
      cfg.maxConcurrency && cfg.maxConcurrency > 0
        ? new Semaphore(cfg.maxConcurrency)
        : null;
  }

  /** Calls in flight right now (for tests and dashboards). */
  public get inFlight(): number {
    return this.slots?.inUse ?? 0;
  }

  public get embeddingDimensions(): number | undefined {
    return this.cfg.embeddingDimensions;
  }

  public modelFor(tier: keyof OpenAICompatibleConfig["models"]): string {
    return this.cfg.models[tier];
  }

  private async post(
    path: string,
    body: unknown,
    timeoutMs = this.cfg.timeoutMs ?? 30_000,
    signal?: AbortSignal,
  ): Promise<WireResponse> {
    // The base URL is platform configuration (LLM_BASE_URL), so a local Ollama/vLLM works; limits still apply
    let res: OutboundResponse;
    try {
      res = await outboundRequest(
        `${this.cfg.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.cfg.apiKey
              ? { Authorization: `Bearer ${this.cfg.apiKey}` }
              : {}),
          },
          body: JSON.stringify(body),
          timeoutMs,
          signal,
          maxResponseBytes: 16 * 1024 * 1024,
          platformConfigured: true,
        },
      );
    } catch (err) {
      if (err instanceof OutboundCancelledError) throw err;
      // The low-level reason goes to the server log only (DNS failure, connection reset, a blocked address...)
      logger.warn("llm.provider_unreachable", {
        provider: this.providerName,
        reason:
          err instanceof OutboundNetworkError ? err.networkCode
          : err instanceof OutboundTimeoutError ? "TIMEOUT"
          : err instanceof AppError ? err.code
          : (err as Error)?.name ?? "unknown",
      });
      // Network errors name the provider's host (it can be internal): tenants see only that it failed (Phase 3 F3)
      const code =
        err instanceof OutboundTimeoutError
          ? "timed out"
          : "could not be reached";
      throw new AppError(
        "LLM_PROVIDER_ERROR",
        `AI provider ${this.providerName} ${code}.`,
        502,
        {
          failure_kind:
            err instanceof OutboundTimeoutError ? "timeout" : "network",
        },
      );
    }
    if (res.status < 200 || res.status >= 300) {
      // The provider's own error text can include account details; keep it short and out of tenant-facing messages
      const wait = retryAfterMs(res.headers["retry-after"]);
      throw new AppError(
        "LLM_PROVIDER_ERROR",
        `AI provider ${this.providerName} answered HTTP ${res.status}.`,
        502,
        {
          status: res.status,
          ...(wait !== undefined ? { retryAfterMs: wait } : {}),
        },
      );
    }
    try {
      return JSON.parse(res.body) as WireResponse;
    } catch {
      throw new AppError(
        "LLM_PROVIDER_ERROR",
        `AI provider ${this.providerName} answered with something that isn't JSON.`,
        502,
      );
    }
  }

  public async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    options?: LLMProviderOptions,
  ): Promise<LLMResponse> {
    const started = Date.now();
    const model = options?.model ?? this.cfg.models.TIER_1_FAST;
    const deadline =
      options?.deadline_ms ??
      Date.now() +
        (options?.timeout_ms ?? this.cfg.timeoutMs ?? DEFAULT_CALL_BUDGET_MS);

    const queueStart = Date.now();
    const release = this.slots ? await this.slots.acquire(deadline) : () => {};
    const queueMs = Date.now() - queueStart;

    let throttled = 0;
    let data: WireResponse;
    try {
      data = await withRetries(
        deadline,
        (remainingMs) =>
          this.post(
            "/chat/completions",
            {
              model,
              messages: messages.map(toWireMessage),
              ...(tools?.length
                ? {
                    tools: tools.map((t) => ({
                      type: "function",
                      function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                      },
                    })),
                  }
                : {}),
              temperature: options?.temperature ?? 0.2,
              max_tokens: options?.max_tokens ?? DEFAULT_MAX_TOKENS,
            },
            Math.min(
              remainingMs,
              options?.timeout_ms ?? this.cfg.timeoutMs ?? remainingMs,
            ),
            options?.signal,
          ),
        classifyFailure,
        (info) => {
          if (info.reason === "HTTP 429") throttled++;
        },
      );
    } finally {
      release();
    }

    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: LLMToolCall[] = (msg.tool_calls ?? []).map((tc, i) => {
      if (tc.type !== undefined && tc.type !== "function") {
        throw new AppError(
          "AI_TOOL_VALIDATION_FAILED",
          "AI provider returned an unsupported tool call type.",
          502,
        );
      }
      if (
        !tc.function?.name ||
        !/^[a-z][a-z0-9_.-]{0,127}$/i.test(tc.function.name)
      ) {
        throw new AppError(
          "AI_TOOL_VALIDATION_FAILED",
          "AI provider returned a tool call without a valid tool name.",
          502,
        );
      }
      return {
        id: tc.id ?? `call_${i}`,
        name: tc.function.name,
        arguments: parseToolArguments(tc.function.arguments),
      };
    });
    return {
      content: msg.content ?? "",
      tool_calls: toolCalls,
      usage: usageOf(data),
      model: data.model ?? model,
      latency_ms: Date.now() - started,
      queue_ms: queueMs,
      throttled,
    };
  }

  public async generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      max_tokens?: number;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const messages: LLMMessage[] = [
      ...(options?.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }]
        : []),
      { role: "user", content: prompt },
    ];
    const res = await this.chat(messages, undefined, {
      temperature: options?.temperature,
      max_tokens: options?.max_tokens,
      signal: options?.signal,
    });
    return res.content;
  }

  public async structuredOutput<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMProviderOptions,
  ): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    const instructed: LLMMessage[] = [
      ...messages,
      {
        role: "system",
        content: `Reply with a single JSON object matching ${schemaDescription}. No prose, no code fences.`,
      },
    ];
    const res = await this.chat(instructed, undefined, {
      ...options,
      temperature: options?.temperature ?? 0,
    });
    const text = res.content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "");
    const parsed: unknown = JSON.parse(text);
    return { data: parsed as T, usage: res.usage, latency_ms: res.latency_ms };
  }

  public async embed(text: string): Promise<number[]> {
    if (!this.cfg.models.TIER_3_EMBEDDING) {
      // No vendor default (FX-88): a wrong model name would silently fail or return vectors of another size
      throw new AppError(
        "AI_PROVIDER_NOT_CONFIGURED",
        `LLM_EMBEDDING_MODEL is not set for AI provider ${this.providerName}.`,
        424,
      );
    }
    const data = await this.post("/embeddings", {
      model: this.cfg.models.TIER_3_EMBEDDING,
      input: text,
      ...(this.cfg.embeddingDimensions
        ? { dimensions: this.cfg.embeddingDimensions }
        : {}),
    });
    const embedding = data.data?.[0]?.embedding;
    if (!embedding?.length)
      throw new AppError(
        "LLM_PROVIDER_ERROR",
        `AI provider ${this.providerName} returned no embedding.`,
        502,
      );
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
    private readonly reason = "No AI provider is configured. Set LLM_BASE_URL (and LLM_API_KEY), or AI_DEMO_MODE=1 for the offline demo.",
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
  public async structuredOutput<T>(): Promise<{
    data: T;
    usage: LLMUsage;
    latency_ms: number;
  }> {
    return this.refuse();
  }
  public async embed(): Promise<number[]> {
    return this.refuse();
  }
}
