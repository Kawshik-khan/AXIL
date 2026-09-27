# Agent Specification Template

## 1. Agent Overview
- **Agent Name**: [e.g. Order Agent]
- **Domain**: [e.g. Fulfillment]
- **Operational Responsibility**: [Clear, bounded description of responsibilities]
- **Trigger Channels**: [Facebook Messenger, Instagram DM, WhatsApp, Web, Operator Palette]

---

## 2. Tools & Permissions
### Permitted Tools (Allowlist)
- `tool_name_1`: [Purpose, input schema, output schema]
- `tool_name_2`: [Purpose, input schema, output schema]

### Forbidden Tools (Denylist)
- `forbidden_tool_1`: [Reason why this agent must never possess this tool]

---

## 3. Knowledge & Grounding
- **RAG Knowledge Categories**: [Store Policies, FAQ, Size Chart, Catalog]
- **Confidence Threshold**: [e.g. 0.75]
- **Unknown Context Fallback**: [Escalate to human / offer support ticket]

---

## 4. Linguistic & Prompt Rules
- Language handling: [Bangla, Banglish, English]
- Tone guidelines: [Helpful, polite, concise, professional]
- Prohibited phrases / behaviors: [No fabricated discounts, no speculative delivery dates]

---

## 5. Human-in-the-Loop (HITL) Triggers
- When must this agent suspend execution and request human operator sign-off?

---

## 6. Benchmark Evaluation Dataset
- Evaluation cases added to `src/domains/ai/eval/golden-dataset.ts`.
- Required: zero policy violations and zero fabricated facts on the golden set; report pass/fail counts.
