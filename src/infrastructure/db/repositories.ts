/**
 * CommerceOS — Authoritative Repository Registry
 * Central access point for all domain repositories backed by Neon PostgreSQL.
 */

export { BaseRepository, GlobalRepository } from './base-repository';
export type { PaginationOptions, PaginatedResult, WhereClause } from './base-repository';

export { tenantRepository, TenantRepository } from '@/domains/tenants/tenant.repository';
export { userRepository, UserRepository } from '@/domains/auth/user.repository';
export { productRepository, ProductRepository } from '@/domains/catalog/product.repository';
export { inventoryRepository, InventoryRepository } from '@/domains/inventory/inventory.repository';
export { customerRepository, CustomerRepository } from '@/domains/customers/customer.repository';
export { orderRepository, OrderRepository } from '@/domains/orders/order.repository';
export { paymentRepository, PaymentRepository } from '@/domains/payments/payment.repository';
export { shippingRepository, ShippingRepository } from '@/domains/shipping/shipping.repository';
export { socialRepository, SocialRepository } from '@/domains/social/social.repository';
export { aiRepository, AiRepository } from '@/domains/ai/ai.repository';
export { automationRepository, AutomationRepository } from '@/domains/automation/automation.repository';
