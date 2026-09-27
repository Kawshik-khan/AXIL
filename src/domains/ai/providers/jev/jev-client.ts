/**
 * CommerceOS Phase 4: Jev System One Client & Circuit Breaker
 * Provides high-speed, parallel System 1 decisions via TypeSafe AI.
 * Includes multi-tenant Redis deduplication and resilient offline fallback.
 */

import * as crypto from "crypto";
import {
  JevEvaluateRequest,
  JevEvaluateResponse,
} from "@/types/ai";
import {
  JevEvaluateRequestSchema,
  JevEvaluateResponseSchema,
} from "./jev.schema";
import {
  JevClientError,
  JevCircuitBreakerOpenError,
} from "./jev.errors";
import { MockJevProvider } from "./mock-jev.provider";
import { cache } from "@/infrastructure/redis/client";

export class JevClient {
  private static instance: JevClient;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private mockProvider: MockJevProvider;
  private useMockFallback: boolean;

  private failureCount = 0;
  private circuitOpenUntil = 0;
  private readonly failureThreshold = 5;
  private readonly circuitCooldownMs = 15000;
  private readonly timeoutMs = 3000;

  private constructor() {
    this.apiUrl = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1";
    this.apiKey = process.env.TYPESAFE_API_KEY || "";
    this.mockProvider = new MockJevProvider();
    // Default to mock if no live API key is set
    this.useMockFallback = !this.apiKey;
  }

  public static getInstance(): JevClient {
    if (!JevClient.instance) {
      JevClient.instance = new JevClient();
    }
    return JevClient.instance;
  }

  public setMockMode(enabled: boolean): void {
    this.useMockFallback = enabled;
  }

  public getMockProvider(): MockJevProvider {
    return this.mockProvider;
  }

  public isCircuitOpen(): boolean {
    return this.failureCount >= this.failureThreshold && Date.now() < this.circuitOpenUntil;
  }

  public getCircuitBreakerStatus(): { state: "OPEN" | "CLOSED" | "HALF_OPEN"; failureCount: number } {
    const now = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      if (now < this.circuitOpenUntil) {
        return { state: "OPEN", failureCount: this.failureCount };
      }
      return { state: "HALF_OPEN", failureCount: this.failureCount };
    }
    return { state: "CLOSED", failureCount: this.failureCount };
  }

  public resetCircuitBreaker(): void {
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }

  public async evaluate(
    tenantId: string,
    rawRequest: JevEvaluateRequest
  ): Promise<JevEvaluateResponse> {
    const now = Date.now();

    // Check circuit breaker status
    if (this.failureCount >= this.failureThreshold && now < this.circuitOpenUntil) {
      throw new JevCircuitBreakerOpenError({
        failureCount: this.failureCount,
        openUntil: new Date(this.circuitOpenUntil).toISOString(),
      });
    }

    // Half-open circuit transition after cooldown
    if (this.failureCount >= this.failureThreshold && now >= this.circuitOpenUntil) {
      this.failureCount = Math.floor(this.failureThreshold / 2);
    }

    // Validate request schema
    const validatedRequest = JevEvaluateRequestSchema.parse(rawRequest);

    // 1. Multi-tenant Redis caching (120s TTL)
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ tenantId, request: validatedRequest }))
      .digest("hex");
    const cacheKey = `tenant:${tenantId}:jev:${requestHash}`;

    try {
      const cached = await cache.get<JevEvaluateResponse>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Redis offline or missing env; proceed without cache
    }

    // 2. If configured for mock or no live key, execute offline mock provider
    if (this.useMockFallback || !this.apiKey) {
      try {
        const mockResult = await this.mockProvider.evaluate(validatedRequest);
        this.failureCount = Math.max(0, this.failureCount - 1);
        try {
          await cache.set(cacheKey, mockResult, 120);
        } catch {
          // ignore cache errors
        }
        return mockResult;
      } catch (err: unknown) {
        this.recordFailure();
        throw new JevClientError("Mock Jev provider execution failed", { error: String(err) });
      }
    }

    // 3. Live HTTP call to TypeSafe AI
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.apiUrl}/decide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          "X-Tenant-ID": tenantId,
        },
        body: JSON.stringify(validatedRequest),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const rawData = await response.json();
      const parsed = JevEvaluateResponseSchema.parse({
        results: rawData.results || rawData,
        latency_ms: Date.now() - startTime,
        tokens_evaluated: rawData.usage?.total_tokens || 0,
      });

      this.failureCount = Math.max(0, this.failureCount - 1);

      try {
        await cache.set(cacheKey, parsed, 120);
      } catch {
        // ignore cache errors
      }

      return parsed;
    } catch (err: unknown) {
      clearTimeout(timer);
      this.recordFailure();

      // Graceful fallback to Mock provider on network/service failure if live key fails
      try {
        return await this.mockProvider.evaluate(validatedRequest);
      } catch {
        throw new JevClientError("Failed to evaluate with Jev System One", { error: String(err) });
      }
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.circuitOpenUntil = Date.now() + this.circuitCooldownMs;
    }
  }
}

export const jevClient = JevClient.getInstance();
