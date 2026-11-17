-- Production control phase 4 (ADR 0026): AI staffing suggestions for a
-- logistics task and §27 logistics risk analysis, on the V8 AI run log.

ALTER TYPE "AiRunKind" ADD VALUE 'STAFFING';
ALTER TYPE "AiRunKind" ADD VALUE 'LOGISTICS_RISK';

ALTER TABLE "ai_runs" ADD COLUMN "logistics_request_id" UUID;

CREATE INDEX "ai_runs_company_id_logistics_request_id_created_at_idx" ON "ai_runs"("company_id", "logistics_request_id", "created_at");

ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_company_id_logistics_request_id_fkey"
  FOREIGN KEY ("company_id", "logistics_request_id") REFERENCES "logistics_requests"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The logistics coordinator and the site manager use AI staffing suggestions
-- and risk analysis (owner request 2026-11-17). Code checks the capability,
-- never the role name; existing companies' template roles get it here.
INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, 'ai.use', now()
FROM roles r
WHERE r.template_key IN ('LOGISTICS_COORDINATOR', 'SITE_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'production-control-4', 'granted', jsonb_build_object('LOGISTICS_COORDINATOR', jsonb_build_array('ai.use'), 'SITE_MANAGER', jsonb_build_array('ai.use'))),
       jsonb_build_object('migration', '20261117150000_production_ai')
FROM companies c;
