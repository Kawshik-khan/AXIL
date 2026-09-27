/**
 * CommerceOS Phase 2: Canonical Commerce Domain Types & Enums
 */

// ==================== CATALOG TYPES ====================
export type ProductStatus =
  | "DRAFT"
  | "ACTIVE"
  | "ARCHIVED"
  | "OUT_OF_STOCK"
  | "DISCONTINUED";

export interface ProductVariant {
  id: string;
  tenant_id: string;
  product_id: string;
  sku: string;
  barcode?: string;
  title: string;
  price: number;
  compare_at_price?: number;
  cost_price?: number;
  weight?: number;
  attributes: Record<string, string>;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  short_description?: string;
  category_id?: string;
  brand_id?: string;
  sku: string;
  barcode?: string;
  base_price: number;
  compare_at_price?: number;
  cost_price?: number;
  currency: string;
  tax_class?: string;
  weight?: number;
  status: ProductStatus;
  images: string[];
  primary_image?: string;
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  status: "ACTIVE" | "ARCHIVED";
  created_at: string;
}

export interface Brand {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  status: "ACTIVE" | "ARCHIVED";
  created_at: string;
}

// ==================== INVENTORY TYPES ====================
export type StockMovementType =
  | "PURCHASE"
  | "SALE"
  | "RESERVATION"
  | "RELEASE"
  | "RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export interface Warehouse {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  district: string;
  postal_code?: string;
  phone?: string;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  tenant_id: string;
  warehouse_id: string;
  product_variant_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number; // Derived: on_hand - reserved
  reorder_point: number;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  tenant_id: string;
  warehouse_id: string;
  product_variant_id: string;
  type: StockMovementType;
  quantity: number;
  reference_type?: string;
  reference_id?: string;
  reason: string;
  actor_user_id: string;
  created_at: string;
}

export interface InventoryReservation {
  id: string;
  tenant_id: string;
  order_id: string;
  product_variant_id: string;
  warehouse_id: string;
  quantity: number;
  status: "ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED";
  expires_at: string;
  created_at: string;
}

// ==================== CUSTOMER TYPES ====================
export type CustomerSource = "MANUAL" | "WEBSITE" | "IMPORT" | "SOCIAL";

export interface CustomerAddress {
  id: string;
  tenant_id: string;
  customer_id: string;
  type: "BILLING" | "SHIPPING";
  is_default: boolean;
  country: string;
  division: string;
  district: string;
  upazila?: string;
  area?: string;
  address_line_1: string;
  address_line_2?: string;
  postal_code?: string;
  phone?: string;
  created_at: string;
}

export interface Customer {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone: string; // Normalized to +880
  status: "ACTIVE" | "BLACKLISTED";
  source: CustomerSource;
  notes?: string;
  total_orders?: number;
  total_spent?: number;
  last_order_at?: string;
  addresses?: CustomerAddress[];
  created_at: string;
  updated_at: string;
}

// ==================== ORDER TYPES ====================
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURN_REQUESTED"
  | "RETURNED"
  | "REFUNDED";

export type PaymentStatus =
  | "UNPAID"
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type FulfillmentStatus =
  | "UNFULFILLED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELLED";

export type PaymentMethod = "COD" | "BKASH" | "NAGAD" | "ROCKET" | "CARD";

export interface OrderItem {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string;
  variant_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  unit_price: number;
  quantity: number;
  discount: number;
  tax: number;
  line_total: number;
}

export interface Order {
  id: string;
  tenant_id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  tax_total: number;
  grand_total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  shipping_address_snapshot: Partial<CustomerAddress>;
  billing_address_snapshot?: Partial<CustomerAddress>;
  coupon_code?: string;
  notes?: string;
  source: CustomerSource;
  items?: OrderItem[];
  created_at: string;
  updated_at: string;
}

// ==================== PAYMENT & SHIPPING TYPES ====================
export interface Payment {
  id: string;
  tenant_id: string;
  order_id: string;
  provider: PaymentMethod;
  transaction_id?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  idempotency_key?: string;
  /** How a PAID payment was confirmed: MANUAL (a user checked the TrxID) until provider gateways exist (FX-52). */
  verification_method?: "MANUAL" | "GATEWAY";
  verified_by?: string;
  verified_at?: string;
  created_at: string;
}

export type CourierProviderName =
  | "PATHAO"
  | "STEADFAST"
  | "REDX"
  | "PAPERFLY"
  | "MANUAL";

export type DeliveryStatus =
  | "PENDING"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED"
  | "RETURNED"
  | "CANCELLED";

export interface Shipment {
  id: string;
  tenant_id: string;
  order_id: string;
  courier_provider: CourierProviderName;
  consignment_id?: string;
  tracking_number: string;
  status: DeliveryStatus;
  shipping_cost: number;
  estimated_delivery?: string;
  shipped_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}

// ==================== RETURNS & REFUNDS ====================
export type ReturnStatus =
  | "REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "RECEIVED"
  | "COMPLETED"
  | "CANCELLED";

export interface Return {
  id: string;
  tenant_id: string;
  order_id: string;
  customer_id: string;
  status: ReturnStatus;
  reason: string;
  notes?: string;
  requested_at: string;
  approved_at?: string;
  received_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Refund {
  id: string;
  tenant_id: string;
  order_id: string;
  payment_id: string;
  return_id?: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  reason: string;
  created_at: string;
}

// ==================== PROMOTIONS ====================
export interface Coupon {
  id: string;
  tenant_id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minimum_order_value?: number;
  maximum_discount?: number;
  usage_limit?: number;
  usage_count: number;
  expires_at?: string;
  status: "ACTIVE" | "EXPIRED" | "DISABLED";
  created_at: string;
}

// ==================== CANONICAL COMMERCE EVENTS ====================
export interface CommerceEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  version: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  actor_id?: string;
  correlation_id?: string;
  timestamp: string;
  payload: T;
}

export interface WebhookSubscription {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  events: string[];
  status: "ACTIVE" | "DISABLED";
  created_at: string;
}
