import type { ConnectorProviderDefinition } from "@/types/connector";

/**
 * Provider manifests, category AI_LLM. A manifest describes a provider (fields, guide, capabilities, status); behavior
 * belongs to its driver (connector plan, docs/connector-implementation-plan.md). Status: BETA = connectable and saved
 * encrypted, with a live credential check where one exists; COMING_SOON = listed but not connectable.
 */
export const AI_LLM_MANIFESTS: ConnectorProviderDefinition[] = [
  {
    id: "openai",
    name: "OpenAI",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT", "EMBEDDINGS"],
    badge: "✦ Frontier AI",
    description: "Industry-standard models for customer intent reasoning, multilingual Banglish comprehension, and catalog extraction.",
    default_endpoint: "https://api.openai.com/v1",
    portal_url: "https://platform.openai.com/api-keys",
    documentation_url: "https://platform.openai.com/docs/models",
    suggested_models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o3-mini", "gpt-4-turbo"],
    fields: [
      { name: "api_key", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-proj-...", description: "Secret key with model inference and embeddings permissions." },
      { name: "organization_id", label: "Organization ID (Optional)", type: "text", required: false, placeholder: "org-..." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "gpt-4o", options: [
        { label: "GPT-4o (Omni Reasoning & Vision)", value: "gpt-4o" },
        { label: "GPT-4o Mini (Fast & Cost Effective)", value: "gpt-4o-mini" },
        { label: "o1 (High-Order Reasoning)", value: "o1" },
        { label: "o3-mini (High Speed Reasoning)", value: "o3-mini" },
      ]},
      { name: "custom_base_url", label: "Custom Base URL (Optional)", type: "url", required: false, placeholder: "https://api.openai.com/v1", description: "Useful when routing through Azure OpenAI or enterprise AI gateway." },
    ],
    guidelines: {
      portal_url: "https://platform.openai.com/api-keys",
      prerequisites: [
        "An active OpenAI developer account with billing set up.",
        "A project created under your organization.",
      ],
      steps: [
        "Navigate to https://platform.openai.com/api-keys and log in.",
        "Click on 'Create new secret key'. Name it 'CommerceOS-Production'.",
        "Select 'All permissions' or ensure 'Model inference' and 'Embeddings' are checked.",
        "Copy the key immediately (starts with sk-proj- or sk-) and paste it into the field above.",
        "Choose your preferred default model (GPT-4o is recommended for production operations).",
      ],
      tips: [
        "CommerceOS automatically masks your key and encrypts it using AES-256-GCM.",
        "Set up a monthly usage limit on your OpenAI dashboard to prevent runaway charges.",
      ],
    },
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT"],
    badge: "✦ Nuanced Intelligence",
    description: "State-of-the-art reasoning, exceptional empathetic customer support handling, and 200k+ context window capabilities.",
    default_endpoint: "https://api.anthropic.com/v1",
    portal_url: "https://console.anthropic.com/settings/keys",
    documentation_url: "https://docs.anthropic.com/claude/reference/getting-started-with-the-api",
    suggested_models: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    fields: [
      { name: "api_key", label: "Claude API Key", type: "password", required: true, placeholder: "sk-ant-...", description: "Starts with sk-ant- from Anthropic Console." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "claude-3-7-sonnet-20250219", options: [
        { label: "Claude 3.7 Sonnet (Hybrid Thinking & Reasoning)", value: "claude-3-7-sonnet-20250219" },
        { label: "Claude 3.5 Sonnet (Superior Coding & Accuracy)", value: "claude-3-5-sonnet-20241022" },
        { label: "Claude 3.5 Haiku (Ultra-Fast Response)", value: "claude-3-5-haiku-20241022" },
      ]},
      { name: "custom_base_url", label: "Custom Base URL (Optional)", type: "url", required: false, placeholder: "https://api.anthropic.com/v1" },
    ],
    guidelines: {
      portal_url: "https://console.anthropic.com/settings/keys",
      prerequisites: [
        "Anthropic developer account with active credit balance.",
      ],
      steps: [
        "Visit the Anthropic Console at https://console.anthropic.com/settings/keys.",
        "Click 'Create Key' and provide a label such as 'CommerceOS-Agent-Runtime'.",
        "Copy the generated token starting with sk-ant- and paste into CommerceOS.",
        "Select Claude 3.7 Sonnet or Claude 3.5 Sonnet as the default engine.",
      ],
      tips: [
        "Claude excels at understanding colloquial Banglish nuances and polite customer conflict resolution.",
      ],
    },
  },
  {
    id: "google_gemini",
    name: "Google Gemini",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT", "EMBEDDINGS"],
    badge: "✦ 2M Context Window",
    description: "Massive context processing for enterprise catalogs, multimodal image product searches, and high-velocity reasoning.",
    default_endpoint: "https://generativelanguage.googleapis.com/v1beta",
    portal_url: "https://aistudio.google.com/app/apikey",
    documentation_url: "https://ai.google.dev/gemini-api/docs",
    suggested_models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    fields: [
      { name: "api_key", label: "Gemini API Key", type: "password", required: true, placeholder: "AIzaSy...", description: "API Key generated from Google AI Studio." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "gemini-2.5-flash", options: [
        { label: "Gemini 2.5 Flash (Ultra Fast & Efficient)", value: "gemini-2.5-flash" },
        { label: "Gemini 2.5 Pro (Deep Complex Reasoning)", value: "gemini-2.5-pro" },
        { label: "Gemini 1.5 Pro (Massive Context 2M Tokens)", value: "gemini-1.5-pro" },
        { label: "Gemini 1.5 Flash (High Concurrency)", value: "gemini-1.5-flash" },
      ]},
    ],
    guidelines: {
      portal_url: "https://aistudio.google.com/app/apikey",
      prerequisites: [
        "A Google account with Google AI Studio access.",
      ],
      steps: [
        "Go to https://aistudio.google.com/app/apikey.",
        "Click 'Create API Key' and pick a Google Cloud Project.",
        "Copy the generated API Key string (starts with AIzaSy) and paste it here.",
        "Choose Gemini 2.5 Flash for sub-second responses or Gemini 2.5 Pro for deep analytics.",
      ],
      tips: [
        "Gemini 2.5 Flash offers low token pricing and high throughput for F-commerce chat auto-replies.",
      ],
    },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT"],
    badge: "✦ High ROI Reasoning",
    description: "Low cost open-weight reasoning models (DeepSeek V3 & DeepSeek R1) with advanced mathematical and operational problem-solving.",
    default_endpoint: "https://api.deepseek.com/v1",
    portal_url: "https://platform.deepseek.com/api_keys",
    documentation_url: "https://api-docs.deepseek.com",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
    fields: [
      { name: "api_key", label: "DeepSeek API Key", type: "password", required: true, placeholder: "sk-...", description: "Key generated from DeepSeek Open Platform." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "deepseek-chat", options: [
        { label: "DeepSeek-V3 (deepseek-chat - General Intelligence)", value: "deepseek-chat" },
        { label: "DeepSeek-R1 (deepseek-reasoner - Chain-of-Thought)", value: "deepseek-reasoner" },
      ]},
    ],
    guidelines: {
      portal_url: "https://platform.deepseek.com/api_keys",
      prerequisites: [
        "A DeepSeek platform account with top-up credits.",
      ],
      steps: [
        "Log into https://platform.deepseek.com/api_keys.",
        "Click 'Create new API key' and copy the token.",
        "Paste the key into the field above and test connectivity.",
      ],
      tips: [
        "DeepSeek-R1 is useful for complex supply-chain reorder calculations and inventory simulations.",
      ],
    },
  },
  {
    id: "groq",
    name: "Groq Cloud (LPU)",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT"],
    badge: "✦ 800+ Tokens/Sec",
    description: "LPU-accelerated inference delivering near-instant responses for live conversational commerce chat widgets.",
    default_endpoint: "https://api.groq.com/openai/v1",
    portal_url: "https://console.groq.com/keys",
    documentation_url: "https://console.groq.com/docs/models",
    suggested_models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    fields: [
      { name: "api_key", label: "Groq API Key", type: "password", required: true, placeholder: "gsk_...", description: "Starts with gsk_ from Groq Console." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "llama-3.3-70b-versatile", options: [
        { label: "Llama 3.3 70B Versatile (Meta)", value: "llama-3.3-70b-versatile" },
        { label: "Mixtral 8x7B (Mistral AI)", value: "mixtral-8x7b-32768" },
        { label: "Gemma 2 9B (Google)", value: "gemma2-9b-it" },
      ]},
    ],
    guidelines: {
      portal_url: "https://console.groq.com/keys",
      prerequisites: ["A Groq Console account."],
      steps: [
        "Visit https://console.groq.com/keys and generate an API key.",
        "Paste the gsk_ key into CommerceOS.",
      ],
      tips: ["Groq inference latency is often under 250ms, making conversation feel like real-time typing."],
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT"],
    badge: "✦ Unified Gateway",
    description: "Single API gateway routing across 100+ AI models (Anthropic, Meta, Mistral, Cohere) with automated failover and price optimization.",
    default_endpoint: "https://openrouter.ai/api/v1",
    portal_url: "https://openrouter.ai/keys",
    documentation_url: "https://openrouter.ai/docs",
    suggested_models: ["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct", "google/gemini-flash-1.5", "deepseek/deepseek-r1"],
    fields: [
      { name: "api_key", label: "OpenRouter API Key", type: "password", required: true, placeholder: "sk-or-v1-..." },
      { name: "default_model", label: "Default Model", type: "select", required: true, defaultValue: "anthropic/claude-3.5-sonnet", options: [
        { label: "Claude 3.5 Sonnet (via OpenRouter)", value: "anthropic/claude-3.5-sonnet" },
        { label: "Llama 3.3 70B Instruct (via OpenRouter)", value: "meta-llama/llama-3.3-70b-instruct" },
        { label: "DeepSeek R1 (via OpenRouter)", value: "deepseek/deepseek-r1" },
      ]},
    ],
    guidelines: {
      portal_url: "https://openrouter.ai/keys",
      prerequisites: ["OpenRouter account."],
      steps: [
        "Open https://openrouter.ai/keys and click 'Create Key'.",
        "Copy the key and enter it above.",
      ],
    },
  },
  {
    id: "ollama",
    name: "Ollama (Self-Hosted)",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT", "EMBEDDINGS"],
    badge: "✦ 100% On-Premise",
    description: "Run open-source models completely locally on your own server or workstation with zero data leaving your internal infrastructure.",
    default_endpoint: "http://localhost:11434/v1",
    portal_url: "https://ollama.com",
    documentation_url: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    suggested_models: ["llama3.3:latest", "deepseek-r1:latest", "qwen2.5:latest", "mistral:latest"],
    fields: [
      { name: "endpoint_url", label: "Ollama Server Endpoint", type: "url", required: true, defaultValue: "http://localhost:11434/v1", placeholder: "http://localhost:11434/v1", description: "Make sure Ollama is launched with OLLAMA_ORIGINS='*' or CORS enabled." },
      { name: "default_model", label: "Model Identifier", type: "text", required: true, defaultValue: "llama3.3:latest", placeholder: "e.g. llama3.3:latest or deepseek-r1:latest" },
      { name: "bearer_token", label: "Bearer Token / Auth (Optional)", type: "password", required: false, placeholder: "Optional if behind reverse proxy" },
    ],
    guidelines: {
      portal_url: "https://ollama.com",
      prerequisites: [
        "Ollama installed on local machine, GPU server, or Docker container.",
        "At least 16GB RAM / VRAM for 8B-70B quantized models.",
      ],
      steps: [
        "Pull your desired model: ollama pull llama3.3",
        "Ensure Ollama allows incoming API calls from CommerceOS: OLLAMA_ORIGINS=\"*\" ollama serve",
        "Set the endpoint to http://localhost:11434/v1 (or your server's IP address e.g. http://192.168.1.50:11434/v1).",
        "Click 'Test Connection' below to confirm health.",
      ],
      terminal_commands: [
        "ollama pull llama3.3",
        "OLLAMA_HOST=0.0.0.0:11434 OLLAMA_ORIGINS=\"*\" ollama serve",
      ],
      tips: [
        "Ollama implements OpenAI-compatible endpoints under /v1/chat/completions.",
      ],
    },
  },
  {
    id: "vllm",
    name: "vLLM (Self-Hosted)",
    category: "AI_LLM",
    status: "BETA",
    capabilities: ["LLM_CHAT"],
    badge: "✦ High-Throughput On-Prem",
    description: "PagedAttention high-throughput model serving engine for self-hosted enterprise deployments on NVIDIA GPUs.",
    default_endpoint: "http://localhost:8000/v1",
    portal_url: "https://docs.vllm.ai",
    documentation_url: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
    suggested_models: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct"],
    fields: [
      { name: "endpoint_url", label: "vLLM OpenAI Endpoint", type: "url", required: true, defaultValue: "http://localhost:8000/v1", placeholder: "http://localhost:8000/v1" },
      { name: "default_model", label: "Served Model Name", type: "text", required: true, placeholder: "meta-llama/Llama-3.3-70B-Instruct" },
      { name: "api_key", label: "API Key / Auth Token (Optional)", type: "password", required: false },
    ],
    guidelines: {
      portal_url: "https://docs.vllm.ai",
      prerequisites: ["NVIDIA GPU host with CUDA support."],
      steps: [
        "Run vLLM server: vllm serve meta-llama/Llama-3.3-70B-Instruct --host 0.0.0.0 --port 8000",
        "Connect CommerceOS via http://<host>:8000/v1.",
      ],
      terminal_commands: [
        "vllm serve meta-llama/Llama-3.3-70B-Instruct --host 0.0.0.0 --port 8000 --api-key my-secret-key",
      ],
    },
  },
];
