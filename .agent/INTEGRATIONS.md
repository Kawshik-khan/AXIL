# CommerceOS Integration Architecture & Provider Adapters

> **Status:** Mostly SIMULATED. External providers (Meta, WhatsApp, couriers, bKash/Nagad) are stubbed and must not report success (H9).

## 1. Provider Adapter Pattern

CommerceOS interacts with external logistics, mobile financial services (MFS), and messaging networks strictly through standardized adapter interfaces. Domain services depend on the interface, never on a third-party SDK.

---

## 2. Bangladeshi Courier Logistics Providers

### 2.1 Standard Courier Interface
```typescript
export interface CourierAdapter {
  createShipment(order: OrderPayload): Promise<ShipmentResult>;
  trackShipment(consignmentId: string): Promise<TrackingStatus>;
  cancelShipment(consignmentId: string): Promise<boolean>;
  getDeliveryRates(zone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA", weightKg: number): Promise<number>;
}
```

### 2.2 Providers Implemented
1. **Steadfast Courier**:
   - Primary courier for COD throughout 64 districts of Bangladesh.
   - Webhook callback for tracking updates: `DELIVERED`, `PARTIAL_DELIVERED`, `RETURNED`, `CANCELLED`.
2. **Pathao Courier**:
   - Rapid intra-city Dhaka delivery and merchant on-demand dispatch.
   - OAuth2 client credentials authentication with automated token refreshing.
3. **RedX Logistics**:
   - Secondary countrywide delivery and parcel pickup.

---

## 3. Payment Gateways & Mobile Financial Services (MFS)

### 3.1 Standard Payment Interface
```typescript
export interface PaymentAdapter {
  initiatePayment(orderId: string, amount: number): Promise<{ redirectUrl?: string; paymentId: string }>;
  verifyTransaction(transactionId: string): Promise<VerificationResult>;
  refundPayment(paymentId: string, amount: number, reason: string): Promise<RefundResult>;
}
```

### 3.2 Providers Implemented
1. **bKash Tokenized Checkout & Merchant API**:
   - Supports query payment status, execute agreement, and query transaction ID.
2. **Nagad Merchant Gateway**:
   - Public-key encrypted payload signature verification.
3. **SSLCommerz**:
   - Multi-channel gateway for Visa, Mastercard, AMEX, and internet banking in Bangladesh.
4. **Cash on Delivery (COD)**:
   - Built-in provider handling physical cash collection and courier settlement tracking.

---

## 4. Social Commerce & Messaging Channels

1. **Meta Graph API (Facebook Messenger & Instagram Direct)**:
   - Webhook ingress handling text messages, post comments, quick replies, and attachments.
   - Meta Send API adhering strictly to the 24-hour customer service window rule.
2. **WhatsApp Cloud API (Meta)**:
   - Direct two-way conversational commerce with interactive list messages and order buttons.
3. **Telegram Bot & Channels API**:
   - Automated customer order confirmations, invoice alerts, flash sale broadcast campaigns, and merchant VIP notifications.
   - Verified webhook ingestion (`/api/v1/social/webhooks/telegram`) with `X-Telegram-Bot-Api-Secret-Token` header security.
4. **Website Live Chat**:
   - WebSocket / Server-Sent Events (SSE) direct customer widget.
