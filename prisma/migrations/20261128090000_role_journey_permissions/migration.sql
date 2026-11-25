-- Role journeys (owner request 2026-11-26): permission changes found by the
-- role-by-role walkthrough. Owner chose "fix everything directly".
--   * team.manage (new): site managers can put teams together without
--     employee.manage (ADR 0029).
--   * assistant.use (new): the voice/text assistant (ADR 0031) without the AI
--     project controller, for employees, supervisors, HSE and the lifting
--     supervisor. The assistant only proposes actions that a person confirms;
--     the monthly AI cap still applies.
--   * HR_ADMIN gets timesheet.export: payroll export (no rates in the file).

INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('team.manage', 'workforce', 'Create teams, choose the leader and change team members', false),
  ('assistant.use', 'ai', 'Use the voice/text assistant: it proposes actions that the user confirms (names go to the AI provider, never identity codes or rates)', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN (VALUES
  ('CEO', 'team.manage'),
  ('SITE_MANAGER', 'team.manage'),
  ('HR_ADMIN', 'team.manage'),
  ('HR_ADMIN', 'timesheet.export'),
  ('CEO', 'assistant.use'),
  ('EMPLOYEE', 'assistant.use'),
  ('SUPERVISOR', 'assistant.use'),
  ('HSE', 'assistant.use'),
  ('LIFTING_SUPERVISOR', 'assistant.use')
) AS g(template_key, permission_key) ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'role-journeys', 'granted', jsonb_build_object(
         'CEO', jsonb_build_array('team.manage', 'assistant.use'),
         'SITE_MANAGER', jsonb_build_array('team.manage'),
         'HR_ADMIN', jsonb_build_array('team.manage', 'timesheet.export'),
         'EMPLOYEE', jsonb_build_array('assistant.use'),
         'SUPERVISOR', jsonb_build_array('assistant.use'),
         'HSE', jsonb_build_array('assistant.use'),
         'LIFTING_SUPERVISOR', jsonb_build_array('assistant.use'))),
       jsonb_build_object('migration', '20261128090000_role_journey_permissions')
FROM companies c;
