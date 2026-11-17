-- Production control, phase 1: logistics task types and their resource
-- needs, task type on logistics requests, and bookings that staff a task's
-- need (docs/adr/0026-production-control.md). Generated from
-- prisma/schema.prisma; the integrity rules and row-level security below
-- are hand-written. No new permissions: task types are managed with
-- logistics.approve and staffed with booking.manage.

-- CreateEnum
CREATE TYPE "TaskResourceKind" AS ENUM ('PERSON', 'EQUIPMENT');

-- AlterTable
ALTER TABLE "logistics_requests" ADD COLUMN     "task_type_id" UUID;

-- AlterTable
ALTER TABLE "resource_bookings" ADD COLUMN     "logistics_request_id" UUID,
ADD COLUMN     "task_role_id" UUID;

-- CreateTable
CREATE TABLE "logistics_task_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "service_type" "LogisticsServiceType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "logistics_task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_task_roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_type_id" UUID NOT NULL,
    "kind" "TaskResourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "qualification_type_id" UUID,
    "area_id" UUID,
    "min_level" SMALLINT,
    "trade" TEXT,
    "equipment_type_id" UUID,
    "min_weight_kg" DECIMAL(10,1),
    "max_weight_kg" DECIMAL(10,1),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "logistics_task_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_task_types_company_id_id_key" ON "logistics_task_types"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_task_types_company_id_name_key" ON "logistics_task_types"("company_id", "name");

-- CreateIndex
CREATE INDEX "logistics_task_roles_company_id_task_type_id_idx" ON "logistics_task_roles"("company_id", "task_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_task_roles_company_id_id_key" ON "logistics_task_roles"("company_id", "id");

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_logistics_request_id_fkey" FOREIGN KEY ("company_id", "logistics_request_id") REFERENCES "logistics_requests"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_task_role_id_fkey" FOREIGN KEY ("company_id", "task_role_id") REFERENCES "logistics_task_roles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_requests" ADD CONSTRAINT "logistics_requests_company_id_task_type_id_fkey" FOREIGN KEY ("company_id", "task_type_id") REFERENCES "logistics_task_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_task_types" ADD CONSTRAINT "logistics_task_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_task_roles" ADD CONSTRAINT "logistics_task_roles_company_id_task_type_id_fkey" FOREIGN KEY ("company_id", "task_type_id") REFERENCES "logistics_task_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_task_roles" ADD CONSTRAINT "logistics_task_roles_company_id_qualification_type_id_fkey" FOREIGN KEY ("company_id", "qualification_type_id") REFERENCES "qualification_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_task_roles" ADD CONSTRAINT "logistics_task_roles_company_id_area_id_fkey" FOREIGN KEY ("company_id", "area_id") REFERENCES "competence_areas"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_task_roles" ADD CONSTRAINT "logistics_task_roles_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE logistics_task_types
  ADD CONSTRAINT logistics_task_types_color CHECK (color IN ('slate', 'sky', 'amber', 'emerald', 'violet', 'rose', 'orange', 'teal'));

ALTER TABLE logistics_task_roles
  ADD CONSTRAINT logistics_task_roles_quantity CHECK (quantity BETWEEN 1 AND 20),
  ADD CONSTRAINT logistics_task_roles_shape CHECK (
    (kind = 'PERSON' AND equipment_type_id IS NULL)
    OR (kind = 'EQUIPMENT' AND equipment_type_id IS NOT NULL AND qualification_type_id IS NULL AND area_id IS NULL AND trade IS NULL)
  ),
  ADD CONSTRAINT logistics_task_roles_level CHECK ((area_id IS NULL AND min_level IS NULL) OR (area_id IS NOT NULL AND min_level BETWEEN 1 AND 4)),
  ADD CONSTRAINT logistics_task_roles_weight CHECK (min_weight_kg IS NULL OR max_weight_kg IS NULL OR min_weight_kg <= max_weight_kg);

ALTER TABLE resource_bookings
  ADD CONSTRAINT resource_bookings_task_role_needs_request CHECK (task_role_id IS NULL OR logistics_request_id IS NOT NULL);

-- ── Row-level security (ADR 0022): same tenant policy as every company table.
GRANT SELECT, INSERT, UPDATE, DELETE ON logistics_task_types, logistics_task_roles TO sk_app;

ALTER TABLE logistics_task_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON logistics_task_types
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

ALTER TABLE logistics_task_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON logistics_task_roles
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
