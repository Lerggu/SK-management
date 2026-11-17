-- Finnish personal identity code (henkilötunnus) on the employee, encrypted
-- at the application layer (docs/adr/0028-personal-identity-code.md). The
-- database never sees the clear value: only AES-256-GCM ciphertext and a
-- keyed HMAC for uniqueness within the company.

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "personal_id_enc" TEXT,
ADD COLUMN     "personal_id_hash" CHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_personal_id_hash_key" ON "employees"("company_id", "personal_id_hash");

-- Ciphertext and hash come together, and the ciphertext has the v1 envelope.
ALTER TABLE employees
  ADD CONSTRAINT employees_personal_id_pair CHECK ((personal_id_enc IS NULL) = (personal_id_hash IS NULL)),
  ADD CONSTRAINT employees_personal_id_format CHECK (personal_id_enc IS NULL OR personal_id_enc LIKE 'v1:%');

-- ── Permission (src/platform/authz/permissions.ts) ───────────────────
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('employee.pid.manage', 'workforce', 'View and edit employees'' personal identity codes (henkilötunnus)', true);

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, 'employee.pid.manage', now()
FROM roles r
WHERE r.template_key IN ('CEO', 'HR_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'personal-id', 'granted', jsonb_build_object('CEO', jsonb_build_array('employee.pid.manage'), 'HR_ADMIN', jsonb_build_array('employee.pid.manage'))),
       jsonb_build_object('migration', '20261118120000_employee_personal_id')
FROM companies c;
