/**
 * CommerceOS Phase 4: Model Router & Provider Circuit Breaker
 * Intelligent 3-tier model routing, cost calculation, and fallback management.
 */

import { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "./llm-provider.interface";
import { MockLLMProvider } from "./mock-llm.provider";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { KillSwitchActiveError } from "@/lib/errors";

export type ModelTier = "TIER_1_FAST" | "TIER_2_REASONING" | "TIER_3_EMBEDDING";

export interface ModelPricing {
  promptCostPer1M: number;
  completionCostPer1M: number;
}

const TIER_PRICING: Record<ModelTier, ModelPricing> = {
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

const BDT_CONVERSION_RATE = 120.0; // 1 USD = 120 BDT

export class ModelRouter {
  private static instance: ModelRouter;
  private primaryProvider: LLMProvider;
  private fallbackProvider: LLMProvider;
  private failureCount = 0;
  private circuitOpenUntil = 0;
  private readonly failureThreshold = 5;
  private readonly circuitCooldownMs = 30000;

  private constructor() {
    this.primaryProvider = new MockLLMProvider();
    this.fallbackProvider = new MockLLMProvider();
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

  public setFallbackProvider(provider: LLMProvider): void {
    this.fallbackProvider = provider;
  }

  public getActiveProvider(tier: ModelTier = "TIER_1_FAST"): { provider: LLMProvider; isFallback: boolean } {
    const now = Date.now();
    if (this.failureCount >= this.failureThreshold && now < this.circuitOpenUntil) {
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

  public resolveModelName(tier: ModelTier): string {
    switch (tier) {
      case "TIER_1_FAST":
        return "gemini-1.5-flash";
      case "TIER_2_REASONING":
        return "gemini-1.5-pro";
      case "TIER_3_EMBEDDING":
        return "text-embedding-3-small";
    }
  }

  public calculateCost(
    tierOrModel: ModelTier | string,
    promptTokens: number,
    completionTokens: number
  ): { costUsd: number; costBdt: number } {
    const pricing = TIER_PRICING[tierOrModel as ModelTier] || TIER_PRICING.TIER_1_FAST;
    const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPer1M;
    const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPer1M;
    const costUsd = Number((promptCost + completionCost).toFixed(6));
    const costBdt = Number((costUsd * BDT_CONVERSION_RATE).toFixed(4));
    return { costUsd, costBdt };
  }

  public async chatWithRouting(
    tier: ModelTier,
    messages: LLMMessage[],
    tools?: LLMToolDefinition[]
  ): Promise<LLMResponse & { costUsd: number; costBdt: number; isFallback: boolean }> {
    const { provider, isFallback } = this.getActiveProvider(tier);
    const modelName = this.resolveModelName(tier);
    if (PlatformSafetyService.isExecutionBlocked("PROVIDER", provider.providerName)) {
      throw new KillSwitchActiveError("PROVIDER", `AI provider ${provider.providerName} is paused by the platform.`); // FX-34
    }

    try {
      const response = await provider.chat(messages, tools, { model: modelName });
      this.recordSuccess();
      const { costUsd, costBdt } = this.calculateCost(
        tier,
        response.usage.prompt_tokens,
        response.usage.completion_tokens
      );
      return {
        ...response,
        costUsd,
        costBdt,
        isFallback,
      };
    } catch (err) {
      this.recordFailure();
      // Try fallback if primary failed and wasn't already fallback
      if (!isFallback) {
        try {
          const fallbackResponse = await this.fallbackProvider.chat(messages, tools, { model: modelName });
          const { costUsd, costBdt } = this.calculateCost(
            tier,
            fallbackResponse.usage.prompt_tokens,
            fallbackResponse.usage.completion_tokens
          );
          return {
            ...fallbackResponse,
            costUsd,
            costBdt,
            isFallback: true,
          };
        } catch {
          // Fallback also failed
        }
      }
      throw err;
    }
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const { provider } = this.getActiveProvider("TIER_3_EMBEDDING");
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
