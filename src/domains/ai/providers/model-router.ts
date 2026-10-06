/**
 * CommerceOS Phase 4: Model Router & Provider Circuit Breaker
 * Intelligent 3-tier model routing, cost calculation, and fallback management.
 */

import { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "./llm-provider.interface";
import { MockLLMProvider } from "./mock-llm.provider";
import { OpenAICompatibleProvider, UnconfiguredProvider } from "./openai-compatible.provider";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { KillSwitchActiveError } from "@/lib/errors";
import { LLM_BUSY, LLM_DEADLINE } from "./resilience";

export type ModelTier = "TIER_1_FAST" | "TIER_2_REASONING" | "TIER_3_EMBEDDING";

export interface ModelPricing {
  promptCostPer1M: number;
  completionCostPer1M: number;
  /** Price of prompt tokens served from the provider's cache; defaults to promptCostPer1M (no cache discount). FX-70 */
  cachedPromptCostPer1M?: number;
}

/**
 * Placeholder prices per 1M tokens (USD), used only when LLM_PRICING_JSON is unset. Set LLM_PRICING_JSON to the active
 * provider's real prices (render.yaml does), e.g. {"TIER_1_FAST":{"promptCostPer1M":0.15,"cachedPromptCostPer1M":0.014,
 * "completionCostPer1M":0.6}}.
 */
const DEFAULT_TIER_PRICING: Record<ModelTier, ModelPricing> = {
  TIER_1_FAST: {
    promptCostPer1M: 0.075,
    completionCostPer1M: 0.30,
  },
  TIER_2_REASONING: {
    promptCostPer1M: 3.00,
    completionCostPer1M: 15.00,
  },
  TIER_3_EMBEDDING: {
    promptCostPer1M: 0.02,
    completionCostPer1M: 0.0,
  },
};

function tierPricing(): Record<ModelTier, ModelPricing> {
  try {
    const override = process.env.LLM_PRICING_JSON ? (JSON.parse(process.env.LLM_PRICING_JSON) as Partial<Record<ModelTier, ModelPricing>>) : {};
    return { ...DEFAULT_TIER_PRICING, ...override };
  } catch {
    return DEFAULT_TIER_PRICING;
  }
}

/** USD to BDT for cost display; USD_BDT_RATE overrides the default. */
const BDT_CONVERSION_RATE = Number(process.env.USD_BDT_RATE) > 0 ? Number(process.env.USD_BDT_RATE) : 120.0;

export type AiMode = "LIVE" | "DEMO" | "NOT_CONFIGURED";

/**
 * This server's share of a provider's concurrency limit (FX-79): the plan's limit (e.g. Ollama Cloud Pro = 3) divided
 * by STORE_SERVER_COUNT, at least 1. Unset or invalid: no limit.
 */
function concurrencyShare(limit: string | undefined, env: NodeJS.ProcessEnv): number | undefined {
  const total = Number(limit);
  if (!Number.isInteger(total) || total <= 0) return undefined;
  const servers = Number(env.STORE_SERVER_COUNT);
  return Math.max(1, Math.floor(total / (Number.isInteger(servers) && servers > 0 ? servers : 1)));
}

export class ModelRouter {
  private static instance: ModelRouter;
  private primaryProvider: LLMProvider;
  private fallbackProvider: LLMProvider | null;
  private embeddingProvider: LLMProvider | null;
  private failureCount = 0;
  private circuitOpenUntil = 0;
  private readonly failureThreshold = 5;
  private readonly circuitCooldownMs = 60000; // FX-79: 5 consecutive primary failures open the circuit for 60 s

  /**
   * Providers come from the environment (FX-32, audit H14). This used to be the keyword mock as both primary and
   * fallback, answering as if it were a model.
   * - LLM_BASE_URL (+ LLM_API_KEY, LLM_PROVIDER_NAME): a real OpenAI-compatible provider; LLM_FALLBACK_BASE_URL (+
   *   LLM_FALLBACK_API_KEY) an optional second one. Models: LLM_MODEL_FAST, LLM_MODEL_REASONING, LLM_EMBEDDING_MODEL.
   * - LLM_EMBEDDING_BASE_URL (+ LLM_EMBEDDING_API_KEY, LLM_EMBEDDING_PROVIDER_NAME, LLM_EMBEDDING_DIMENSIONS): a separate
   *   OpenAI-compatible provider used only for embeddings, with the model from LLM_EMBEDDING_MODEL.
   * - AI_DEMO_MODE=1 without LLM_BASE_URL: the offline keyword demo, labelled "Demo AI" everywhere it answers.
   * - Neither: every AI call refuses with 424 AI_PROVIDER_NOT_CONFIGURED. The mock is never a silent fallback.
   */
  private constructor() {
    this.primaryProvider = new UnconfiguredProvider();
    this.fallbackProvider = null;
    this.embeddingProvider = null;
    this.configure(process.env);
  }

  /** (Re)builds the providers from an environment; also resets the circuit breaker. */
  public configure(env: NodeJS.ProcessEnv): void {
    this.resetCircuitBreakers();
    // Model names come only from configuration (FX-88, audit F24): a vendor default would send, say, "gpt-4o" to
    // Ollama Cloud. The reasoning tier may reuse the fast model; nothing else is guessed.
    const models = {
      TIER_1_FAST: env.LLM_MODEL_FAST?.trim() || "",
      TIER_2_REASONING: env.LLM_MODEL_REASONING?.trim() || env.LLM_MODEL_FAST?.trim() || "",
      TIER_3_EMBEDDING: env.LLM_EMBEDDING_MODEL?.trim() || "",
    };
    if (env.LLM_BASE_URL && !models.TIER_1_FAST) {
      this.primaryProvider = new UnconfiguredProvider(
        `LLM_MODEL_FAST is not set for AI provider ${env.LLM_PROVIDER_NAME || "at LLM_BASE_URL"}. Set the model names explicitly.`
      );
    } else if (env.LLM_BASE_URL) {
      this.primaryProvider = new OpenAICompatibleProvider({
        baseUrl: env.LLM_BASE_URL,
        apiKey: env.LLM_API_KEY,
        name: env.LLM_PROVIDER_NAME,
        models,
        maxConcurrency: concurrencyShare(env.LLM_MAX_CONCURRENCY, env),
      });
    } else if (env.AI_DEMO_MODE === "1") {
      this.primaryProvider = new MockLLMProvider();
    } else {
      this.primaryProvider = new UnconfiguredProvider();
    }
    // Embeddings can come from a different provider than chat (e.g. chat on Groq, which has no embedding model)
    const dims = Number(env.LLM_EMBEDDING_DIMENSIONS);
    this.embeddingProvider = env.LLM_EMBEDDING_BASE_URL
      ? new OpenAICompatibleProvider({
          baseUrl: env.LLM_EMBEDDING_BASE_URL,
          apiKey: env.LLM_EMBEDDING_API_KEY,
          name: env.LLM_EMBEDDING_PROVIDER_NAME || "embeddings",
          models,
          embeddingDimensions: Number.isInteger(dims) && dims > 0 ? dims : undefined,
        })
      : null;
    // A fallback is a second provider with its OWN model names (FX-79, audit F24: it used to be sent the primary's
    // names, so it failed exactly when it was needed). Without LLM_FALLBACK_MODEL_FAST there is no fallback.
    const fallbackFast = env.LLM_FALLBACK_MODEL_FAST?.trim() || "";
    this.fallbackProvider =
      env.LLM_FALLBACK_BASE_URL && fallbackFast
        ? new OpenAICompatibleProvider({
            baseUrl: env.LLM_FALLBACK_BASE_URL,
            apiKey: env.LLM_FALLBACK_API_KEY,
            name: env.LLM_FALLBACK_PROVIDER_NAME || "fallback",
            models: { TIER_1_FAST: fallbackFast, TIER_2_REASONING: env.LLM_FALLBACK_MODEL_REASONING?.trim() || fallbackFast, TIER_3_EMBEDDING: "" },
            maxConcurrency: concurrencyShare(env.LLM_FALLBACK_MAX_CONCURRENCY, env),
          })
        : null;
  }

  /** What's answering: LIVE (a real provider), DEMO (offline keyword mock) or NOT_CONFIGURED. */
  public getMode(): AiMode {
    if (this.primaryProvider instanceof MockLLMProvider) return "DEMO";
    if (this.primaryProvider instanceof UnconfiguredProvider) return "NOT_CONFIGURED";
    return "LIVE";
  }

  public getStatus(): { mode: AiMode; provider: string; models: Record<ModelTier, string>; fallback: string | null; embedding_provider: string | null } {
    return {
      mode: this.getMode(),
      provider: this.primaryProvider.providerName,
      models: {
        TIER_1_FAST: this.resolveModelName("TIER_1_FAST"),
        TIER_2_REASONING: this.resolveModelName("TIER_2_REASONING"),
        TIER_3_EMBEDDING: this.resolveModelName("TIER_3_EMBEDDING"),
      },
      fallback: this.fallbackProvider?.providerName ?? null,
      embedding_provider: this.embeddingProvider?.providerName ?? null,
    };
  }

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  public setPrimaryProvider(provider: LLMProvider): void {
    this.primaryProvider = provider;
  }

  public setFallbackProvider(provider: LLMProvider | null): void {
    this.fallbackProvider = provider;
  }

  public getActiveProvider(tier: ModelTier = "TIER_1_FAST"): { provider: LLMProvider; isFallback: boolean } {
    const now = Date.now();
    if (this.fallbackProvider && this.failureCount >= this.failureThreshold && now < this.circuitOpenUntil) {
      return { provider: this.fallbackProvider, isFallback: true };
    }
    // If cooldown has passed, half-open circuit
    if (now >= this.circuitOpenUntil && this.failureCount >= this.failureThreshold) {
      this.failureCount = Math.floor(this.failureThreshold / 2);
    }
    return { provider: this.primaryProvider, isFallback: false };
  }

  public recordSuccess(): void {
    this.failureCount = Math.max(0, this.failureCount - 1);
  }

  public recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.circuitOpenUntil = Date.now() + this.circuitCooldownMs;
    }
  }

  public isCircuitOpen(): boolean {
    return this.failureCount >= this.failureThreshold && Date.now() < this.circuitOpenUntil;
  }

  public getCircuitBreakerStatus(providerName?: string): { state: "OPEN" | "CLOSED"; failureCount: number } {
    const isOpen = this.isCircuitOpen();
    return { state: isOpen ? "OPEN" : "CLOSED", failureCount: this.failureCount };
  }

  public resetCircuitBreakers(): void {
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }

  /** The model a tier uses: from the configuration, not the hard-coded gemini-1.5 names (FX-32). */
  public resolveModelName(tier: ModelTier): string {
    if (this.primaryProvider instanceof OpenAICompatibleProvider) return this.primaryProvider.modelFor(tier);
    if (this.primaryProvider instanceof MockLLMProvider) return "demo-keyword-mock";
    return "not-configured";
  }

  /** `cachedPromptTokens` is the part of `promptTokens` the provider served from its cache, billed at the cached rate. */
  public calculateCost(
    tierOrModel: ModelTier | string,
    promptTokens: number,
    completionTokens: number,
    cachedPromptTokens = 0
  ): { costUsd: number; costBdt: number } {
    const prices = tierPricing();
    const pricing = prices[tierOrModel as ModelTier] || prices.TIER_1_FAST;
    const cached = Math.min(Math.max(0, cachedPromptTokens), promptTokens);
    const cachedRate = pricing.cachedPromptCostPer1M ?? pricing.promptCostPer1M;
    const promptCost =
      ((promptTokens - cached) / 1_000_000) * pricing.promptCostPer1M + (cached / 1_000_000) * cachedRate;
    const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPer1M;
    const costUsd = Number((promptCost + completionCost).toFixed(6));
    const costBdt = Number((costUsd * BDT_CONVERSION_RATE).toFixed(4));
    return { costUsd, costBdt };
  }

  /** The model a given provider uses for a tier: each provider has its own names (FX-79, audit F24). */
  private modelOf(provider: LLMProvider, tier: ModelTier): string {
    if (provider instanceof OpenAICompatibleProvider) return provider.modelFor(tier);
    return this.resolveModelName(tier);
  }

  /**
   * One model call with routing. `deadlineMs` (absolute) bounds the whole call, waits and retries included; `maxTokens`
   * bounds the output (FX-79).
   */
  public async chatWithRouting(
    tier: ModelTier,
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    options: { deadlineMs?: number; maxTokens?: number } = {}
  ): Promise<LLMResponse & { costUsd: number; costBdt: number; isFallback: boolean; provider: string; demo: boolean }> {
    const { provider, isFallback } = this.getActiveProvider(tier);
    if (PlatformSafetyService.isExecutionBlocked("PROVIDER", provider.providerName)) {
      throw new KillSwitchActiveError("PROVIDER", `AI provider ${provider.providerName} is paused by the platform.`); // FX-34
    }
    const callOptions = (p: LLMProvider) => ({
      model: this.modelOf(p, tier),
      ...(options.deadlineMs ? { deadline_ms: options.deadlineMs } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });

    try {
      const response = await provider.chat(messages, tools, callOptions(provider));
      this.recordSuccess();
      // The offline demo costs nothing; real usage is priced from the tokens the provider reports (FX-32)
      const { costUsd, costBdt } =
        this.getMode() === "LIVE"
          ? this.calculateCost(tier, response.usage.prompt_tokens, response.usage.completion_tokens, response.usage.cached_tokens)
          : { costUsd: 0, costBdt: 0 };
      return {
        ...response,
        costUsd,
        costBdt,
        isFallback,
        provider: provider.providerName,
        demo: this.getMode() === "DEMO",
      };
    } catch (err) {
      if (this.getMode() === "NOT_CONFIGURED") throw err; // nothing to fall back to, and not a provider failure
      // Our own limits (no free slot, out of time) say nothing about the provider's health
      const code = (err as { code?: string }).code;
      if (code !== LLM_BUSY && code !== LLM_DEADLINE) this.recordFailure();
      // A second real provider, if configured; never the mock (FX-32)
      if (!isFallback && this.fallbackProvider && !PlatformSafetyService.isExecutionBlocked("PROVIDER", this.fallbackProvider.providerName)) {
        try {
          const fallbackResponse = await this.fallbackProvider.chat(messages, tools, callOptions(this.fallbackProvider));
          const { costUsd, costBdt } = this.calculateCost(
            tier,
            fallbackResponse.usage.prompt_tokens,
            fallbackResponse.usage.completion_tokens,
            fallbackResponse.usage.cached_tokens
          );
          return {
            ...fallbackResponse,
            costUsd,
            costBdt,
            isFallback: true,
            provider: this.fallbackProvider.providerName,
            demo: false,
          };
        } catch {
          // Fallback also failed
        }
      }
      throw err;
    }
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const provider = this.embeddingProvider ?? this.getActiveProvider("TIER_3_EMBEDDING").provider;
    if (PlatformSafetyService.isExecutionBlocked("PROVIDER", provider.providerName)) {
      throw new KillSwitchActiveError("PROVIDER", `AI provider ${provider.providerName} is paused by the platform.`);
    }
    try {
      const embedding = await provider.embed(text);
      this.recordSuccess();
      return embedding;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}

export const modelRouter = ModelRouter.getInstance();
