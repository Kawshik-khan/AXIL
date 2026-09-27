# CommerceOS Relational Data Model & Schemas

> **Status:** TARGET schema (Postgres). The live shapes are the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`; SQL in `src/infrastructure/db/migrations/`.

CommerceOS implements a strictly typed, normalized relational schema in PostgreSQL 16+. Every tenant-owned table is partitioned or indexed by `tenant_id`.

---

## 1. Core Entity Relationship Overview

```
TENANT (1) ──── (N) USER (N) ──── (N) ROLE ──── (N) PERMISSION
   │
   ├── (N) CUSTOMER (1) ──── (N) CUSTOMER_IDENTITY (FB / IG / WA / Phone)
   │         │
   │         ├── (N) CONVERSATION (1) ──── (N) MESSAGE
   │         │
   │         ├── (N) CART (1) ──── (N) CART_ITEM
   │         │
   │         └── (N) ORDER (1) ────┬──── (N) ORDER_ITEM
   │                               ├──── (N) PAYMENT (1) ──── (N) REFUND
   │                               └──── (N) SHIPMENT (1) ──── (N) SHIPMENT_EVENT
   │
   ├── (N) PRODUCT (1) ──── (N) PRODUCT_VARIANT (1) ──── (1) INVENTORY
   │         │                                                │
   │         └── (N) CATEGORY                                 └── (N) INVENTORY_MOVEMENT
   │
   ├── (N) KNOWLEDGE_DOCUMENT (1) ──── (N) KNOWLEDGE_CHUNK (pgvector embedding)
   │
   ├── (N) AGENT (1) ──── (N) AGENT_RUN (1) ──── (N) AGENT_TOOL_CALL
   │
   ├── (N) CAMPAIGN (1) ──── (N) CAMPAIGN_MESSAGE
   │
   └── (N) AUDIT_LOG
```

---

## 2. Table Specifications & Schema Definitions

### 2.1 Tenants & IAM
```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    timezone VARCHAR(50) DEFAULT 'Asia/Dhaka',
    settings JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL DEFAULT 'SALES',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, email)
);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
```

### 2.2 Customers & Conversational Ingress
```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    primary_phone VARCHAR(50),
    full_name VARCHAR(255),
    email VARCHAR(255),
    default_address JSONB,
    district VARCHAR(100),
    is_blacklisted BOOLEAN DEFAULT false,
    total_orders INT DEFAULT 0,
    total_spent NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, primary_phone)
);

CREATE TABLE customer_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL, -- 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'WEB'
    identifier VARCHAR(255) NOT NULL, -- PSID, Scoped ID, phone number
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, channel, identifier)
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL,
    assigned_agent VARCHAR(50) DEFAULT 'CUSTOMER_SUPPORT',
    status VARCHAR(50) DEFAULT 'OPEN', -- 'OPEN', 'PENDING_HUMAN', 'RESOLVED'
    last_message_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL, -- 'CUSTOMER', 'AGENT', 'HUMAN_OPERATOR'
    content TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'bn', -- 'en', 'bn', 'banglish'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_messages_convo ON messages(tenant_id, conversation_id, created_at DESC);
```

### 2.3 Product Catalog & Real-Time Inventory
```sql
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    base_price NUMERIC(10, 2) NOT NULL,
    cost_price NUMERIC(10, 2),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL, -- e.g. "Size XL / Charcoal"
    price NUMERIC(10, 2) NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, sku)
);

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_variant_id UUID UNIQUE NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    stock INT NOT NULL DEFAULT 0,
    reserved_stock INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    reorder_quantity INT NOT NULL DEFAULT 20,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
```

### 2.4 Orders, Payments & Shipments
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    subtotal NUMERIC(12, 2) NOT NULL,
    delivery_charge NUMERIC(10, 2) NOT NULL DEFAULT 60.00,
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL, -- 'COD', 'BKASH', 'NAGAD', 'CARD'
    payment_status VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
    delivery_address JSONB NOT NULL,
    delivery_zone VARCHAR(50) NOT NULL, -- 'INSIDE_DHAKA', 'OUTSIDE_DHAKA'
    courier_provider VARCHAR(50), -- 'STEADFAST', 'PATHAO', 'REDX'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, order_number)
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'BKASH', 'NAGAD', 'SSLCOMMERZ', 'COD'
    transaction_id VARCHAR(255),
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED', -- 'VERIFIED', 'FAILED', 'REFUNDED'
    raw_response JSONB,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier VARCHAR(50) NOT NULL,
    consignment_id VARCHAR(255) NOT NULL,
    tracking_code VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED', -- 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED'
    delivery_fee NUMERIC(10, 2) NOT NULL,
    cod_amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
```

### 2.5 RAG Knowledge & pgvector
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'FAQ', 'POLICY', 'PRODUCT_CATALOG', 'MANUAL'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- Compatible with standard embedding dimensions
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_chunks_vector ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_chunks_tenant ON knowledge_chunks(tenant_id);
```

### 2.6 Agent Execution & Auditing
```sql
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    input_text TEXT NOT NULL,
    output_text TEXT,
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'FAILED', 'ESCALATED'
    latency_ms INT NOT NULL,
    tokens_used INT DEFAULT 0,
    cost_estimated NUMERIC(10, 6) DEFAULT 0.000000,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE agent_tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    arguments JSONB NOT NULL,
    result JSONB,
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'POLICY_REJECTED', 'ERROR'
    duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id UUID,
    actor_type VARCHAR(50) NOT NULL, -- 'USER', 'AGENT', 'N8N_WORKFLOW'
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    diff JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_audit_tenant_resource ON audit_logs(tenant_id, resource_type, created_at DESC);

### 2.7 Social Commerce & Omnichannel Tables (Phase 3)
```sql
CREATE TABLE connected_channels (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'WHATSAPP', 'WEBSITE_CHAT'
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    provider_account_id VARCHAR(255) NOT NULL,
    external_page_id VARCHAR(255),
    external_business_id VARCHAR(255),
    external_phone_number_id VARCHAR(255),
    credentials_encrypted TEXT NOT NULL, -- AES-256-GCM encrypted
    configuration JSONB DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_chn_tenant ON connected_channels(tenant_id);

CREATE TABLE customer_identities (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    channel_id VARCHAR(100) NOT NULL,
    channel_type VARCHAR(50) NOT NULL,
    external_user_id VARCHAR(255) NOT NULL,
    external_username VARCHAR(255),
    display_name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    first_seen_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    last_seen_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_cust_ident_lookup ON customer_identities(tenant_id, channel_id, external_user_id);
CREATE INDEX idx_cust_ident_phone ON customer_identities(tenant_id, phone);

CREATE TABLE conversations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    channel_id VARCHAR(100) NOT NULL,
    channel_type VARCHAR(50) NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    external_conversation_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'PENDING', 'WAITING_CUSTOMER', 'WAITING_AGENT', 'RESOLVED', 'CLOSED', 'SPAM'
    priority VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    mode VARCHAR(50) NOT NULL DEFAULT 'HUMAN',
    assigned_user_id VARCHAR(100),
    assigned_team_id VARCHAR(50),
    automation_paused BOOLEAN DEFAULT false,
    last_message_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    last_inbound_at TIMESTAMPTZ,
    unread_count INT DEFAULT 0,
    tags JSONB DEFAULT '[]',
    source VARCHAR(50) DEFAULT 'OTHER',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_conv_tenant_filter ON conversations(tenant_id, status, last_message_at DESC);

CREATE TABLE messages (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    conversation_id VARCHAR(100) NOT NULL,
    external_message_id VARCHAR(255),
    direction VARCHAR(20) NOT NULL, -- 'INBOUND', 'OUTBOUND'
    sender_type VARCHAR(50) NOT NULL, -- 'CUSTOMER', 'AGENT', 'BOT', 'SYSTEM'
    sender_id VARCHAR(100) NOT NULL,
    message_type VARCHAR(50) NOT NULL, -- 'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'ORDER_DRAFT', 'INTERNAL_NOTE'
    text TEXT,
    normalized_text TEXT,
    attachments JSONB DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'PROCESSED', -- 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'
    idempotency_key VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_msg_conv_order ON messages(tenant_id, conversation_id, created_at ASC);
CREATE INDEX idx_msg_idempotency ON messages(tenant_id, idempotency_key);

-- ============================================================
-- 10. PHASE 8: AUTONOMOUS COMMERCE OPERATIONS TABLES
-- ============================================================

CREATE TABLE suppliers (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    lead_time_days INT NOT NULL DEFAULT 3,
    minimum_order_value_bdt NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    rating NUMERIC(3,2) DEFAULT 5.0,
    payment_terms VARCHAR(50) DEFAULT 'NET_30',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id, status);

CREATE TABLE supplier_products (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    supplier_id VARCHAR(100) NOT NULL REFERENCES suppliers(id),
    product_variant_id VARCHAR(100) NOT NULL,
    supplier_sku VARCHAR(100),
    cost_price NUMERIC(12,2) NOT NULL,
    moq INT NOT NULL DEFAULT 1,
    lead_time_days INT NOT NULL DEFAULT 3,
    is_preferred BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_sp_tenant_variant ON supplier_products(tenant_id, product_variant_id);

CREATE TABLE purchase_orders (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    po_number VARCHAR(100) NOT NULL,
    supplier_id VARCHAR(100) NOT NULL REFERENCES suppliers(id),
    supplier_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'
    items JSONB NOT NULL DEFAULT '[]',
    total_amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    expected_delivery_date TIMESTAMPTZ,
    approved_by VARCHAR(100),
    approved_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_po_tenant_status ON purchase_orders(tenant_id, status);

CREATE TABLE operational_exceptions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL, -- 'INVENTORY', 'PROCUREMENT', 'PRICING', 'ORDERS', 'FULFILLMENT', 'SHIPPING', 'PAYMENTS', 'FINANCE', 'SUPPORT', 'RETURNS'
    exception_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    title VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DETECTED', -- 'DETECTED', 'ANALYZING', 'ACTION_PROPOSED', 'RESOLVED', 'DISMISSED', 'ESCALATED'
    assigned_agent VARCHAR(100),
    assigned_human VARCHAR(100),
    root_cause_hypothesis TEXT,
    proposed_resolution TEXT,
    resolution_notes TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_exceptions_tenant ON operational_exceptions(tenant_id, domain, severity, status);

CREATE TABLE action_receipts (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    actor_agent VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'VERIFICATION_FAILED', 'ROLLED_BACK'
    state_before_hash VARCHAR(64) NOT NULL,
    state_after_hash VARCHAR(64) NOT NULL,
    verification_method VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    rollback_supported BOOLEAN DEFAULT false,
    rollback_payload JSONB
);
CREATE INDEX idx_receipts_tenant ON action_receipts(tenant_id, executed_at DESC);
CREATE INDEX idx_receipts_idempotency ON action_receipts(tenant_id, idempotency_key);

CREATE TABLE autonomy_budgets (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL UNIQUE,
    daily_max_spend_bdt NUMERIC(12,2) NOT NULL DEFAULT 50000,
    daily_spent_bdt NUMERIC(12,2) NOT NULL DEFAULT 0,
    daily_max_actions INT NOT NULL DEFAULT 100,
    daily_actions_count INT NOT NULL DEFAULT 0,
    max_single_action_bdt NUMERIC(12,2) NOT NULL DEFAULT 15000,
    kill_switch_active BOOLEAN NOT NULL DEFAULT false,
    kill_switch_reason TEXT,
    kill_switch_triggered_at TIMESTAMPTZ,
    kill_switch_triggered_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE provider_health (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    provider_name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY', -- 'HEALTHY', 'DEGRADED', 'CIRCUIT_BROKEN', 'MAINTENANCE'
    health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
    consecutive_failures INT NOT NULL DEFAULT 0,
    failure_threshold INT NOT NULL DEFAULT 5,
    circuit_breaker_tripped_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX idx_prov_health ON provider_health(tenant_id, provider_type);
```

### 2.12 Automation Hub, n8n Orchestration & Webhooks (Phase 6)
```sql
CREATE TABLE automations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- 'ORDERS', 'INVENTORY', 'CUSTOMERS', 'LOGISTICS', 'PAYMENTS', 'MARKETING', 'RETURNS', 'ANALYTICS'
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'ACTIVE', 'INACTIVE', 'DRAFT', 'ERROR', 'DEPRECATED'
    trigger_type VARCHAR(50) NOT NULL, -- 'EVENT', 'SCHEDULE', 'WEBHOOK', 'MANUAL'
    trigger_config JSONB NOT NULL DEFAULT '{}',
    conditions JSONB NOT NULL DEFAULT '[]',
    actions JSONB NOT NULL DEFAULT '[]',
    provider_type VARCHAR(50) NOT NULL DEFAULT 'INTERNAL', -- 'INTERNAL', 'N8N', 'WEBHOOK'
    provider_config JSONB NOT NULL DEFAULT '{}',
    execution_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    last_executed_at TIMESTAMPTZ,
    last_execution_status VARCHAR(50),
    is_template BOOLEAN NOT NULL DEFAULT false,
    version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_automations_tenant_status ON automations(tenant_id, status);
CREATE INDEX idx_automations_tenant_trigger ON automations(tenant_id, trigger_type);

CREATE TABLE automation_workflows (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    current_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    tags TEXT[] DEFAULT '{}',
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_workflows_tenant ON automation_workflows(tenant_id, status);

CREATE TABLE automation_workflow_versions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workflow_id VARCHAR(100) NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
    version VARCHAR(20) NOT NULL,
    changelog TEXT,
    definition JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    published_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_wf_versions ON automation_workflow_versions(tenant_id, workflow_id, version);

CREATE TABLE automation_executions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    automation_id VARCHAR(100) NOT NULL,
    workflow_id VARCHAR(100),
    trigger_type VARCHAR(50) NOT NULL,
    trigger_event_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED', -- 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'RETRYING', 'DEAD_LETTERED'
    idempotency_key VARCHAR(255) NOT NULL,
    correlation_id VARCHAR(100) NOT NULL,
    causation_id VARCHAR(100),
    recursion_depth INT NOT NULL DEFAULT 0,
    is_dry_run BOOLEAN NOT NULL DEFAULT false,
    input_payload JSONB NOT NULL DEFAULT '{}',
    output_payload JSONB,
    error_message TEXT,
    error_code VARCHAR(100),
    error_details JSONB,
    retry_count INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_exec_tenant_status ON automation_executions(tenant_id, status, created_at DESC);
CREATE INDEX idx_auto_exec_idempotency ON automation_executions(tenant_id, idempotency_key);
CREATE INDEX idx_auto_exec_correlation ON automation_executions(tenant_id, correlation_id);

CREATE TABLE automation_idempotency_keys (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    operation VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING', -- 'PROCESSING', 'COMPLETED', 'FAILED'
    resource_id VARCHAR(100),
    response_status INT,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, key, operation)
);
CREATE INDEX idx_auto_idemp_lookup ON automation_idempotency_keys(tenant_id, key, operation);

CREATE TABLE automation_retry_queue (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    execution_id VARCHAR(100) NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
    automation_id VARCHAR(100) NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    max_attempts INT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'RESOLVED', 'EXHAUSTED', 'ABORTED'
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_retry_tenant_next ON automation_retry_queue(tenant_id, status, next_retry_at);

CREATE TABLE automation_dead_letters (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    execution_id VARCHAR(100) NOT NULL,
    automation_id VARCHAR(100) NOT NULL,
    error_category VARCHAR(50) NOT NULL, -- 'TIMEOUT', 'AUTH_FAILURE', 'NETWORK_ERROR', 'SCHEMA_VALIDATION', 'CIRCUIT_BROKEN', 'BUSINESS_RULE_VIOLATION', 'RATE_LIMITED', 'INTERNAL_ERROR'
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'NEW', -- 'NEW', 'INVESTIGATING', 'REPLAYED', 'RESOLVED', 'DISCARDED'
    replayed_at TIMESTAMPTZ,
    replayed_execution_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_dlq_tenant ON automation_dead_letters(tenant_id, status, error_category);

CREATE TABLE automation_providers (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'N8N', 'INTERNAL', 'CUSTOM_WEBHOOK'
    base_url VARCHAR(500) NOT NULL,
    circuit_breaker_state VARCHAR(50) NOT NULL DEFAULT 'NORMAL', -- 'NORMAL', 'DEGRADED', 'OPEN', 'HALF_OPEN'
    failure_count INT NOT NULL DEFAULT 0,
    health_status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
    last_health_check_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_prov_tenant ON automation_providers(tenant_id, type);

CREATE TABLE automation_webhook_configs (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider_name VARCHAR(100) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    signature_header VARCHAR(100) NOT NULL,
    signature_algorithm VARCHAR(50) NOT NULL DEFAULT 'sha256',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, provider_name)
);

CREATE TABLE automation_webhook_logs (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(100) NOT NULL,
    event_type VARCHAR(100),
    status VARCHAR(50) NOT NULL, -- 'PROCESSED', 'REJECTED_SIGNATURE', 'REJECTED_TIMESTAMP', 'REJECTED_DUPLICATE', 'FAILED'
    ip_address VARCHAR(50),
    headers JSONB NOT NULL DEFAULT '{}',
    payload JSONB NOT NULL DEFAULT '{}',
    received_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX idx_auto_wh_logs_tenant ON automation_webhook_logs(tenant_id, provider, received_at DESC);
```

---

### 2.15 Platform Control Plane Entities & SaaS Governance Schemas (Proposed)

The following relational entities are proposed for the SaaS Owner / Super Admin platform control plane. They reside outside individual tenant boundaries:

```sql
-- Platform IAM & Roles
CREATE TABLE platform_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_OPERATIONS', 'PLATFORM_SUPPORT', 'PLATFORM_FINANCE', 'PLATFORM_SECURITY', 'PLATFORM_ANALYST'
    mfa_enabled BOOLEAN NOT NULL DEFAULT true,
    mfa_secret VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (user_id)
);
CREATE INDEX idx_plat_mem_user ON platform_memberships(user_id, role);

CREATE TABLE platform_permissions (
    id VARCHAR(100) PRIMARY KEY, -- e.g. 'tenant.suspend', 'subscription.manage'
    category VARCHAR(50) NOT NULL, -- 'TENANT', 'BILLING', 'AUTOMATION', 'SECURITY', 'AUDIT'
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE platform_role_permissions (
    role VARCHAR(50) NOT NULL,
    permission_id VARCHAR(100) NOT NULL REFERENCES platform_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_id)
);

-- Governed Support Impersonation Sessions
CREATE TABLE impersonation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    ticket_reference VARCHAR(100),
    mode VARCHAR(20) NOT NULL DEFAULT 'READ_ONLY', -- 'READ_ONLY', 'MUTATION_APPROVED'
    step_up_verified_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_impers_tenant_active ON impersonation_sessions(target_tenant_id, expires_at) WHERE revoked_at IS NULL;

-- SaaS Billing, Plans & Entitlements
CREATE TABLE plans (
    id VARCHAR(50) PRIMARY KEY, -- 'FREE_TIER', 'STARTER', 'GROWTH', 'ENTERPRISE'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE plan_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    version INT NOT NULL DEFAULT 1,
    billing_period VARCHAR(20) NOT NULL DEFAULT 'MONTHLY', -- 'MONTHLY', 'ANNUAL'
    price_bdt NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    features JSONB NOT NULL DEFAULT '{}',
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (plan_id, version)
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    plan_version_id UUID NOT NULL REFERENCES plan_versions(id),
    status VARCHAR(50) NOT NULL DEFAULT 'TRIAL', -- 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id)
);
CREATE INDEX idx_sub_tenant_status ON subscriptions(tenant_id, status);

CREATE TABLE entitlements (
    id VARCHAR(100) PRIMARY KEY, -- 'orders.monthly_limit', 'channels.max_connected', 'ai.tokens_monthly'
    name VARCHAR(100) NOT NULL,
    value_type VARCHAR(20) NOT NULL DEFAULT 'NUMERIC', -- 'NUMERIC', 'BOOLEAN', 'TIER'
    default_value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE tenant_entitlements (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entitlement_id VARCHAR(100) NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
    value JSONB NOT NULL,
    is_override BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, entitlement_id)
);

CREATE TABLE usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entitlement_id VARCHAR(100) NOT NULL REFERENCES entitlements(id),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    quantity_used NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    recorded_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, entitlement_id, period_start)
);
CREATE INDEX idx_usage_tenant_period ON usage_records(tenant_id, period_start, period_end);

-- Platform Feature Flags & Global Configuration
CREATE TABLE platform_feature_flags (
    id VARCHAR(100) PRIMARY KEY, -- e.g. 'flag.social_widget_v2', 'flag.ai_gemini_flash'
    description TEXT,
    is_enabled_globally BOOLEAN NOT NULL DEFAULT false,
    percentage_rollout INT NOT NULL DEFAULT 0,
    tenant_allowlist JSONB NOT NULL DEFAULT '[]',
    rules JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE platform_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'AI_MODELS', 'SECURITY', 'STORAGE', 'N8N_CLUSTER'
    description TEXT,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE platform_setting_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) NOT NULL REFERENCES platform_settings(key) ON DELETE CASCADE,
    value JSONB NOT NULL,
    changed_by_user_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Operational Incidents & Maintenance
CREATE TABLE platform_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    status VARCHAR(50) NOT NULL DEFAULT 'INVESTIGATING', -- 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'
    affected_components JSONB NOT NULL DEFAULT '[]', -- ['n8n', 'api', 'database', 'bkash_gateway']
    impact_summary TEXT,
    started_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE platform_maintenance_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Immutable Platform Audit & Security Ledger
CREATE TABLE platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES users(id),
    effective_actor_id UUID REFERENCES users(id),
    platform_role VARCHAR(50) NOT NULL,
    target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    result VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED', 'BLOCKED'
    error_message TEXT,
    request_id VARCHAR(100) NOT NULL,
    correlation_id VARCHAR(100) NOT NULL,
    impersonation_session_id UUID REFERENCES impersonation_sessions(id) ON DELETE SET NULL,
    ip_address VARCHAR(50),
    user_agent VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_plat_audit_actor ON platform_audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_plat_audit_tenant ON platform_audit_logs(target_tenant_id, created_at DESC);

-- Platform Kill Switches
CREATE TABLE platform_kill_switches (
    id VARCHAR(100) PRIMARY KEY, -- 'GLOBAL_AUTOMATION', 'GLOBAL_AI_RUNTIMES', 'TENANT_AUTO:<id>'
    scope VARCHAR(50) NOT NULL, -- 'GLOBAL', 'TENANT', 'WORKFLOW', 'PROVIDER', 'CHANNEL'
    target_id VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT false,
    reason TEXT NOT NULL,
    activated_by_user_id UUID NOT NULL REFERENCES users(id),
    activated_at TIMESTAMPTZ,
    deactivated_by_user_id UUID REFERENCES users(id),
    deactivated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE platform_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL, -- 'UNAUTHORIZED_ACCESS_ATTEMPT', 'STEP_UP_FAILED', 'BREAK_GLASS_TRIGGERED', 'RATE_LIMIT_EXCEEDED'
    severity VARCHAR(20) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'
    actor_user_id UUID REFERENCES users(id),
    target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX idx_plat_sec_events ON platform_security_events(event_type, severity, created_at DESC);
```



