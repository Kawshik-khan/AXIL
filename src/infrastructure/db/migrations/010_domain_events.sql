-- 010: domain-event outbox and scheduled job runs (FX-99 Part B, ADR-112 addendum). Both are store collections kept as
-- JSONB documents in commerceos.documents (domain_events per workspace, job_runs platform-scope), so they need no
-- table; these partial indexes keep the dispatcher's "due rows" scan and the monitoring counts cheap as rows pile up.
--
-- Forward-only. Rollback:
--   DROP INDEX IF EXISTS commerceos.documents_domain_events_due_idx;
--   DROP INDEX IF EXISTS commerceos.documents_job_runs_job_idx;

CREATE INDEX IF NOT EXISTS documents_domain_events_due_idx
    ON commerceos.documents ((data->>'status'), (data->>'next_attempt_at'))
    WHERE collection = 'domain_events';
CREATE INDEX IF NOT EXISTS documents_job_runs_job_idx
    ON commerceos.documents ((data->>'job'), (data->>'bucket'))
    WHERE collection = 'job_runs';
