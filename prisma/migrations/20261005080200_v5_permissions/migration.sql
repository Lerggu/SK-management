-- V5 capability permissions and the Lifting Supervisor role template
-- (Build Master §13–§14, §39, docs/V5_PLAN.md). Generated from
-- src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('lift.request', 'lifting', 'Create lift plans and edit drafts for own lifts', false),
  ('lift.plan.manage', 'lifting', 'Edit and submit lift plans, manage lifting accessories, record lift completion', false),
  ('lift.plan.approve', 'lifting', 'Approve or reject lift plans (person responsible for lifting)', false),
  ('material.view', 'material', 'View material batches, cable drums and QR labels', false),
  ('material.manage', 'material', 'Register and move material batches, cable drums and record cable pulls', false);

-- Grant the new permissions to existing companies' template roles, following
-- the V5 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v5_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v5_template_grants (template_key, permission_key) VALUES
  ('CEO', 'lift.request'),
  ('CEO', 'lift.plan.manage'),
  ('CEO', 'lift.plan.approve'),
  ('CEO', 'material.view'),
  ('CEO', 'material.manage'),
  ('PROJECT_DIRECTOR', 'lift.request'),
  ('PROJECT_DIRECTOR', 'lift.plan.manage'),
  ('PROJECT_DIRECTOR', 'lift.plan.approve'),
  ('PROJECT_DIRECTOR', 'material.view'),
  ('PROJECT_DIRECTOR', 'material.manage'),
  ('PROJECT_MANAGER', 'lift.request'),
  ('PROJECT_MANAGER', 'material.view'),
  ('SITE_MANAGER', 'lift.request'),
  ('SITE_MANAGER', 'lift.plan.manage'),
  ('SITE_MANAGER', 'material.view'),
  ('SITE_MANAGER', 'material.manage'),
  ('SUPERVISOR', 'lift.request'),
  ('SUPERVISOR', 'material.view'),
  ('SUPERVISOR', 'material.manage'),
  ('LOGISTICS_COORDINATOR', 'lift.request'),
  ('LOGISTICS_COORDINATOR', 'lift.plan.manage'),
  ('LOGISTICS_COORDINATOR', 'material.view'),
  ('LOGISTICS_COORDINATOR', 'material.manage'),
  ('HSE', 'material.view'),
  ('EMPLOYEE', 'material.view');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v5_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Owner decision 1: the person responsible for lifting approves lift plans.
-- Every existing company gets the new LIFTING_SUPERVISOR system role (named
-- in the company's default locale) with its template permissions.
INSERT INTO roles (id, company_id, key, template_key, name, project_access, is_system, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'LIFTING_SUPERVISOR', 'LIFTING_SUPERVISOR',
       CASE WHEN c.default_locale = 'en' THEN 'Lifting Supervisor' ELSE 'Nostovastaava' END,
       'ASSIGNED', true, now(), now()
FROM companies c
ON CONFLICT (company_id, key) DO NOTHING;

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, p.key, now()
FROM roles r
CROSS JOIN (VALUES ('project.view'), ('employee.view'), ('equipment.view'), ('documents.view'), ('timesheet.submit'), ('diary.view'), ('takt.view'), ('logistics.view'), ('logistics.request'), ('lift.request'), ('lift.plan.manage'), ('lift.plan.approve'), ('material.view')) AS p(key)
WHERE r.template_key = 'LIFTING_SUPERVISOR'
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V5', 'createdRole', 'LIFTING_SUPERVISOR', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(rp.permission_key ORDER BY rp.permission_key) AS keys
           FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
           WHERE r.company_id = c.id
             AND (rp.permission_key LIKE 'lift.%' OR rp.permission_key LIKE 'material.%' OR r.template_key = 'LIFTING_SUPERVISOR')
           GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261005080200_v5_permissions')
FROM companies c;
