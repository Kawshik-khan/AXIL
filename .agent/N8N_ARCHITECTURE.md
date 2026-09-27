# CommerceOS n8n Workflow Automation Architecture

> **Status:** PARTIAL. Workflow JSON and automation services exist; webhook auth (C4), kill switches (H11), and real provider calls (H9) are open findings.

## 1. Role & Boundaries of n8n in CommerceOS

n8n serves as the **Workflow Automation Hub** connecting CommerceOS to third-party APIs, asynchronous triggers, and external notification networks.

### Non-Negotiable Architectural Separation
```
   COMMERCE CORE API             n8n WORKFLOW HUB              EXTERNAL PARTNERS
┌──────────────────────┐      ┌─────────────────────┐      ┌──────────────────────┐
│ Authoritative Logic  │◄────►│ Visual Orchestration│◄────►│ Couriers (Steadfast) │
│ Relational Database  │      │ Retries & Schedules │      │ Payments (bKash)     │
│ Policy Engine & Auth │      │ Sub-workflow Chaining│     │ Meta / WhatsApp API  │
└──────────────────────┘      └─────────────────────┘      └──────────────────────┘
```

- **n8n IS**:
  - A webhook ingestion and fan-out engine.
  - A scheduled poller for courier statuses and sync jobs.
  - An orchestrator for multi-step notifications (WhatsApp, SMS, Email).
- **n8n is NOT**:
  - The primary application backend.
  - The authoritative database.
  - An authorization bypass.
  - An uncontrolled AI execution loop.

---

## 2. Complete Workflow Catalog (39 Standard Workflows)

### Social Commerce Workflows (1–5)
1. `WF-SOC-01`: Facebook Message Received $\rightarrow$ Intent Detection $\rightarrow$ Agent Reply.
2. `WF-SOC-02`: Facebook Public Comment $\rightarrow$ Lead Extraction $\rightarrow$ Private DM Nudge.
3. `WF-SOC-03`: Instagram DM Received $\rightarrow$ Product Visual Search $\rightarrow$ Response.
4. `WF-SOC-04`: WhatsApp Message $\rightarrow$ Language Classifier $\rightarrow$ Order Assistance.
5. `WF-SOC-05`: Website Live Chat Ingestion $\rightarrow$ Real-time Agent Streaming.

### Sales & Lead Qualification (6–9)
6. `WF-SAL-01`: New Lead Created $\rightarrow$ Automated Qualification $\rightarrow$ CRM Tagging.
7. `WF-SAL-02`: High-Intent Lead Inactivity $\rightarrow$ Automated Follow-Up (24h).
8. `WF-SAL-03`: Cart Abandoned $\rightarrow$ WhatsApp Recovery Message with One-Click Link.
9. `WF-SAL-04`: Dormant Customer (60+ days) $\rightarrow$ Reactivation Offer Dispatch.

### Orders & Fulfillment (10–13)
10. `WF-ORD-01`: Order Placed $\rightarrow$ Stock Reservation $\rightarrow$ Customer Confirmation SMS.
11. `WF-ORD-02`: COD Order Confirmation Call/SMS $\rightarrow$ Address Verification.
12. `WF-ORD-03`: Customer Cancellation Request $\rightarrow$ Policy Check $\rightarrow$ Release Stock.
13. `WF-ORD-04`: Return Request Intake $\rightarrow$ Photo Proof Upload $\rightarrow$ Ticket Creation.

### Payments & Financials (14–18)
14. `WF-PAY-01`: Payment Gateway Webhook $\rightarrow$ Signature Check $\rightarrow$ Order Status Update.
15. `WF-PAY-02`: bKash MFS Transaction ID Verification $\rightarrow$ Ledger Match.
16. `WF-PAY-03`: Failed Payment Attempt $\rightarrow$ Automated Alternative Payment Link.
17. `WF-PAY-04`: Daily Courier COD Disbursement Statement $\rightarrow$ Bank Reconciliation.
18. `WF-PAY-05`: Approved Refund $\rightarrow$ MFS Transfer Execution $\rightarrow$ Customer Notice.

### Delivery & Couriers (19–23)
19. `WF-DEL-01`: Order Ready $\rightarrow$ Steadfast/Pathao API Consignment Creation.
20. `WF-DEL-02`: Hourly Active Shipment Tracking Poller $\rightarrow$ State Machine Sync.
21. `WF-DEL-03`: Out-for-Delivery Trigger $\rightarrow$ Customer WhatsApp Alert.
22. `WF-DEL-04`: Failed Delivery Attempt $\rightarrow$ Customer Urgent Address Check.
23. `WF-DEL-05`: Return-to-Origin (RTO) Consignment $\rightarrow$ Restock Ticket.

### Inventory & Stock Alerts (24–27)
24. `WF-INV-01`: SKU Threshold Breached $\rightarrow$ Slack / WhatsApp Merchant Low Stock Alert.
25. `WF-INV-02`: Out-of-Stock Trigger $\rightarrow$ Delist from Social Channels.
26. `WF-INV-03`: Weekly Reorder Recommendation Report Generation.
27. `WF-INV-04`: Dead Stock Identifier (No sales in 90 days) $\rightarrow$ Clearance Campaign.

### Marketing & Campaigns (28–32)
28. `WF-MKT-01`: Promotional Campaign Draft $\rightarrow$ Owner Approval Gate.
29. `WF-MKT-02`: Approved Broadcast $\rightarrow$ Rate-Limited WhatsApp Batch Send.
30. `WF-MKT-03`: Post-Purchase Review Request (5 days after delivery).
31. `WF-MKT-04`: VIP Customer Loyalty Milestone Alert.
32. `WF-MKT-05`: Campaign Performance & Conversion Rate Aggregation.

### SEO & Catalog (33–35)
33. `WF-SEO-01`: New Product Added $\rightarrow$ AI Meta Title & Description Draft.
34. `WF-SEO-02`: Monthly SEO Broken Link & Missing Metadata Audit.
35. `WF-SEO-03`: Catalog Attribute Enrichment & Auto-Categorization.

### Business Intelligence & Analytics (36–39)
36. `WF-BI-01`: Daily E-commerce Business Digest (Sales, COD, RTO) at 9:00 AM.
37. `WF-BI-02`: Weekly Executive Performance & Gross Margin Report.
38. `WF-BI-03`: Monthly Financial Ledger & Courier Fee Reconciliation.
39. `WF-BI-04`: Operational Anomaly Alert (Spike in cancellations or RTO).

---

## 3. Workflow Execution Standard

Every n8n workflow must strictly adhere to this node sequence:
```
[ Webhook / Cron Trigger ]
         │
         ▼
[ Step 1: HMAC / Secret Validation ]
         │
         ▼
[ Step 2: Tenant Context Resolution ]
         │
         ▼
[ Step 3: Redis Idempotency Check ]
         │
         ▼
[ Step 4: Commerce API Call (Bearer Token) ]
         │
         ├─── Error ───► [ Dead-Letter Queue & Slack Alert ]
         │
         ▼
[ Step 5: Log Execution Result & Emit Domain Event ]
```
Monolithic workflows are prohibited. Reusable sub-workflows (e.g. `Sub-Verify-Customer`, `Sub-Send-WhatsApp`) must be used for common logic.
