-- Workforce rotation plan (docs/adr/0027-workforce-rotation.md): who is at
-- work on which site, off, on vacation, sick, in training or away for another
-- reason, per day. Generated from prisma/schema.prisma; integrity rules,
-- row-level security and permissions below are hand-written.

-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('WORK', 'OFF', 'VACATION', 'SICK', 'TRAINING', 'OTHER');

-- CreateTable
CREATE TABLE "rotation_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "status" "RotationStatus" NOT NULL,
    "project_id" UUID,
    "site_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "rotation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotation_entries_company_id_day_idx" ON "rotation_entries"("company_id", "day");

-- CreateIndex
CREATE INDEX "rotation_entries_company_id_site_id_day_idx" ON "rotation_entries"("company_id", "site_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "rotation_entries_company_id_employee_id_day_key" ON "rotation_entries"("company_id", "employee_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "rotation_entries_company_id_id_key" ON "rotation_entries"("company_id", "id");

-- AddForeignKey
ALTER TABLE "rotation_entries" ADD CONSTRAINT "rotation_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_entries" ADD CONSTRAINT "rotation_entries_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_entries" ADD CONSTRAINT "rotation_entries_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules ──────────────────────────────────────────────────
-- Only WORK names a site, and a site always comes with its project.
ALTER TABLE rotation_entries
  ADD CONSTRAINT rotation_entries_site_only_work CHECK (site_id IS NULL OR status = 'WORK'),
  ADD CONSTRAINT rotation_entries_site_project CHECK ((site_id IS NULL) = (project_id IS NULL)),
  ADD CONSTRAINT rotation_entries_note_length CHECK (note IS NULL OR char_length(note) <= 200);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON rotation_entries TO sk_app;
ALTER TABLE rotation_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rotation_entries
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ── Permissions (src/platform/authz/permissions.ts) ──────────────────
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('rotation.view', 'workforce', 'View the workforce rotation plan (absence reasons hidden)', false),
  ('rotation.manage', 'workforce', 'Plan workforce rotation and see absence reasons (sick leave is health data)', true);

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN (VALUES
  ('CEO', 'rotation.view'), ('CEO', 'rotation.manage'),
  ('PROJECT_DIRECTOR', 'rotation.view'), ('PROJECT_DIRECTOR', 'rotation.manage'),
  ('PROJECT_MANAGER', 'rotation.view'), ('PROJECT_MANAGER', 'rotation.manage'),
  ('SITE_MANAGER', 'rotation.view'), ('SITE_MANAGER', 'rotation.manage'),
  ('HR_ADMIN', 'rotation.view'), ('HR_ADMIN', 'rotation.manage'),
  ('SUPERVISOR', 'rotation.view'),
  ('LOGISTICS_COORDINATOR', 'rotation.view')
) AS g(template_key, permission_key) ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'workforce-rotation', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(rp.permission_key ORDER BY rp.permission_key) AS keys
           FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
           WHERE r.company_id = c.id AND rp.permission_key LIKE 'rotation.%'
           GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261118090000_workforce_rotation')
FROM companies c;
