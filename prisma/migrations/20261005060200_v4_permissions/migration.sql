-- V4 capability permissions (Build Master §10–§12, §38, docs/V4_PLAN.md).
-- Generated from src/platform/authz/permissions.ts; verified by
-- tests/integration/database-integrity.test.ts.

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('logistics.view', 'logistics', 'View the logistics board, deliveries, requests and bookings', false),
  ('logistics.request', 'logistics', 'Create logistics requests', false),
  ('logistics.approve', 'logistics', 'Review and approve logistics requests, manage gates and storage', false),
  ('booking.manage', 'logistics', 'Book resources and decide booking requests for own resources', false),
  ('delivery.manage', 'logistics', 'Schedule deliveries and record gate check-in and unloading', false);

-- Grant the new permissions to existing companies' template roles, following
-- the V4 role matrix. Custom (non-template) roles are not changed.
CREATE TEMP TABLE v4_template_grants (template_key text, permission_key text) ON COMMIT DROP;
INSERT INTO v4_template_grants (template_key, permission_key) VALUES
  ('CEO', 'logistics.view'),
  ('CEO', 'logistics.request'),
  ('CEO', 'logistics.approve'),
  ('CEO', 'booking.manage'),
  ('CEO', 'delivery.manage'),
  ('PROJECT_DIRECTOR', 'logistics.view'),
  ('PROJECT_DIRECTOR', 'logistics.request'),
  ('PROJECT_DIRECTOR', 'logistics.approve'),
  ('PROJECT_DIRECTOR', 'booking.manage'),
  ('PROJECT_DIRECTOR', 'delivery.manage'),
  ('PROJECT_MANAGER', 'logistics.view'),
  ('PROJECT_MANAGER', 'logistics.request'),
  ('PROJECT_MANAGER', 'booking.manage'),
  ('SITE_MANAGER', 'logistics.view'),
  ('SITE_MANAGER', 'logistics.request'),
  ('SITE_MANAGER', 'logistics.approve'),
  ('SITE_MANAGER', 'booking.manage'),
  ('SITE_MANAGER', 'delivery.manage'),
  ('SUPERVISOR', 'logistics.view'),
  ('SUPERVISOR', 'logistics.request'),
  ('SUPERVISOR', 'delivery.manage'),
  ('LOGISTICS_COORDINATOR', 'logistics.view'),
  ('LOGISTICS_COORDINATOR', 'logistics.request'),
  ('LOGISTICS_COORDINATOR', 'logistics.approve'),
  ('LOGISTICS_COORDINATOR', 'booking.manage'),
  ('LOGISTICS_COORDINATOR', 'delivery.manage'),
  ('HSE', 'logistics.view'),
  ('EMPLOYEE', 'logistics.view');

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN v4_template_grants g ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Record the change in each company's audit trail (system actor).
INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V4', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(g.permission_key ORDER BY g.permission_key) AS keys
           FROM roles r JOIN v4_template_grants g ON g.template_key = r.template_key
           WHERE r.company_id = c.id GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261005060200_v4_permissions')
FROM companies c;

