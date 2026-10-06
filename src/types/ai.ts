/**
 * CommerceOS Phase 4: Agentic AI Commerce Intelligence
 * Comprehensive Domain Types, Enums, and Protocol Contracts
 */

// ============================================================
// 1. AGENT IDENTITY & TAXONOMY
// ============================================================

export type AgentType =
  | "SUPERVISOR"
  /** The single customer-facing agent (ADR-111, FX-77): acts as the conversation, through its own nine tools. */
  | "CUSTOMER_AGENT"
  | "CUSTOMER_SUPPORT"
  | "SALES"
  | "ORDER_ASSISTANT"
  | "PRODUCT_INFO"
  | "INVENTORY"
  | "SHIPPING"
  | "PAYMENT"
  | "RETURNS"
  | "VERIFIER"
  // Phase 6 Intelligence & Decision Agents
  | "SALES_INTELLIGENCE"
  | "INVENTORY_INTELLIGENCE"
  | "CUSTOMER_INTELLIGENCE"
  | "PRODUCT_INTELLIGENCE"
  | "FORECASTING"
  | "ANOMALY_DETECTION"
  | "RECOMMENDATION"
  | "SIMULATION"
  | "DECISION_ANALYST"
  // Phase 7 Autonomous Growth & Marketing Agents
  | "GROWTH_STRATEGIST"
  | "CAMPAIGN_PLANNER"
  | "AUDIENCE_ANALYST"
  | "CUSTOMER_LIFECYCLE"
  | "CONTENT_AGENT"
  | "PERSONALIZATION_AGENT"
  | "OFFER_AGENT"
  | "RETENTION_AGENT"
  | "CHURN_INTERVENTION"
  | "PRODUCT_RECOMMENDER"
  | "EXPERIMENT_AGENT"
  | "ATTRIBUTION_AGENT"
  | "MARKETING_ANALYST"
  // Phase 8 Autonomous Commerce Operations Agents
  | "OPERATIONS_SUPERVISOR"
  | "INVENTORY_OPERATIONS"
  | "PROCUREMENT"
  | "PRICING_OPERATIONS"
  | "ORDER_OPERATIONS"
  | "FULFILLMENT"
  | "SHIPPING_OPERATIONS"
  | "CUSTOMER_SUPPORT_OPERATIONS"
  | "PAYMENT_OPERATIONS"
  | "FINANCE_OPERATIONS"
  | "RETURNS_OPERATIONS"
  | "EXCEPTION_MANAGEMENT"
  | "RECONCILIATION"
  | "SUPPLIER_OPERATIONS"
  | "OPERATIONS_OPTIMIZATION"
  // Phase 9 Enterprise Intelligence & Ecosystem Agents
  | "ENTERPRISE_SUPERVISOR"
  | "ENTERPRISE_INTELLIGENCE"
  | "ENTERPRISE_ANALYTICS"
  | "BENCHMARKING"
  | "INTEGRATION"
  | "DATA_GOVERNANCE"
  | "DATA_QUALITY"
  | "ENTERPRISE_OPERATIONS"
  | "ENTERPRISE_FINANCE"
  | "ENTERPRISE_INVENTORY"
  | "ENTERPRISE_PROCUREMENT"
  | "ENTERPRISE_SECURITY"
  | "ENTERPRISE_REPORTING"
  | "ECOSYSTEM"
  | "DEVELOPER_PLATFORM"
  // Phase 10 Autonomous Commerce Platform Agents
  | "AUTONOMOUS_SUPERVISOR"
  | "OBJECTIVES_AGENT"
  | "STRATEGY_AGENT"
  | "DECISION_AGENT"
  | "LEARNING_AGENT"
  | "OPTIMIZATION_AGENT"
  | "PLATFORM_HEALTH_AGENT"
  | "COST_GOVERNANCE_AGENT"
  // Future Agents supported by extensible architecture
  | "MARKETING"
  | "FINANCE"
  | "ANALYTICS"
  | "SEO";

export type AgentStatus = "ACTIVE" | "INACTIVE" | "PAUSED" | "MAINTENANCE";

export type AIMode = "AI_AUTONOMOUS" | "AI_COPILOT" | "DISABLED";

export interface AgentDefinition {
  id: string;
  tenant_id: string;
  agent_type: AgentType;
  name: string;
  description: string;
  status: AgentStatus;
  model_tier: "TIER_1_FAST" | "TIER_2_REASONING" | "TIER_3_EMBEDDING";
  model_name: string;
  prompt_version: string;
  allowed_channels: string[]; // e.g. ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT"]
  allowed_tools: string[];
  max_iterations: number;
  max_tool_calls: number;
  timeout_ms: number;
  is_default: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 2. INTENT TAXONOMY
// ============================================================

export type IntentCategory =
  | "PRODUCT"
  | "ORDER"
  | "PAYMENT"
  | "SHIPPING"
  | "RETURN"
  | "CUSTOMER"
  | "SALES"
  | "GENERAL"
  | "SYSTEM";

export type CanonicalIntent =
  // PRODUCT
  | "PRODUCT_SEARCH"
  | "PRODUCT_INFORMATION"
  | "PRODUCT_PRICE"
  | "PRODUCT_AVAILABILITY"
  | "PRODUCT_VARIANT"
  | "PRODUCT_RECOMMENDATION"
  // ORDER
  | "ORDER_STATUS"
  | "ORDER_DETAILS"
  | "ORDER_MODIFICATION"
  | "ORDER_CANCELLATION"
  // PAYMENT
  | "PAYMENT_STATUS"
  | "PAYMENT_FAILURE"
  | "PAYMENT_CONFIRMATION"
  // SHIPPING
  | "SHIPPING_STATUS"
  | "SHIPPING_ESTIMATE"
  | "SHIPPING_COST"
  // RETURN
  | "RETURN_POLICY"
  | "RETURN_REQUEST"
  | "REFUND_STATUS"
  // CUSTOMER
  | "CUSTOMER_INFORMATION"
  | "CUSTOMER_SUPPORT"
  // SALES
  | "PURCHASE_INTENT"
  | "WHOLESALE_REQUEST"
  | "LEAD_REQUEST"
  // GENERAL
  | "GREETING"
  | "THANKS"
  | "UNKNOWN"
  // SYSTEM
  | "HUMAN_REQUEST"
  | "COMPLAINT"
  | "SPAM"
  | "ABUSE";

export interface ClassifiedIntent {
  intent: CanonicalIntent;
  category: IntentCategory;
  confidence: number; // 0.0 to 1.0
  target_agent: AgentType;
  extracted_entities: {
    product_names?: string[];
    variant_attributes?: Record<string, string>; // size, color
    order_numbers?: string[]; // e.g. COM-2026-000123
    phone_numbers?: string[]; // E.164 +880
    quantities?: number[];
    delivery_locations?: ("INSIDE_DHAKA" | "OUTSIDE_DHAKA" | string)[];
    payment_methods?: string[];
    price_mentions?: number[];
  };
  detected_language: "bn" | "en" | "banglish" | "mixed";
  requires_human: boolean;
  routing_strategy: "DETERMINISTIC_RULE" | "KEYWORD_HEURISTIC" | "LLM_CLASSIFIER" | "JEV_SYSTEM_ONE";
}

// ============================================================
// 3. AGENT STATE MACHINE & RUN LIFECYCLE
// ============================================================

export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_TOOL"
  | "WAITING_HUMAN"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ESCALATED";

export type AgentExecutionStep =
  | "RECEIVE"
  | "CLASSIFY"
  | "PLAN"
  | "RETRIEVE"
  | "TOOL_CALL"
  | "OBSERVE"
  | "RESPOND"
  | "VERIFY"
  | "SEND"
  | "HUMAN_HANDOFF";

export interface AgentRun {
  id: string;
  tenant_id: string;
  conversation_id: string;
  agent_type: AgentType;
  status: AgentRunStatus;
  current_step: AgentExecutionStep;
  model: string;
  prompt_version: string;
  started_at: string;
  completed_at?: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_bdt: number;
  tool_calls_count: number;
  final_response?: string;
  requires_human_approval?: boolean;
  pending_action?: {
    action_type: string;
    payload: Record<string, unknown>;
    risk_level: ToolRiskLevel;
  };
  error_code?: AIErrorCode;
  error_message?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// 4. TOOL REGISTRY & PROTOCOL
// ============================================================

export type ToolRiskLevel = "INFORMATIONAL" | "LOW_RISK" | "MEDIUM_RISK" | "HIGH_RISK";

export interface ToolDefinition {
  name: string;
  description: string;
  category: "PRODUCT" | "CUSTOMER" | "ORDER" | "PAYMENT" | "SHIPPING" | "LEAD" | "CHECKOUT" | "KNOWLEDGE" | "HUMAN" | "MARKETING" | "OPERATIONS" | "PROCUREMENT" | "PRICING" | "FINANCE" | "INVENTORY" | "ENTERPRISE" | "AUTONOMOUS";
  risk_level: ToolRiskLevel;
  required_permission: string;
  requires_confirmation: boolean;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  timeout_ms: number;
  idempotent: boolean;
}

export interface AgentToolCallRecord {
  id: string;
  tenant_id: string;
  agent_run_id: string;
  conversation_id: string;
  tool_name: string;
  input_arguments: Record<string, unknown>;
  sanitized_result?: Record<string, unknown> | unknown[];
  status: "SUCCESS" | "POLICY_REJECTED" | "ERROR" | "PENDING_CONFIRMATION";
  duration_ms: number;
  error_message?: string;
  idempotency_key?: string;
  created_at: string;
}

// ============================================================
// 5. PROMPT ARCHITECTURE & TEMPLATES
// ============================================================

export interface AgentPrompt {
  id: string;
  tenant_id: string;
  agent_type: AgentType;
  name: string;
  active_version: string;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  tenant_id: string;
  version: string; // SemVer e.g. "1.0.0"
  system_instructions: string;
  role_policy: string;
  tool_instructions: string;
  safety_rules: string;
  response_guidelines: string;
  few_shot_examples?: Array<{
    user: string;
    assistant: string;
    explanation?: string;
  }>;
  is_active: boolean;
  changelog: string;
  created_at: string;
}

// ============================================================
// 6. CONTEXT & MEMORY
// ============================================================

export interface ConversationSummary {
  id: string;
  tenant_id: string;
  conversation_id: string;
  summary_text: string;
  key_facts: string[];
  customer_intent: CanonicalIntent;
  open_issues: string[];
  last_message_index: number;
  model: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerMemory {
  id: string;
  tenant_id: string;
  customer_id: string;
  preferred_language?: "bn" | "en" | "banglish";
  preferred_channel?: string;
  product_interests?: string[];
  communication_preferences?: {
    short_answers?: boolean;
    prefers_cod?: boolean;
    usual_delivery_area?: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
  };
  notes?: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentContext {
  tenant_id: string;
  conversation_id: string;
  customer_id?: string;
  channel_type: string;
  recent_messages: Array<{
    id: string;
    sender_type: string;
    text: string;
    created_at: string;
  }>;
  summary?: ConversationSummary;
  customer_memory?: CustomerMemory;
  retrieved_knowledge: RetrievalCitation[];
  recent_orders?: Array<{
    id: string;
    order_number: string;
    status: string;
    total_amount: number;
    created_at: string;
  }>;
  active_cart_or_draft?: Record<string, unknown>;
  policy: TenantAIPolicy;
}

// ============================================================
// 7. KNOWLEDGE BASE & RAG
// ============================================================

export type KnowledgeDocumentType =
  | "FAQ"
  | "POLICY"
  | "PRODUCT_GUIDE"
  | "SHIPPING_POLICY"
  | "PAYMENT_POLICY"
  | "RETURN_POLICY"
  | "SIZE_GUIDE"
  | "WARRANTY"
  | "BUSINESS_INFO"
  | "GENERAL";

export type KnowledgeDocumentStatus =
  | "DRAFT"
  | "PROCESSING"
  | "READY_FOR_REVIEW"
  | "ACTIVE"
  | "ARCHIVED";

export interface KnowledgeDocument {
  id: string;
  tenant_id: string;
  title: string;
  document_type: KnowledgeDocumentType;
  /** PDF stays for documents stored before FX-36; new uploads are text formats only (no server-side parser yet). */
  file_format: "PDF" | "TXT" | "MARKDOWN" | "HTML" | "MANUAL_TEXT" | "CSV" | "JSON";
  raw_content?: string;
  status: KnowledgeDocumentStatus;
  version: number;
  chunk_count: number;
  language: "bn" | "en" | "mixed";
  tags: string[];
  processing_error?: string;
  created_at: string;
  updated_at: string;
}

export type ChunkType = "PARENT" | "CHILD" | "STANDARD";

export interface KnowledgeChunk {
  id: string;
  tenant_id: string;
  document_id: string;
  chunk_index: number;
  chunk_type?: ChunkType;
  parent_chunk_id?: string;
  child_chunk_ids?: string[];
  section_heading?: string;
  content: string;
  embedding: number[]; // 1536-dimensional vector
  bm25_tokens?: string[];
  token_count: number;
  metadata: {
    document_title: string;
    document_type: KnowledgeDocumentType;
    version: number;
    language: string;
    parent_heading?: string;
  };
  created_at: string;
}

export interface RetrievalCitation {
  document_id: string;
  document_title: string;
  section: string;
  chunk_id: string;
  parent_chunk_id?: string;
  version: number;
  similarity_score: number;
  content_snippet: string;
  parent_content?: string;
}

// ── Agentic RAG & Hybrid Retrieval Contracts ────────────────

export interface BM25SearchResult {
  chunk: KnowledgeChunk;
  score: number;
  rank: number;
}

export interface VectorSearchResultItem {
  chunk: KnowledgeChunk;
  similarity: number;
  rank: number;
}

export interface HybridSearchResult {
  chunk: KnowledgeChunk;
  rrf_score: number;
  vector_rank?: number;
  vector_similarity?: number;
  bm25_rank?: number;
  bm25_score?: number;
}

export interface RerankedChunkResult {
  chunk: KnowledgeChunk;
  rerank_score: number;
  original_rrf_score: number;
  parent_chunk?: KnowledgeChunk;
  resolved_content: string; // Parent content if available, else child content
}

export interface AgenticRagStepTrace {
  step: "QUERY_ANALYSIS" | "QUERY_EXPANSION" | "HYBRID_RETRIEVAL" | "RERANKING" | "PARENT_RESOLUTION" | "CONFIDENCE_GATE" | "SYNTHESIS";
  timestamp: string;
  details: Record<string, unknown>;
  latency_ms: number;
}

export interface AgenticRagResult {
  query: string;
  expanded_queries: string[];
  intent: string;
  requires_retrieval: boolean;
  citations: RetrievalCitation[];
  grounded_context: string;
  confidence_score: number;
  confidence_level: "HIGH" | "MODERATE" | "LOW";
  is_fallback: boolean;
  suggested_escalation: boolean;
  traces: AgenticRagStepTrace[];
  total_latency_ms: number;
}


// ============================================================
// 8. POLICY & GOVERNANCE
// ============================================================

export interface TenantAIPolicy {
  id: string;
  tenant_id: string;
  ai_mode: AIMode; // AI_AUTONOMOUS | AI_COPILOT | DISABLED
  is_enabled: boolean;
  autonomous_sales_enabled: boolean;
  autonomous_support_enabled: boolean;
  autonomous_order_enabled: boolean;
  debounce_window_ms: number; // 3000ms by default
  confidence_threshold_high: number; // e.g. 0.85
  confidence_threshold_low: number; // e.g. 0.60
  max_iterations_per_run: number; // e.g. 5
  max_tool_calls_per_run: number; // e.g. 6
  max_tokens_per_run: number; // e.g. 2000
  daily_cost_budget_usd: number; // e.g. 10.00
  monthly_cost_budget_usd: number; // e.g. 150.00
  pii_redaction_enabled: boolean;
  allowed_channel_types: string[];
  disallowed_tool_names: string[];
  human_handoff_reasons: string[];
  updated_at: string;
}

// ============================================================
// 9. OBSERVABILITY, TRACING & FEEDBACK
// ============================================================

export interface AITrace {
  id: string;
  tenant_id: string;
  conversation_id: string;
  agent_run_id: string;
  trace_type: "ROUTER" | "AGENT" | "TOOL" | "LLM" | "VALIDATOR" | "HANDOFF";
  parent_trace_id?: string;
  model?: string;
  provider?: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  input_summary?: string;
  output_summary?: string;
  metadata?: Record<string, unknown>;
}

export interface AIUsageRecord {
  id: string;
  tenant_id: string;
  agent_run_id: string;
  conversation_id: string;
  agent_type: AgentType;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Prompt tokens the provider served from its cache (billed at the cached rate); 0 when it reports none (FX-70). */
  cached_tokens?: number;
  estimated_cost_usd: number;
  estimated_cost_bdt: number;
  currency: string;
  timestamp: string;
}

export interface AIFeedbackRecord {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id?: string;
  agent_run_id: string;
  user_id: string; // Human operator who reviewed
  rating: "HELPFUL" | "NOT_HELPFUL" | "WRONG" | "ESCALATE";
  reason?: string;
  original_ai_reply?: string;
  operator_corrected_reply?: string;
  created_at: string;
}

// ============================================================
// 10. ERROR TAXONOMY
// ============================================================

export type AIErrorCode =
  | "AI_MODEL_UNAVAILABLE"
  | "AI_MODEL_TIMEOUT"
  | "AI_TOKEN_LIMIT"
  | "AI_POLICY_BLOCKED"
  | "AI_TOOL_UNAUTHORIZED"
  | "AI_TOOL_VALIDATION_FAILED"
  | "AI_TOOL_TIMEOUT"
  | "AI_TOOL_FAILED"
  | "AI_CONTEXT_TOO_LARGE"
  | "AI_RAG_FAILED"
  | "AI_LOW_CONFIDENCE"
  | "AI_HUMAN_REQUIRED"
  | "AI_BUDGET_EXCEEDED"
  | "AI_MAX_ITERATIONS"
  | "AI_RESPONSE_VALIDATION_FAILED";

// ============================================================
// 11. BENCHMARK & EVALUATION
// ============================================================

export interface GoldenTestCase {
  id: string;
  category: IntentCategory;
  input_text: string;
  language: "bn" | "en" | "banglish";
  expected_intent: CanonicalIntent;
  expected_agent: AgentType;
  expected_tools: string[];
  expected_entities?: Record<string, unknown>;
  expected_requires_human: boolean;
  expected_policy_pass: boolean;
  adversarial: boolean;
  description: string;
}

export interface EvaluationResult {
  total_cases: number;
  passed_cases: number;
  intent_accuracy: number;
  tool_selection_accuracy: number;
  grounding_rate: number;
  handoff_accuracy: number;
  policy_violation_rate: number;
  average_latency_ms: number;
  estimated_cost_usd: number;
  failures: Array<{
    test_id: string;
    input: string;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
    reason: string;
  }>;
}

// ============================================================
// 12. JEV SYSTEM ONE ENGINE TYPES
// ============================================================

export type JevQuestionType = "choice" | "score" | "noul";

export interface JevChoiceQuestion {
  type: "choice";
  options: string[];
  instructions?: string;
}

export interface JevScoreQuestion {
  type: "score";
  levels: string[];
  instructions?: string;
}

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
}

export type JevQuestionDefinition = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;

export interface JevEvaluateRequest {
  model?: string;
  state: string;
  questions: Record<string, JevQuestionDefinition>;
}

export interface JevQuestionResult {
  type: JevQuestionType;
  choice?: string;
  score?: number;
  noul?: number; // Calibrated probability: 0.000 to 1.000
  confidence?: number;
  distribution?: Record<string, number>;
}

export interface JevEvaluateResponse {
  results: Record<string, JevQuestionResult>;
  latency_ms: number;
  tokens_evaluated: number;
}


// ==================== CUSTOMER AGENT (ADR-111, FX-73) ====================
/**
 * A price the customer agent showed in a conversation. An order is placed only from a QUOTED quote, after a later
 * customer message says yes; one quote places at most one order.
 */
export interface CustomerQuote {
  id: string;
  tenant_id: string;
  conversation_id: string;
  items: Array<{ variant_id: string; quantity: number }>;
  district: string;
  zone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA";
  coupon_code?: string;
  /** What the customer was shown, so the confirmation summary repeats exactly these numbers. */
  lines: Array<{ name: string; sku: string; unit_price: number; quantity: number; line_total: number }>;
  subtotal: number;
  discount_total: number;
  delivery_charge: number;
  grand_total: number;
  /** Customer messages in the conversation when the quote was first shown: a confirming "yes" must come after them. */
  customer_msg_count_at_quote: number;
  status: "QUOTED" | "PLACING" | "PLACED" | "STALE" | "EXPIRED";
  /** The name, phone and address shown in the confirmation summary: placement uses exactly these. */
  confirmation_details?: { customer_name: string; phone: string; address_line: string };
  /**
   * The outbound message that actually delivered this quote or its summary to the customer (ADR-112). Placement needs
   * it: a quote from a shadow turn or a failed send was never seen, so no "yes" can confirm it.
   */
  shown_message_id?: string;
  order_id?: string;
  order_number?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * One pending customer-agent turn per conversation (ADR-112, FX-76). A newer message moves the open job instead of
 * adding another; a message arriving while the turn runs sets `rerun`.
 */
export interface AgentJob {
  id: string;
  tenant_id: string;
  conversation_id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "BLOCKED" | "CANCELLED";
  /** Debounce: customers send bursts of short messages, so the turn waits until this time. */
  not_before: string;
  last_message_id: string;
  attempts: number;
  rerun?: boolean;
  claimed_at?: string;
  outcome?: string;
  created_at: string;
  updated_at: string;
}
