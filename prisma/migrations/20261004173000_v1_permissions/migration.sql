-- V1 capability permission catalogue. Must match src/platform/authz/permissions.ts
-- (verified by tests/integration/permissions-catalogue.test.ts). Changing
-- permissions requires a new migration — never edit applied migrations.
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('company.manage', 'company', 'Edit company settings', false),
  ('company.members.manage', 'company', 'Invite, disable and assign roles to members', false),
  ('company.roles.manage', 'company', 'Edit role permissions', false),
  ('audit.view', 'company', 'View the audit log', false),
  ('project.view', 'projects', 'View projects and sites', false),
  ('project.manage', 'projects', 'Create, edit and archive projects and sites', false),
  ('project.members.manage', 'projects', 'Assign people to projects', false),
  ('employee.view', 'workforce', 'View employees', false),
  ('employee.manage', 'workforce', 'Create, edit and archive employees', false),
  ('employee.rates.view', 'workforce', 'View employee cost and billing rates', true),
  ('employee.rates.manage', 'workforce', 'Change employee cost and billing rates', true),
  ('equipment.view', 'equipment', 'View equipment', false),
  ('equipment.manage', 'equipment', 'Create, edit and archive equipment and types', false),
  ('equipment.rates.view', 'equipment', 'View equipment cost and billing rates', true),
  ('equipment.rates.manage', 'equipment', 'Change equipment cost and billing rates', true),
  ('documents.view', 'documents', 'View documents', false),
  ('documents.manage', 'documents', 'Create documents and upload versions', false),
  ('documents.approve', 'documents', 'Approve or reject document versions', false);
