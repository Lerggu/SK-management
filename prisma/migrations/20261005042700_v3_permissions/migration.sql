-- V3 capability permissions (Build Master §8, §37, docs/V3_PLAN.md).
-- Generated from src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('takt.view', 'takt', 'View takt plans, the takt board and the look-ahead', false),
  ('takt.manage', 'takt', 'Edit takt structure and draft plan versions, import schedules', false),
  ('takt.progress.update', 'takt', 'Record activity progress, constraints and delays', false),
  ('takt.baseline.approve', 'takt', 'Approve a proposed plan version as the baseline', false);

-- Grant the new permissions to existing companies' template roles, following
-- the V3 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v3_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v3_template_grants (template_key, permission_key) VALUES
  ('CEO', 'takt.view'),
  ('CEO', 'takt.manage'),
  ('CEO', 'takt.progress.update'),
  ('CEO', 'takt.baseline.approve'),
  ('PROJECT_DIRECTOR', 'takt.view'),
  ('PROJECT_DIRECTOR', 'takt.manage'),
  ('PROJECT_DIRECTOR', 'takt.progress.update'),
  ('PROJECT_DIRECTOR', 'takt.baseline.approve'),
  ('PROJECT_MANAGER', 'takt.view'),
  ('PROJECT_MANAGER', 'takt.manage'),
  ('PROJECT_MANAGER', 'takt.progress.update'),
  ('PROJECT_MANAGER', 'takt.baseline.approve'),
  ('SITE_MANAGER', 'takt.view'),
  ('SITE_MANAGER', 'takt.manage'),
  ('SITE_MANAGER', 'takt.progress.update'),
  ('SUPERVISOR', 'takt.view'),
  ('SUPERVISOR', 'takt.progress.update'),
  ('LOGISTICS_COORDINATOR', 'takt.view'),
  ('HSE', 'takt.view'),
  ('EMPLOYEE', 'takt.view');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v3_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V3', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(g.permission_key ORDER BY g.permission_key) AS keys
           FROM roles r JOIN v3_template_grants g ON g.template_key = r.template_key
           WHERE r.company_id = c.id GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261005042700_v3_permissions')
FROM companies c;

