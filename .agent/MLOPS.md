# CommerceOS MLOps & LLM Management Standard

> **Status:** Mostly TARGET. Only the mock LLM provider and model router exist (`src/domains/ai/providers/`).

## 1. LLM Provider Abstraction Layer

CommerceOS abstracts model providers behind a unified `LLMProvider` interface to prevent vendor lock-in and enable seamless runtime fallbacks:
```typescript
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface LLMResponse {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMProvider {
  chat(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  embed(text: string): Promise<number[]>;
}
```

---

## 2. Prompt Versioning & Storage Strategy

- **Location**: Prompts are registered in `src/domains/ai/prompts/prompt-registry.ts` (current); versioned per-agent prompt files are TARGET.
- **Prompt Registry Schema**:
  - `prompt_name`: Unique identifier.
  - `version`: SemVer string.
  - `agent`: Associated agent domain.
  - `changelog`: Summary of modifications and reasons.
- **Rule**: Changing a production prompt requires running the benchmark evaluation suite in `.agent/EVALUATION.md`.

---

## 3. Drift Detection & Human Correction Loop

When an operator manually edits an AI-drafted reply or overrides an agent action:
1. The pair `(original_agent_draft, operator_corrected_text)` is logged to `agent_feedback_dataset`.
2. High discrepancy rates trigger an operational alert indicating prompt or knowledge drift.
3. Merchant feedback is periodically reviewed to update store RAG documents and few-shot examples.
