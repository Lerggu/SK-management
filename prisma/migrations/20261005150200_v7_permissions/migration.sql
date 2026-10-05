-- V7 capability permissions and the Client approver role template
-- (Build Master §5, §23, §41, docs/V7_PLAN.md). Generated from
-- src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('hse.view', 'hse', 'View HSE records, actions and key figures', false),
  ('hse.create', 'hse', 'Report observations, near misses and incidents, record toolbox talks, request permits', false),
  ('hse.manage', 'hse', 'Triage HSE reports, assign actions, manage risk assessments and inspections', false),
  ('hse.investigate', 'hse', 'Investigate and close serious and lost-time incidents', false),
  ('hse.action.approve', 'hse', 'Approve corrective actions of incidents', false),
  ('hse.serious.notify', 'hse', 'Receive immediate notifications of serious incidents', false),
  ('hse.personal.view', 'hse', 'View injured-person details of incidents', true),
  ('permit.approve', 'hse', 'Approve or reject permits to work', false),
  ('portal.client', 'portal', 'Use the client portal', false),
  ('portal.subcontractor', 'portal', 'Use the subcontractor portal', false),
  ('variation.client_approve', 'portal', 'Approve or reject variations on behalf of the client', false);

-- Grant the new permissions to existing companies' template roles, following
-- the V7 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v7_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v7_template_grants (template_key, permission_key) VALUES
  ('CEO', 'hse.view'),
  ('CEO', 'hse.create'),
  ('CEO', 'hse.manage'),
  ('CEO', 'hse.investigate'),
  ('CEO', 'hse.action.approve'),
  ('CEO', 'hse.serious.notify'),
  ('CEO', 'hse.personal.view'),
  ('CEO', 'permit.approve'),
  ('PROJECT_DIRECTOR', 'hse.view'),
  ('PROJECT_DIRECTOR', 'hse.create'),
  ('PROJECT_DIRECTOR', 'hse.manage'),
  ('PROJECT_DIRECTOR', 'hse.action.approve'),
  ('PROJECT_DIRECTOR', 'hse.serious.notify'),
  ('PROJECT_DIRECTOR', 'permit.approve'),
  ('PROJECT_MANAGER', 'hse.view'),
  ('PROJECT_MANAGER', 'hse.create'),
  ('PROJECT_MANAGER', 'hse.manage'),
  ('PROJECT_MANAGER', 'hse.action.approve'),
  ('SITE_MANAGER', 'hse.view'),
  ('SITE_MANAGER', 'hse.create'),
  ('SITE_MANAGER', 'hse.manage'),
  ('SITE_MANAGER', 'permit.approve'),
  ('SUPERVISOR', 'hse.view'),
  ('SUPERVISOR', 'hse.create'),
  ('LOGISTICS_COORDINATOR', 'hse.view'),
  ('LOGISTICS_COORDINATOR', 'hse.create'),
  ('HSE', 'hse.view'),
  ('HSE', 'hse.create'),
  ('HSE', 'hse.manage'),
  ('HSE', 'hse.investigate'),
  ('HSE', 'hse.serious.notify'),
  ('HSE', 'hse.personal.view'),
  ('HSE', 'permit.approve'),
  ('EMPLOYEE', 'hse.view'),
  ('EMPLOYEE', 'hse.create'),
  ('SUBCONTRACTOR', 'hse.create'),
  ('SUBCONTRACTOR', 'portal.subcontractor'),
  ('CLIENT', 'portal.client'),
  ('LIFTING_SUPERVISOR', 'hse.view'),
  ('LIFTING_SUPERVISOR', 'hse.create');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v7_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Owner decision 2: the named client person approves variations in the portal.
-- Every existing company gets the new CLIENT_APPROVER system role (named
-- in the company's default locale) with its template permissions.
INSERT INTO roles (id, company_id, key, template_key, name, project_access, is_system, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'CLIENT_APPROVER', 'CLIENT_APPROVER',
       CASE WHEN c.default_locale = 'en' THEN 'Client approver' ELSE 'Asiakkaan hyväksyjä' END,
       'ASSIGNED', true, now(), now()
FROM companies c
ON CONFLICT (company_id, key) DO NOTHING;

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, p.key, now()
FROM roles r
CROSS JOIN (VALUES ('project.view'), ('documents.view'), ('portal.client'), ('variation.client_approve')) AS p(key)
WHERE r.template_key = 'CLIENT_APPROVER'
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V7', 'createdRole', 'CLIENT_APPROVER', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(rp.permission_key ORDER BY rp.permission_key) AS keys
           FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
           WHERE r.company_id = c.id
             AND (rp.permission_key LIKE 'hse.%' OR rp.permission_key LIKE 'permit.%' OR rp.permission_key LIKE 'portal.%' OR rp.permission_key LIKE 'variation.%' OR r.template_key = 'CLIENT_APPROVER')
           GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261005150200_v7_permissions')
FROM companies c;
