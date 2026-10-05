-- V6 capability permissions (Build Master §21–§22, §40, docs/V6_PLAN.md).
-- Generated from src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('crm.view', 'commercial', 'View customers, contacts and the sales pipeline', false),
  ('crm.manage', 'commercial', 'Manage customers, contacts and opportunities', false),
  ('commercial.view', 'commercial', 'View quotes, contracts, variations and project forecasts', true),
  ('commercial.manage', 'commercial', 'Prepare quotes, contracts, variations and forecasts', true),
  ('commercial.approve', 'commercial', 'Approve quotes and variations', true),
  ('invoice.manage', 'commercial', 'Generate, export and mark invoice candidates', true);

-- Grant the new permissions to existing companies' template roles, following
-- the V6 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v6_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v6_template_grants (template_key, permission_key) VALUES
  ('CEO', 'crm.view'),
  ('CEO', 'crm.manage'),
  ('CEO', 'commercial.view'),
  ('CEO', 'commercial.manage'),
  ('CEO', 'commercial.approve'),
  ('CEO', 'invoice.manage'),
  ('PROJECT_DIRECTOR', 'crm.view'),
  ('PROJECT_DIRECTOR', 'crm.manage'),
  ('PROJECT_DIRECTOR', 'commercial.view'),
  ('PROJECT_DIRECTOR', 'commercial.manage'),
  ('PROJECT_DIRECTOR', 'commercial.approve'),
  ('PROJECT_DIRECTOR', 'invoice.manage'),
  ('PROJECT_MANAGER', 'crm.view'),
  ('PROJECT_MANAGER', 'crm.manage'),
  ('PROJECT_MANAGER', 'commercial.view'),
  ('PROJECT_MANAGER', 'commercial.manage'),
  ('PROJECT_MANAGER', 'invoice.manage');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v6_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V6', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(g.permission_key ORDER BY g.permission_key) AS keys
           FROM roles r JOIN v6_template_grants g ON g.template_key = r.template_key
           WHERE r.company_id = c.id GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261005120200_v6_permissions')
FROM companies c;

