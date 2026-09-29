-- ============================================================
-- CommerceOS Migration 002: Extended Domain Tables
-- Operations, Enterprise, Growth, Intelligence, Autonomous
-- ============================================================

-- ── Operations: Suppliers & Procurement ───────────────────────

CREATE TABLE IF NOT EXISTS suppliers (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    lead_time_days INT DEFAULT 3,
    minimum_order_value_bdt NUMERIC(12, 2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    rating NUMERIC(3, 2) DEFAULT 5.0,
    payment_terms VARCHAR(50) DEFAULT 'NET_30',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id, status);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    po_number VARCHAR(100) NOT NULL,
    supplier_id VARCHAR(100) NOT NULL,
    supplier_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'DRAFT',
    items JSONB NOT NULL DEFAULT '[]',
    total_amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'BDT',
    expected_delivery_date TIMESTAMPTZ,
    approved_by VARCHAR(100),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id, status);

-- ── Operations: Exceptions & SLA ─────────────────────────────

CREATE TABLE IF NOT EXISTS operational_exceptions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    exception_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'DETECTED',
    assigned_agent VARCHAR(100),
    proposed_resolution TEXT,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_exceptions_tenant ON operational_exceptions(tenant_id, domain, severity, status);

CREATE TABLE IF NOT EXISTS provider_health (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    provider_name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'HEALTHY',
    health_score NUMERIC(5, 2) DEFAULT 100,
    consecutive_failures INT DEFAULT 0,
    failure_threshold INT DEFAULT 5,
    circuit_breaker_tripped_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_provider_health ON provider_health(tenant_id, provider_type);

CREATE TABLE IF NOT EXISTS autonomy_budgets (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL UNIQUE,
    daily_max_spend_bdt NUMERIC(12, 2) DEFAULT 50000,
    daily_spent_bdt NUMERIC(12, 2) DEFAULT 0,
    daily_max_actions INT DEFAULT 100,
    daily_actions_count INT DEFAULT 0,
    max_single_action_bdt NUMERIC(12, 2) DEFAULT 15000,
    kill_switch_active BOOLEAN DEFAULT false,
    kill_switch_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- ── Intelligence: Metrics & Analytics ─────────────────────────

CREATE TABLE IF NOT EXISTS metric_definitions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    key VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    formula TEXT,
    unit VARCHAR(50),
    direction VARCHAR(20) DEFAULT 'HIGHER_IS_BETTER',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    metric_key VARCHAR(100) NOT NULL,
    value NUMERIC(16, 4) NOT NULL,
    previous_value NUMERIC(16, 4),
    change_pct NUMERIC(8, 2),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    granularity VARCHAR(20) DEFAULT 'DAILY',
    dimensions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots ON metric_snapshots(tenant_id, metric_key, period_start DESC);

CREATE TABLE IF NOT EXISTS insights (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'INFO',
    status VARCHAR(50) DEFAULT 'NEW',
    evidence JSONB DEFAULT '{}',
    recommendation TEXT,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_insights_tenant ON insights(tenant_id, status, created_at DESC);

-- ── Growth: Audiences & Campaigns ─────────────────────────────

CREATE TABLE IF NOT EXISTS audiences (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    rules JSONB DEFAULT '[]',
    member_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audiences_tenant ON audiences(tenant_id, status);

CREATE TABLE IF NOT EXISTS growth_campaigns (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'DRAFT',
    audience_id VARCHAR(100),
    channel VARCHAR(50),
    content JSONB DEFAULT '{}',
    schedule JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    sent_count INT DEFAULT 0,
    opened_count INT DEFAULT 0,
    clicked_count INT DEFAULT 0,
    converted_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON growth_campaigns(tenant_id, status);

CREATE TABLE IF NOT EXISTS customer_lifecycles (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    stage VARCHAR(50) NOT NULL,
    previous_stage VARCHAR(50),
    score NUMERIC(5, 2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    transitioned_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_lifecycles_tenant ON customer_lifecycles(tenant_id, customer_id);

-- ── Enterprise: Hierarchy & Integration ───────────────────────

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS enterprise_stores (
    id VARCHAR(100) PRIMARY KEY,
    organization_id VARCHAR(100) NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS integration_installations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    provider_id VARCHAR(100) NOT NULL,
    provider_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    credentials_encrypted TEXT,
    configuration JSONB DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integration_installations(tenant_id, status);

-- ── Autonomous Platform ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_objectives (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    target_metric VARCHAR(100),
    target_value NUMERIC(16, 4),
    current_value NUMERIC(16, 4),
    priority INT DEFAULT 5,
    deadline TIMESTAMPTZ,
    strategies JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_objectives_tenant ON business_objectives(tenant_id, status);

CREATE TABLE IF NOT EXISTS global_decisions (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'PROPOSED',
    options JSONB DEFAULT '[]',
    selected_option JSONB,
    impact_analysis JSONB DEFAULT '{}',
    requires_approval BOOLEAN DEFAULT true,
    approved_by VARCHAR(100),
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_decisions_tenant ON global_decisions(tenant_id, status);

CREATE TABLE IF NOT EXISTS platform_health_records (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    overall_score NUMERIC(5, 2) DEFAULT 100,
    dimensions JSONB DEFAULT '{}',
    anomalies JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    assessed_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- ── Connector Configurations ──────────────────────────────────

CREATE TABLE IF NOT EXISTS connector_configurations (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    provider_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'DRAFT',
    config JSONB DEFAULT '{}',
    credentials_encrypted TEXT,
    last_sync_at TIMESTAMPTZ,
    sync_status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connector_configurations(tenant_id);

-- ── Extended Collections (stored as JSONB for flexibility) ────
-- These tables aggregate less-structured data from phases 5-10

CREATE TABLE IF NOT EXISTS domain_records (
    id VARCHAR(100) PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    record_type VARCHAR(100) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_domain_records ON domain_records(tenant_id, domain, record_type, created_at DESC);

INSERT INTO _migrations (name) VALUES ('002_extended_tables')
ON CONFLICT (name) DO NOTHING;
