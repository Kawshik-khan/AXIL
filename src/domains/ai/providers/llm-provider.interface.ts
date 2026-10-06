/**
 * CommerceOS Phase 4: LLM Provider Abstraction Layer
 * Vendor-agnostic interface supporting OpenAI, Anthropic, Google, OpenRouter, and local models.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  /** On an assistant turn that called tools: real providers need it sent back before the tool results (FX-32). */
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Part of prompt_tokens served from the provider's prompt cache (`prompt_tokens_details.cached_tokens`), if reported. */
  cached_tokens?: number;
  /** Hidden reasoning tokens inside completion_tokens (`completion_tokens_details.reasoning_tokens`), if reported. */
  reasoning_tokens?: number;
}

export interface LLMResponse {
  content: string;
  tool_calls?: LLMToolCall[];
  usage: LLMUsage;
  model: string;
  latency_ms: number;
}

export interface LLMProviderOptions {
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  model?: string;
  /** Absolute time (epoch ms) by which the call, including waits and retries, must finish (FX-79). */
  deadline_ms?: number;
}

export interface LLMProvider {
  readonly providerName: string;

  chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    options?: LLMProviderOptions
  ): Promise<LLMResponse>;

  generate(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number; max_tokens?: number }
  ): Promise<string>;

  structuredOutput<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMProviderOptions
  ): Promise<{ data: T; usage: LLMUsage; latency_ms: number }>;

  embed(text: string): Promise<number[]>;
}
