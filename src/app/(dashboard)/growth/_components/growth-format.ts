/** Wording and number formats shared by the Growth pages. Labels only: every number comes from the API. */

export type LifecycleStage =
  | "PROSPECT"
  | "NEW"
  | "FIRST_PURCHASE"
  | "ACTIVE"
  | "REPEAT"
  | "LOYAL"
  | "AT_RISK"
  | "DORMANT"
  | "CHURNED"
  | "REACTIVATED";

export interface StageInfo {
  key: LifecycleStage;
  label: string;
  hint: string;
  /** Slipping stages are drawn in the warning colour */
  slipping: boolean;
}

/** Order: how a customer moves through the shop, then the stages where they slip away. */
export const STAGES: StageInfo[] = [
  { key: "PROSPECT", label: "Prospect", hint: "Talked to the shop, no order yet", slipping: false },
  { key: "NEW", label: "New", hint: "Recently added customer", slipping: false },
  { key: "FIRST_PURCHASE", label: "First order", hint: "Has ordered once", slipping: false },
  { key: "ACTIVE", label: "Active", hint: "Ordering recently", slipping: false },
  { key: "REPEAT", label: "Repeat", hint: "Has ordered several times", slipping: false },
  { key: "LOYAL", label: "Loyal", hint: "Orders often or spends the most", slipping: false },
  { key: "REACTIVATED", label: "Won back", hint: "Ordered again after going quiet", slipping: false },
  { key: "AT_RISK", label: "At risk", hint: "Ordering less than before", slipping: true },
  { key: "DORMANT", label: "Dormant", hint: "No order for a long time", slipping: true },
  { key: "CHURNED", label: "Churned", hint: "Unlikely to come back", slipping: true },
];

export function formatBdt(amount: number | null | undefined): string {
  return `৳${Math.round(amount ?? 0).toLocaleString("en-US")}`;
}

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const FIELD_LABELS: Record<string, string> = {
  total_spend: "Spent",
  order_count: "Orders",
  average_order_value: "Average order",
  last_purchase_days_ago: "Last order",
  first_purchase_days_ago: "First order",
  location: "Location",
  source: "Source",
  lifecycle_stage: "Stage",
  rfm_segment: "RFM segment",
  predicted_ltv_bdt: "Predicted value",
  churn_risk_level: "Churn risk",
  purchased_product_id: "Bought product",
  purchased_category: "Bought from",
  has_returned_order: "Returned an order",
  has_failed_payment: "Failed payment",
  has_abandoned_cart: "Abandoned cart",
};

const OPERATORS: Record<string, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  GREATER_THAN: ">",
  GREATER_THAN_OR_EQUAL: "≥",
  LESS_THAN: "<",
  LESS_THAN_OR_EQUAL: "≤",
  CONTAINS: "contains",
  IN: "is one of",
  NOT_IN: "is not one of",
  BETWEEN: "between",
  WITHIN_LAST_DAYS: "within",
  BEFORE_DAYS_AGO: "more than",
};

const MONEY_FIELDS = new Set(["total_spend", "average_order_value", "predicted_ltv_bdt"]);
const DAY_FIELDS = new Set(["last_purchase_days_ago", "first_purchase_days_ago"]);

export interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

/** "Spent ≥ ৳10,000", "Last order ≥ 60 days ago", "Abandoned cart". */
export function describeCondition(c: RuleCondition): string {
  const field = FIELD_LABELS[c.field] ?? c.field.replace(/_/g, " ");
  if (typeof c.value === "boolean") return c.value === (c.operator !== "NOT_EQUALS") ? field : `No ${field.toLowerCase()}`;
  const op = OPERATORS[c.operator] ?? c.operator.toLowerCase();
  let value: string;
  if (Array.isArray(c.value)) value = c.value.join(", ");
  else if (typeof c.value === "number" && MONEY_FIELDS.has(c.field)) value = formatBdt(c.value);
  else if (typeof c.value === "number" && DAY_FIELDS.has(c.field)) value = `${c.value} days ago`;
  else value = String(c.value).replace(/_/g, " ").toLowerCase();
  return `${field} ${op} ${value}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
