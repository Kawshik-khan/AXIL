# CommerceOS Product Definition & Requirements

> **Status:** Product vision and requirements. Implementation status: STATUS.md.

## 1. Product Vision

**CommerceOS** is a unified, multi-tenant Agentic E-commerce Automation Operating System engineered specifically for the high-velocity, conversational e-commerce landscape of Bangladesh and South Asia.

It transforms fragmented F-commerce (Facebook), Instagram, WhatsApp, and web retail operations into an automated, reliable, and intelligent enterprise-grade business engine.

CommerceOS merges:
$$\text{Social Channels} + \text{Commerce Backend} + \text{Agentic AI} + \text{RAG} + \text{n8n Workflows} + \text{Bento BI}$$
into a single, cohesive human control plane.

---

## 2. Target Personas & Stakeholders

1. **F-Commerce / D2C Brand Owners**:
   - Managing 50–2,000 orders/day across Facebook Page Messenger, Instagram DMs, and WhatsApp.
   - Pain points: Drowning in repetitive inbox inquiries ("vai price koto?", "available ase?"), manual order entry, high return-to-origin (RTO) rates on Cash on Delivery (COD), unverified payment screenshots.
2. **Operations & Fulfillment Teams**:
   - Manually booking shipments across local couriers (Steadfast, Pathao, RedX, Paperfly), reconciling return packages, and answering customer tracking questions.
3. **Customer Support & Sales Representatives**:
   - Needing quick access to authoritative product specs, variant availability, order status, and customer history without switching between 5 spreadsheets and apps.
4. **Finance & Reconciliation Managers**:
   - Struggling to reconcile daily courier COD disbursements against actual delivered shipments, bKash merchant transaction fees, and bank transfers.

---

## 3. Core Problems & Systemic Solutions

| Real-World Problem | CommerceOS Architectural Solution |
| :--- | :--- |
| **Overwhelming Social Volume** | Multi-channel unified inbox with 24/7 Agentic AI handling routine inquiries in English, Bangla, and Banglish. |
| **Fake Orders & Unconfirmed COD** | Automated COD confirmation workflows, fraud risk scoring, phone verification, and courier return history checks. |
| **Inventory Desynchronization** | Real-time centralized inventory service with atomic reservation locks during checkout. |
| **Payment Fraud via Fake Screenshots** | Strict verification pipeline: screenshots trigger automated or human OCR matching against authoritative bKash/Nagad merchant APIs. |
| **Fragmented Manual Workflows** | Event-driven n8n workflow engine automating courier booking, customer notifications, low-stock alerts, and cart recovery. |
| **Opaque Analytics** | Real-time Bento Grid dashboard tracking GMV, Cash in Transit, RTO rate, Net Profit, and AI automation rates. |

---

## 4. Key Platform Pillars

### Pillar 1: Authoritative Commerce Core
- Centralized Product Catalog, SKUs, Variants, and Pricing.
- Multi-channel Inventory Tracking with safety thresholds.
- Order Lifecycle State Machine (Pending, Confirmed, Processing, Shipped, Delivered, Cancelled, Returned).
- Customer Identity Resolution matching phone numbers across FB PSID, IG Scoped ID, WhatsApp JID, and Web sessions.

### Pillar 2: Agentic AI Control Plane
- Deterministic Orchestrator routing to 14 specialized agents (Support, Sales, Product, Inventory, Order, Payment, Delivery, Marketing, SEO, Finance, Analytics, Social, Knowledge, Automation).
- Safe tool execution via a Policy Engine with configurable Human-in-the-Loop thresholds.
- Zero AI hallucinations on price, stock, order status, and financials.

### Pillar 3: Workflow Automation (n8n Integration)
- Event-triggered webhooks for asynchronous operations.
- Courier tracking pollers and multi-step delivery status synchronizers.
- Abandoned cart nudges, review collection, and promotional campaigns.

### Pillar 4: Executive Bento Control Plane
- Minimalist, high-density Bento grid UI with Lime (`#C7F900`) accents, Charcoal (`#242529`) surfaces, and a floating navigation dock.
- Actionable business intelligence surfacing operational bottlenecks, restock requirements, and delayed shipments.

---

## 5. Success Metrics & Key Performance Indicators (KPIs)

1. **Automation Rate**: $\ge 70\%$ of routine customer inquiries answered accurately without human intervention.
2. **First Response Time (FRT)**: Under 5 seconds on all messaging channels.
3. **Order Processing Latency**: From customer intent to confirmed courier booking in under 60 seconds.
4. **Return-to-Origin (RTO) Reduction**: Measurable $15-30\%$ reduction in failed COD deliveries via automated address validation and customer confirmation.
5. **Zero Financial Leakage**: 100% reconciliation between courier COD settlements, mobile financial service (MFS) statements, and delivered orders.
