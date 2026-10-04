-- V2 capability permissions (Build Master §36, docs/V2_PLAN.md).
-- Generated from src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('timesheet.submit', 'time', 'Enter and submit own hours', false),
  ('timesheet.manage', 'time', 'Enter and submit hours for crew members', false),
  ('timesheet.approve', 'time', 'Approve or reject submitted hours', false),
  ('timesheet.export', 'time', 'Export approved hours for payroll', false),
  ('diary.view', 'diary', 'View site diaries', false),
  ('diary.manage', 'diary', 'Write site diaries', false),
  ('diary.sign', 'diary', 'Sign (finalize) site diaries', false),
  ('finance.view', 'finance', 'View project budgets, costs and margins', true),
  ('finance.manage', 'finance', 'Edit budgets and record project costs', true);

-- Grant the new permissions to existing companies' template roles, following
-- the V2 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v2_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v2_template_grants (template_key, permission_key) VALUES
  ('CEO', 'timesheet.submit'),
  ('CEO', 'timesheet.manage'),
  ('CEO', 'timesheet.approve'),
  ('CEO', 'timesheet.export'),
  ('CEO', 'diary.view'),
  ('CEO', 'diary.manage'),
  ('CEO', 'diary.sign'),
  ('CEO', 'finance.view'),
  ('CEO', 'finance.manage'),
  ('PROJECT_DIRECTOR', 'timesheet.submit'),
  ('PROJECT_DIRECTOR', 'timesheet.manage'),
  ('PROJECT_DIRECTOR', 'timesheet.approve'),
  ('PROJECT_DIRECTOR', 'timesheet.export'),
  ('PROJECT_DIRECTOR', 'diary.view'),
  ('PROJECT_DIRECTOR', 'diary.manage'),
  ('PROJECT_DIRECTOR', 'diary.sign'),
  ('PROJECT_DIRECTOR', 'finance.view'),
  ('PROJECT_DIRECTOR', 'finance.manage'),
  ('PROJECT_MANAGER', 'timesheet.submit'),
  ('PROJECT_MANAGER', 'timesheet.manage'),
  ('PROJECT_MANAGER', 'timesheet.approve'),
  ('PROJECT_MANAGER', 'diary.view'),
  ('PROJECT_MANAGER', 'diary.manage'),
  ('PROJECT_MANAGER', 'diary.sign'),
  ('PROJECT_MANAGER', 'finance.view'),
  ('PROJECT_MANAGER', 'finance.manage'),
  ('SITE_MANAGER', 'timesheet.submit'),
  ('SITE_MANAGER', 'timesheet.manage'),
  ('SITE_MANAGER', 'timesheet.approve'),
  ('SITE_MANAGER', 'diary.view'),
  ('SITE_MANAGER', 'diary.manage'),
  ('SITE_MANAGER', 'diary.sign'),
  ('SUPERVISOR', 'timesheet.submit'),
  ('SUPERVISOR', 'timesheet.manage'),
  ('SUPERVISOR', 'diary.view'),
  ('SUPERVISOR', 'diary.manage'),
  ('SUPERVISOR', 'diary.sign'),
  ('LOGISTICS_COORDINATOR', 'timesheet.submit'),
  ('LOGISTICS_COORDINATOR', 'diary.view'),
  ('HSE', 'timesheet.submit'),
  ('HSE', 'diary.view'),
  ('EMPLOYEE', 'timesheet.submit'),
  ('EMPLOYEE', 'diary.view');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v2_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V2', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(g.permission_key ORDER BY g.permission_key) AS keys
           FROM roles r JOIN v2_template_grants g ON g.template_key = r.template_key
           WHERE r.company_id = c.id GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261004193800_v2_permissions')
FROM companies c;
