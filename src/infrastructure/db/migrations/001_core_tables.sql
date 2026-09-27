-- ============================================================
-- CommerceOS Migration 001: Core Tables
-- Neon PostgreSQL — All tenant-scoped with proper indexes
-- ============================================================

-- ── 1. Tenants & IAM ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    timezone VARCHAR(50) DEFAULT 'Asia/Dhaka',
    language VARCHAR(10) DEFAULT 'en',
    settings JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar TEXT,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS memberships (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'SALES',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS invitations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    token VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    actor_user_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}',
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_resource ON audit_logs(tenant_id, resource_type, resource_id);

-- ── 2. Product Catalog ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    parent_id VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS brands (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    brand_id VARCHAR(100),
    base_price NUMERIC(12, 2) NOT NULL,
    compare_at_price NUMERIC(12, 2),
    cost_price NUMERIC(12, 2),
    currency VARCHAR(10) DEFAULT 'BDT',
    status VARCHAR(50) DEFAULT 'ACTIVE',
    tags JSONB DEFAULT '[]',
    media JSONB DEFAULT '[]',
    seo JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant_status ON products(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category);

CREATE TABLE IF NOT EXISTS product_variants (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    cost_price NUMERIC(12, 2),
    attributes JSONB NOT NULL DEFAULT '{}',
    weight_grams INT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(tenant_id, product_id);

-- ── 3. Inventory ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouses (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_variant_id VARCHAR(100) NOT NULL,
    warehouse_id VARCHAR(100),
    stock INT NOT NULL DEFAULT 0,
    reserved_stock INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    reorder_quantity INT NOT NULL DEFAULT 20,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_variant ON inventory_items(tenant_id, product_variant_id);

CREATE TABLE IF NOT EXISTS stock_movements (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_variant_id VARCHAR(100) NOT NULL,
    warehouse_id VARCHAR(100),
    movement_type VARCHAR(50) NOT NULL,
    quantity INT NOT NULL,
    reference_type VARCHAR(50),
    reference_id VARCHAR(100),
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_reservations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_variant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100),
    quantity INT NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON inventory_reservations(tenant_id, status);

-- ── 4. Customers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    district VARCHAR(100),
    default_address JSONB,
    tags JSONB DEFAULT '[]',
    total_orders INT DEFAULT 0,
    total_spent NUMERIC(12, 2) DEFAULT 0.00,
    lifetime_value NUMERIC(12, 2) DEFAULT 0.00,
    is_blacklisted BOOLEAN DEFAULT false,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email);

CREATE TABLE IF NOT EXISTS customer_addresses (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id VARCHAR(100) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label VARCHAR(100),
    full_name VARCHAR(255),
    phone VARCHAR(50),
    address_line TEXT NOT NULL,
    area VARCHAR(100),
    city VARCHAR(100),
    district VARCHAR(100),
    postal_code VARCHAR(20),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses ON customer_addresses(tenant_id, customer_id);

-- ── 5. Orders & Line Items ────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    customer_id VARCHAR(100) NOT NULL REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    subtotal NUMERIC(12, 2) NOT NULL,
    delivery_charge NUMERIC(10, 2) NOT NULL DEFAULT 60.00,
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
    delivery_address JSONB NOT NULL DEFAULT '{}',
    delivery_zone VARCHAR(50) NOT NULL DEFAULT 'INSIDE_DHAKA',
    courier_provider VARCHAR(50),
    notes TEXT,
    tags JSONB DEFAULT '[]',
    source VARCHAR(50) DEFAULT 'MANUAL',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_variant_id VARCHAR(100) NOT NULL,
    product_title VARCHAR(255),
    variant_title VARCHAR(255),
    sku VARCHAR(100),
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(tenant_id, order_id);

-- ── 6. Payments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(255),
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
    raw_response JSONB,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_order ON payments(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(tenant_id, transaction_id);

CREATE TABLE IF NOT EXISTS refunds (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id VARCHAR(100) REFERENCES payments(id),
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED',
    approved_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- ── 7. Shipments ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipments (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier VARCHAR(50) NOT NULL,
    consignment_id VARCHAR(255) NOT NULL,
    tracking_code VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    delivery_fee NUMERIC(10, 2),
    cod_amount NUMERIC(12, 2),
    estimated_delivery TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_consignment ON shipments(tenant_id, consignment_id);

-- ── 8. Returns ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS returns (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id VARCHAR(100) NOT NULL REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED',
    reason VARCHAR(100),
    notes TEXT,
    items JSONB DEFAULT '[]',
    refund_amount NUMERIC(12, 2),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- ── 9. Coupons ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupons (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    value NUMERIC(10, 2) NOT NULL,
    min_order_value NUMERIC(10, 2) DEFAULT 0,
    max_uses INT,
    used_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, code)
);

-- ── 10. Social Commerce ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS connected_channels (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    provider_account_id VARCHAR(255),
    external_page_id VARCHAR(255),
    credentials_encrypted TEXT,
    configuration JSONB DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_channels_tenant ON connected_channels(tenant_id);

CREATE TABLE IF NOT EXISTS customer_identities (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    channel_id VARCHAR(100),
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
CREATE INDEX IF NOT EXISTS idx_cust_ident_lookup ON customer_identities(tenant_id, channel_type, external_user_id);

CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    channel_id VARCHAR(100),
    channel_type VARCHAR(50),
    customer_id VARCHAR(100) NOT NULL,
    external_conversation_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'OPEN',
    priority VARCHAR(50) DEFAULT 'NORMAL',
    mode VARCHAR(50) DEFAULT 'HUMAN',
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
CREATE INDEX IF NOT EXISTS idx_conv_tenant_status ON conversations(tenant_id, status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    conversation_id VARCHAR(100) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    external_message_id VARCHAR(255),
    direction VARCHAR(20),
    sender_type VARCHAR(50) NOT NULL,
    sender_id VARCHAR(100),
    message_type VARCHAR(50) DEFAULT 'TEXT',
    text TEXT,
    normalized_text TEXT,
    attachments JSONB DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'PROCESSED',
    idempotency_key VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(tenant_id, conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_idempotency ON messages(tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS leads (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    customer_id VARCHAR(100),
    channel VARCHAR(50),
    status VARCHAR(50) DEFAULT 'NEW',
    buying_intent VARCHAR(50) DEFAULT 'UNKNOWN',
    score NUMERIC(5, 2) DEFAULT 0,
    source VARCHAR(100),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id, status);

-- ── 11. AI Agent Runtime ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_runs (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    agent_name VARCHAR(100) NOT NULL,
    conversation_id VARCHAR(100),
    input_text TEXT NOT NULL,
    output_text TEXT,
    status VARCHAR(50) NOT NULL,
    latency_ms INT,
    tokens_used INT DEFAULT 0,
    cost_estimated NUMERIC(10, 6) DEFAULT 0,
    model_used VARCHAR(100),
    tool_calls_count INT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    agent_run_id VARCHAR(100) NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    arguments JSONB NOT NULL DEFAULT '{}',
    result JSONB,
    status VARCHAR(50) NOT NULL,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON agent_tool_calls(tenant_id, agent_run_id);

-- ── 12. Knowledge Documents (vectors stored in Pinecone) ──────

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    file_format VARCHAR(50) DEFAULT 'MARKDOWN',
    raw_content TEXT,
    status VARCHAR(50) DEFAULT 'PROCESSING',
    version INT DEFAULT 1,
    chunk_count INT DEFAULT 0,
    language VARCHAR(20) DEFAULT 'mixed',
    tags JSONB DEFAULT '[]',
    processing_error TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_tenant ON knowledge_documents(tenant_id, status);

-- ── 13. Commerce Events ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS commerce_events (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(100),
    correlation_id VARCHAR(100),
    actor_type VARCHAR(50),
    actor_id VARCHAR(100),
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_events_tenant_type ON commerce_events(tenant_id, event_type, created_at DESC);

-- ── 14. Webhook Subscriptions ─────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    events JSONB NOT NULL DEFAULT '[]',
    secret VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- ── 15. Automations ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB NOT NULL DEFAULT '{}',
    conditions JSONB NOT NULL DEFAULT '[]',
    actions JSONB NOT NULL DEFAULT '[]',
    provider_type VARCHAR(50) DEFAULT 'INTERNAL',
    provider_config JSONB DEFAULT '{}',
    execution_count INT DEFAULT 0,
    success_count INT DEFAULT 0,
    failure_count INT DEFAULT 0,
    last_executed_at TIMESTAMPTZ,
    is_template BOOLEAN DEFAULT false,
    version VARCHAR(20) DEFAULT '1.0.0',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations(tenant_id, status);

CREATE TABLE IF NOT EXISTS automation_executions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    automation_id VARCHAR(100) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    idempotency_key VARCHAR(255) NOT NULL,
    correlation_id VARCHAR(100),
    recursion_depth INT DEFAULT 0,
    is_dry_run BOOLEAN DEFAULT false,
    input_payload JSONB DEFAULT '{}',
    output_payload JSONB,
    error_message TEXT,
    error_code VARCHAR(100),
    retry_count INT DEFAULT 0,
    duration_ms INT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_auto_exec_tenant ON automation_executions(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_exec_idemp ON automation_executions(tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS automation_dead_letters (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    execution_id VARCHAR(100) NOT NULL,
    automation_id VARCHAR(100) NOT NULL,
    error_category VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    payload JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'NEW',
    replayed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_dlq_tenant ON automation_dead_letters(tenant_id, status);

-- ── Migration Metadata ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

INSERT INTO _migrations (name) VALUES ('001_core_tables')
ON CONFLICT (name) DO NOTHING;
