/**
 * CommerceOS: Cross-Tenant RTO & Courier Fraud Prevention Network Types
 * Strictly enforces zero-leakage cryptographic identity blinding (tenant-isolation.md).
 */

export type RtoRiskTier = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type RecommendedAction =
  | "AUTO_CONFIRM"              // Pristine buyer (low risk)
  | "STANDARD_CONFIRM"          // Normal verification
  | "WHATSAPP_CONFIRMATION"     // Send 1-click confirmation message
  | "REQUIRE_ADVANCE_COURIER_FEE" // Collect ৳120 via bKash before shipping
  | "MANUAL_CALL_REQUIRED"      // Call customer to verify address details
  | "BLOCK_COD";                // Advance full payment only

/**
 * Global Network Delivery Reputation Record.
 * Held at the platform level; contains ZERO customer PII (no name, no plaintext phone, no address).
 */
export interface NetworkDeliveryReputationRecord {
  /** Irreversible HMAC-SHA256 hex string derived from canonical phone number + platform secret pepper */
  phone_hash: string;
  total_orders_tracked: number;
  successful_deliveries: number;
  returned_rto_count: number;
  cancelled_before_ship_count: number;
  disputed_courier_attempts: number;

  /** Calculated percentages (0 to 100) */
  delivery_success_rate: number;
  rto_rate: number;
  composite_risk_score: number; // 0 (pristine) to 100 (extreme fraud)
  risk_tier: RtoRiskTier;

  first_seen_at: string;
  last_outcome: "DELIVERED" | "RETURNED" | "CANCELLED" | "PENDING";
  last_outcome_at: string;
  updated_at: string;
}

/**
 * Tenant-scoped evaluation result for an individual order.
 */
export interface OrderRtoEvaluationRecord {
  id: string; // "rto_eval_xxx"
  tenant_id: string;
  order_id: string;
  order_number: string;
  phone_hash: string;

  risk_score: number; // 0 to 100
  risk_tier: RtoRiskTier;
  recommended_action: RecommendedAction;

  factors: {
    network_orders_count: number;
    network_success_rate: number;
    geo_risk_score: number;
    order_anomaly_score: number;
    courier_feed_score?: number;
    summary_reason: string;
  };

  advance_fee_requested: boolean;
  advance_fee_paid: boolean;
  advance_payment_id?: string;

  evaluated_at: string;
}

/**
 * Tenant-scoped configuration settings for RTO defense rules.
 */
export interface TenantRtoSettingsRecord {
  tenant_id: string;
  is_enabled: boolean;
  auto_advance_fee_threshold: number; // e.g. 55 -> request advance fee if score >= 55
  advance_fee_amount_bdt: number;     // e.g. 120 BDT
  auto_cancel_unpaid_hours: number;   // e.g. 24 hours
  enable_courier_fake_attempt_check: boolean;
  exempt_returning_customers: boolean; // Exempt buyers with prior successful delivery with this store
  updated_at: string;
}

/**
 * Courier phantom-attempt dispute record when riders falsely claim customer refusal.
 */
export interface CourierDisputeRecord {
  id: string;
  tenant_id: string;
  order_id: string;
  shipment_id: string;
  courier_provider: string;
  tracking_number: string;
  customer_feedback: "RIDER_DID_NOT_CALL" | "RIDER_REFUSED_ENTRY" | "OTHER";
  status: "OPEN" | "SUBMITTED_TO_COURIER" | "RESOLVED_REATTEMPT" | "REJECTED";
  created_at: string;
  updated_at: string;
}
