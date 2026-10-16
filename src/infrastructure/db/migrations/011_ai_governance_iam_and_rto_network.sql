-- 011: platform AI governance, enterprise zero-trust IAM and cross-tenant RTO fraud prevention network.
--
-- 1. AI Gateway & HITL Handover:
--    - agent_hitl_escalations: fast triage by tenant, status, priority, and SLA countdown
--    - agent_execution_traces: fast retrieval of recent traces and adversarial prompt injection events
--    - tenant_ai_guard_settings: fast lookup of tenant token budget ceilings
--
-- 2. Enterprise Zero-Trust IAM & Support Forensics:
--    - impersonation_sessions: indexing by tenant, status, operator, and TTL expiration
--    - platform_audit_logs: indexing by timestamp, operator action, and target workspace
--
-- 3. Cross-Tenant RTO & Courier Fraud Prevention Network:
--    - network_delivery_reputations: O(1) blinded phone hash lookup across tenants
--    - order_rto_evaluations: fast lookup by tenant and order
--    - courier_disputes: fast tracking of carrier phantom-attempt disputes
--
-- Forward-only. Rollback:
--   DROP INDEX IF EXISTS commerceos.documents_hitl_escalations_status_idx;
--   DROP INDEX IF EXISTS commerceos.documents_hitl_escalations_conversation_idx;
--   DROP INDEX IF EXISTS commerceos.documents_hitl_escalations_sla_due_idx;
--   DROP INDEX IF EXISTS commerceos.documents_agent_traces_tenant_time_idx;
--   DROP INDEX IF EXISTS commerceos.documents_agent_traces_injection_idx;
--   DROP INDEX IF EXISTS commerceos.documents_tenant_ai_guard_settings_idx;
--   DROP INDEX IF EXISTS commerceos.impersonation_sessions_tenant_status_idx;
--   DROP INDEX IF EXISTS commerceos.impersonation_sessions_operator_expires_idx;
--   DROP INDEX IF EXISTS commerceos.documents_platform_audit_actor_action_idx;
--   DROP INDEX IF EXISTS commerceos.documents_rto_reputation_phone_hash_idx;
--   DROP INDEX IF EXISTS commerceos.documents_rto_evaluations_order_idx;
--   DROP INDEX IF EXISTS commerceos.documents_courier_disputes_idx;

-- ── 1. AI Gateway & HITL Escalation Queue ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS documents_hitl_escalations_status_idx
    ON commerceos.documents (tenant_id, (data->>'status'), (data->>'priority'))
    WHERE collection = 'agent_hitl_escalations';

CREATE INDEX IF NOT EXISTS documents_hitl_escalations_conversation_idx
    ON commerceos.documents (tenant_id, (data->>'conversation_id'))
    WHERE collection = 'agent_hitl_escalations';

CREATE INDEX IF NOT EXISTS documents_hitl_escalations_sla_due_idx
    ON commerceos.documents ((data->>'sla_due_at'))
    WHERE collection = 'agent_hitl_escalations';

CREATE INDEX IF NOT EXISTS documents_agent_traces_tenant_time_idx
    ON commerceos.documents (tenant_id, (data->>'timestamp') DESC)
    WHERE collection = 'agent_execution_traces';

CREATE INDEX IF NOT EXISTS documents_agent_traces_injection_idx
    ON commerceos.documents ((data->>'timestamp') DESC)
    WHERE collection = 'agent_execution_traces' 
      AND (data->'safety_flags'->>'prompt_injection_blocked') = 'true';

CREATE INDEX IF NOT EXISTS documents_tenant_ai_guard_settings_idx
    ON commerceos.documents (tenant_id)
    WHERE collection = 'tenant_ai_guard_settings';

-- ── 2. Enterprise Zero-Trust IAM & Forensics ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS impersonation_sessions_tenant_status_idx
    ON commerceos.impersonation_sessions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_operator_expires_idx
    ON commerceos.impersonation_sessions ((data->>'operator_id'), (data->>'expires_at'));

CREATE INDEX IF NOT EXISTS documents_platform_audit_actor_action_idx
    ON commerceos.documents ((data->>'created_at') DESC, (data->>'action'), (data->>'target_tenant_id'))
    WHERE collection = 'platform_audit_logs';

-- ── 3. Cross-Tenant RTO & Courier Fraud Prevention Network ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS documents_rto_reputation_phone_hash_idx
    ON commerceos.documents ((data->>'phone_hash'))
    WHERE collection = 'network_delivery_reputations';

CREATE INDEX IF NOT EXISTS documents_rto_evaluations_order_idx
    ON commerceos.documents (tenant_id, (data->>'order_id'))
    WHERE collection = 'order_rto_evaluations';

CREATE INDEX IF NOT EXISTS documents_courier_disputes_idx
    ON commerceos.documents (tenant_id, (data->>'courier_provider'), (data->>'status'))
    WHERE collection = 'courier_disputes';
