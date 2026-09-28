/**
 * CommerceOS Phase 4: Mock & High-Fidelity Intelligent LLM Provider
 * Provides deterministic, offline, and sandboxed AI reasoning, tool calls, and 1536-dim semantic embeddings.
 */

import {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  LLMResponse,
  LLMToolCall,
  LLMUsage,
  LLMProviderOptions,
} from "./llm-provider.interface";

export class MockLLMProvider implements LLMProvider {
  public readonly providerName = "MockIntelligentProvider";
  private forceError = false;
  private latencyMs = 25;

  public setForceError(force: boolean): void {
    this.forceError = force;
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    options?: LLMProviderOptions
  ): Promise<LLMResponse> {
    if (this.forceError) {
      throw new Error("AI_MODEL_UNAVAILABLE: Provider simulator error triggered");
    }

    const startTime = Date.now();
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const lower = lastUserMessage.toLowerCase();

    // Check if tools were executed and returned in message history
    const toolMessages = messages.filter((m) => m.role === "tool");
    const hasToolResults = toolMessages.length > 0;

    let responseContent = "";
    let toolCalls: LLMToolCall[] | undefined = undefined;

    if (!hasToolResults && tools && tools.length > 0) {
      // Analyze user prompt to determine if tools should be invoked
      // 1. Delivery & Shipping Estimate Check (takes precedence over generic 'koto' / 'charge')
      if (
        lower.includes("delivery") ||
        lower.includes("charge") ||
        lower.includes("shipping") ||
        lower.includes("ডেলিভারি") ||
        lower.includes("চার্জ") ||
        ((lower.includes("dhaka") || lower.includes("ঢাকা")) && (lower.includes("koto") || lower.includes("কত")))
      ) {
        const isOutside = lower.includes("baire") || lower.includes("outside") || lower.includes("বাহিরে") || lower.includes("বাইরে");
        toolCalls = [
          {
            id: `tc_${Date.now()}_5`,
            name: "get_shipping_estimate",
            arguments: {
              delivery_zone: isOutside ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA",
            },
          },
        ];
      } else if (
        lower.includes("price") ||
        lower.includes("dam") ||
        lower.includes("daam") ||
        lower.includes("koto") ||
        lower.includes("কত") ||
        lower.includes("দাম") ||
        lower.includes("shirt") ||
        lower.includes("t-shirt") ||
        lower.includes("জুতা") ||
        lower.includes("পাওয়া যাবে") ||
        lower.includes("stock") ||
        lower.includes("available") ||
        lower.includes("ase") ||
        lower.includes("achhe") ||
        lower.includes("size")
      ) {
        // If query asks for price / cost, prioritize product search to ground live price
        if (lower.includes("price") || lower.includes("dam") || lower.includes("daam") || lower.includes("koto") || lower.includes("দাম") || lower.includes("কত")) {
          toolCalls = [
            {
              id: `tc_${Date.now()}_2`,
              name: "search_products",
              arguments: {
                query: lower.includes("oxford") ? "Oxford" : lower.includes("shoes") ? "Shoes" : lower.includes("জুতা") ? "জুতা" : "T-Shirt",
              },
            },
          ];
        } else if (lower.includes("xl") || lower.includes("42") || lower.includes("stock") || lower.includes("available") || lower.includes("ase")) {
          toolCalls = [
            {
              id: `tc_${Date.now()}_1`,
              name: "check_inventory",
              arguments: {
                product_query: lower.includes("oxford") ? "Oxford" : lower.includes("shoes") ? "Shoes" : lower.includes("জুতা") ? "জুতা" : "T-Shirt",
                variant_attributes: lower.includes("42") ? { size: "42" } : { size: "XL" },
              },
            },
          ];
        } else {
          toolCalls = [
            {
              id: `tc_${Date.now()}_2`,
              name: "search_products",
              arguments: {
                query: lower.includes("oxford") ? "Oxford" : lower.includes("shoes") ? "Shoes" : lower.includes("জুতা") ? "জুতা" : "T-Shirt",
              },
            },
          ];
        }
      } else if (
        lower.includes("com-2026") ||
        lower.includes("ord-") ||
        lower.includes("order") ||
        lower.includes("অর্ডার") ||
        lower.includes("parcel") ||
        lower.includes("kothay") ||
        lower.includes("কোথায়")
      ) {
        // Extract order number if present
        const orderMatch = lastUserMessage.match(/COM-2026-\d+/i) || lastUserMessage.match(/ORD-\d+/i);
        const orderNum = orderMatch ? orderMatch[0] : "COM-2026-000123";
        toolCalls = [
          {
            id: `tc_${Date.now()}_3`,
            name: "get_order_status",
            arguments: {
              order_number: orderNum,
            },
          },
        ];
      } else if (lower.includes("wholesale") || lower.includes("পাইকারি") || lower.includes("100 পিস") || lower.includes("100 piece")) {
        toolCalls = [
          {
            id: `tc_${Date.now()}_4`,
            name: "create_lead",
            arguments: {
              title: "Wholesale Inquiry: 100+ Pieces",
              estimated_quantity: 100,
              notes: lastUserMessage,
            },
          },
        ];
      }
    }

    if (!toolCalls) {
      // Synthesize response based on message context
      if (hasToolResults) {
        const lastToolResult = toolMessages[toolMessages.length - 1].content;
        let parsedResult: any = {};
        try {
          parsedResult = JSON.parse(lastToolResult);
        } catch {
          parsedResult = { raw: lastToolResult };
        }

        if (parsedResult.available !== undefined) {
          if (parsedResult.available) {
            responseContent = `জি, পণ্যটি বর্তমানে available আছে (মজুদ: ${parsedResult.quantity || "পর্যাপ্ত"})। আপনি কি অর্ডারটি কনফার্ম করতে চান?`;
          } else {
            responseContent = "দুঃখিত, এই পণ্যটি বা সাইজটি বর্তমানে স্টকে নেই। নতুন স্টক এলে আপনাকে জানানো যাবে।";
          }
        } else if (parsedResult.delivery_charge !== undefined) {
          const zoneText = parsedResult.delivery_zone === "OUTSIDE_DHAKA" ? "ঢাকার বাইরে" : "ঢাকার ভেতরে";
          responseContent = `${zoneText} ডেলিভারি চার্জ ৳${parsedResult.delivery_charge} (ডেলিভারি সময়: ${parsedResult.estimated_days})।`;
        } else if (parsedResult.order_number) {
          responseContent = `আপনার অর্ডার ${parsedResult.order_number} এর বর্তমান স্ট্যাটাস: ${parsedResult.status}। কুরিয়ার ট্র্যাকিং: ${parsedResult.courier_tracking_code || "প্রসেসিং হচ্ছে"}।`;
        } else if (parsedResult.lead_id) {
          responseContent = "আপনার পাইকারি চাহিদার তথ্যটি আমাদের সেলস টিমের কাছে পাঠানো হয়েছে। শীঘ্রই একজন প্রতিনিধি আপনার সাথে যোগাযোগ করবেন।";
        } else if ((parsedResult.products && parsedResult.products.length > 0) || (Array.isArray(parsedResult) && parsedResult.length > 0)) {
          const p = Array.isArray(parsedResult) ? parsedResult[0] : parsedResult.products[0];
          responseContent = `পণ্য: ${p.title || p.name}, মূল্য: ৳${(p.price || 3500).toLocaleString()}। সাইজ ও কালার অপশন উপলব্ধ আছে।`;
        } else {
          responseContent = "আপনার তথ্যানুযায়ী বিস্তারিত যাচাই করা হয়েছে। আপনাকে আর কীভাবে সহায়তা করতে পারি?";
        }
      } else if (lower.includes("hi") || lower.includes("hello") || lower.includes("সালাম") || lower.includes("assalamu")) {
        responseContent = "আসসালামু আলাইকুম! CommerceOS এ আপনাকে স্বাগতম। আমি আপনাকে কীভাবে সাহায্য করতে পারি?";
      } else if (lower.includes("human") || lower.includes("agent") || lower.includes("manush") || lower.includes("কথা বলতে চাই")) {
        responseContent = "আমি একজন মানব প্রতিনিধির সাথে আপনাকে যুক্ত করে দিচ্ছি। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।";
      } else {
        responseContent = "আমি আপনার অনুরোধটি বুঝতে পেরেছি। স্টোর পলিসি ও ক্যাটালগ অনুযায়ী আপনাকে তথ্য জানাতে পারি।";
      }
    }

    const latency = Date.now() - startTime + this.latencyMs;
    const promptTokens = Math.max(15, Math.ceil(messages.map((m) => m.content).join(" ").length / 4));
    const completionTokens = Math.max(10, Math.ceil((responseContent.length + (toolCalls ? 80 : 0)) / 4));

    return {
      content: responseContent,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      model: options?.model || "mock-model-v1",
      latency_ms: latency,
    };
  }

  public async generate(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number; max_tokens?: number }
  ): Promise<string> {
    if (this.forceError) {
      throw new Error("AI_MODEL_UNAVAILABLE: Provider simulator error triggered");
    }
    const lower = prompt.toLowerCase();
    if (lower.includes("summary") || lower.includes("summarize")) {
      return "Customer inquired about product sizing and outside Dhaka delivery policy. Active order COM-2026-000123 confirmed in transit.";
    }
    return "This is a grounded AI generated response based on authorized context.";
  }

  public async structuredOutput<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMProviderOptions
  ): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    if (this.forceError) {
      throw new Error("AI_MODEL_UNAVAILABLE: Provider simulator error triggered");
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const lower = lastUserMessage.toLowerCase();

    let decision: any = {
      intent: "UNKNOWN",
      category: "GENERAL",
      confidence: 0.75,
      target_agent: "CUSTOMER_SUPPORT",
      extracted_entities: {},
      detected_language: "en",
      requires_human: false,
      routing_strategy: "LLM_CLASSIFIER",
    };

    // Language detection
    const hasBangla = /[\u0980-\u09FF]/.test(lastUserMessage);
    const hasBanglishWords = /\b(vai|bhai|koto|koto?|dam|daam|ache|achhe|ase|korte|chai|hobey|hobe|pabo|kobe)\b/i.test(lastUserMessage);
    if (hasBangla) {
      decision.detected_language = "bn";
    } else if (hasBanglishWords) {
      decision.detected_language = "banglish";
    }

    // Intent mapping
    if (lower.includes("price") || lower.includes("dam") || lower.includes("daam") || lower.includes("koto")) {
      decision.intent = "PRODUCT_PRICE";
      decision.category = "PRODUCT";
      decision.target_agent = "SALES";
      decision.confidence = 0.94;
    } else if (lower.includes("available") || lower.includes("stock") || lower.includes("ase") || lower.includes("আছে") || lower.includes("সাইজ")) {
      decision.intent = "PRODUCT_AVAILABILITY";
      decision.category = "PRODUCT";
      decision.target_agent = "SALES";
      decision.confidence = 0.95;
    } else if (lower.includes("recommend") || lower.includes("suggest") || lower.includes("ভাল কোনটা")) {
      decision.intent = "PRODUCT_RECOMMENDATION";
      decision.category = "PRODUCT";
      decision.target_agent = "SALES";
      decision.confidence = 0.90;
    } else if (lower.includes("order") || lower.includes("অর্ডার") || lower.includes("com-2026") || lower.includes("kothay") || lower.includes("কোথায়")) {
      decision.intent = "ORDER_STATUS";
      decision.category = "ORDER";
      decision.target_agent = "ORDER_ASSISTANT";
      decision.confidence = 0.96;
    } else if (lower.includes("cancel") || lower.includes("বাতিল")) {
      decision.intent = "ORDER_CANCELLATION";
      decision.category = "ORDER";
      decision.target_agent = "ORDER_ASSISTANT";
      decision.confidence = 0.92;
    } else if (lower.includes("delivery") || lower.includes("charge") || lower.includes("ডেলিভারি") || lower.includes("চার্জ") || lower.includes("dhaka")) {
      decision.intent = "SHIPPING_COST";
      decision.category = "SHIPPING";
      decision.target_agent = "CUSTOMER_SUPPORT";
      decision.confidence = 0.93;
    } else if (lower.includes("return") || lower.includes("রিটার্ন") || lower.includes("refund")) {
      decision.intent = "RETURN_POLICY";
      decision.category = "RETURN";
      decision.target_agent = "CUSTOMER_SUPPORT";
      decision.confidence = 0.92;
    } else if (lower.includes("wholesale") || lower.includes("পাইকারি") || lower.includes("100 পিস")) {
      decision.intent = "WHOLESALE_REQUEST";
      decision.category = "SALES";
      decision.target_agent = "SALES";
      decision.confidence = 0.95;
    } else if (lower.includes("payment") || lower.includes("টাকা কেটে") || lower.includes("bkash") || lower.includes("failed")) {
      decision.intent = "PAYMENT_FAILURE";
      decision.category = "PAYMENT";
      decision.target_agent = "CUSTOMER_SUPPORT";
      decision.confidence = 0.91;
      decision.requires_human = true; // Payment failures require human support review
    } else if (lower.includes("human") || lower.includes("agent") || lower.includes("manush") || lower.includes("কথা বলতে চাই")) {
      decision.intent = "HUMAN_REQUEST";
      decision.category = "SYSTEM";
      decision.target_agent = "CUSTOMER_SUPPORT";
      decision.confidence = 0.99;
      decision.requires_human = true;
    } else if (lower.includes("hi") || lower.includes("hello") || lower.includes("সালাম") || lower.includes("assalamu") || lower.includes("salam")) {
      decision.intent = "GREETING";
      decision.category = "GENERAL";
      decision.target_agent = "CUSTOMER_SUPPORT";
      decision.confidence = 0.98;
    }

    const usage: LLMUsage = {
      prompt_tokens: 120,
      completion_tokens: 65,
      total_tokens: 185,
    };

    return {
      data: decision as T,
      usage,
      latency_ms: this.latencyMs,
    };
  }

  /**
   * Generates a 1536-dimensional semantic embedding vector.
   * Uses semantic concept clustering so similar domain words yield high cosine similarity.
   */
  public async embed(text: string): Promise<number[]> {
    if (this.forceError) {
      throw new Error("AI_MODEL_UNAVAILABLE: Provider simulator error triggered");
    }

    const dim = 1536;
    const vector = new Array(dim).fill(0);
    const lower = text.toLowerCase();

    // Semantic clusters
    const clusters: Record<string, number[]> = {
      // Shipping / Delivery cluster: dimensions 0-100
      shipping: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
      delivery: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
      dhaka: [5, 15, 25, 35, 45, 55, 65, 75, 85, 95],
      courier: [2, 12, 22, 32, 42, 52, 62, 72, 82, 92],
      charge: [8, 18, 28, 38, 48, 58, 68, 78, 88, 98],

      // Return / Refund cluster: dimensions 101-200
      return: [105, 115, 125, 135, 145, 155, 165, 175, 185, 195],
      refund: [108, 118, 128, 138, 148, 158, 168, 178, 188, 198],
      exchange: [102, 112, 122, 132, 142, 152, 162, 172, 182, 192],
      replace: [102, 112, 122, 132, 142, 152, 162, 172, 182, 192],
      replacement: [102, 112, 122, 132, 142, 152, 162, 172, 182, 192],
      change: [102, 112, 122, 132, 142, 152, 162, 172, 182, 192],
      policy: [101, 111, 121, 131, 141, 151, 161, 171, 181, 191],

      // Sizing / Product Specs cluster: dimensions 201-300
      size: [205, 215, 225, 235, 245, 255, 265, 275, 285, 295],
      chart: [208, 218, 228, 238, 248, 258, 268, 278, 288, 298],
      chest: [201, 211, 221, 231, 241, 251, 261, 271, 281, 291],
      fit: [203, 213, 223, 233, 243, 253, 263, 273, 283, 293],

      // Payment / MFS cluster: dimensions 301-400
      payment: [305, 315, 325, 335, 345, 355, 365, 375, 385, 395],
      bkash: [301, 311, 321, 331, 341, 351, 361, 371, 381, 391],
      nagad: [302, 312, 322, 332, 342, 352, 362, 372, 382, 392],
      cod: [308, 318, 328, 338, 348, 358, 368, 378, 388, 398],
    };

    // Populate cluster weights
    let hasClusterHit = false;
    for (const [term, indices] of Object.entries(clusters)) {
      if (lower.includes(term)) {
        hasClusterHit = true;
        for (const idx of indices) {
          vector[idx] += 0.85;
        }
      }
    }

    // Add baseline hash distribution so vectors have full span
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const targetIdx = (charCode * 37 + i * 19) % dim;
      vector[targetIdx] += 0.15;
    }

    // If no cluster hit, seed generic density
    if (!hasClusterHit) {
      vector[500] = 0.5;
      vector[501] = 0.5;
    }

    // Normalize to unit length (L2 norm)
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        vector[i] = vector[i] / norm;
      }
    }

    return vector;
  }
}
