-- CreateEnum
CREATE TYPE "AccessoryKind" AS ENUM ('SLING', 'CHAIN', 'SHACKLE', 'HOOK', 'SPREADER_BEAM', 'LIFTING_CLAMP', 'OTHER');

-- CreateEnum
CREATE TYPE "LiftPlanStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiftPlanVersionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('RECEIVED', 'STORED', 'AT_WORKFACE', 'INSTALLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "CableDrumStatus" AS ENUM ('IN_STOCK', 'IN_USE', 'EMPTY', 'RETURNED');

-- AlterTable
ALTER TABLE "resource_bookings" ADD COLUMN     "lift_plan_id" UUID;

-- CreateTable
CREATE TABLE "lifting_accessories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccessoryKind" NOT NULL,
    "wll_kg" DECIMAL(10,1) NOT NULL,
    "manufacturer" TEXT,
    "serial_number" TEXT,
    "next_inspection_date" DATE,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "lifting_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lift_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "request_id" UUID,
    "activity_id" UUID,
    "title" TEXT NOT NULL,
    "planned_start" TIMESTAMPTZ(6) NOT NULL,
    "planned_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "LiftPlanStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMPTZ(6),
    "completed_by" UUID,
    "completion_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "lift_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lift_plan_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "LiftPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "load_description" TEXT,
    "load_weight_kg" DECIMAL(10,1),
    "rigging_weight_kg" DECIMAL(10,1),
    "cog_notes" TEXT,
    "crane_id" UUID,
    "radius_m" DECIMAL(6,2),
    "crane_capacity_kg" DECIMAL(10,1),
    "area_description" TEXT,
    "safety_distance_m" DECIMAL(6,2),
    "risk_document_id" UUID,
    "change_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "lift_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lift_plan_accessories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "lift_plan_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'RECEIVED',
    "delivery_id" UUID,
    "activity_id" UUID,
    "location_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "from_status" "MaterialStatus",
    "to_status" "MaterialStatus" NOT NULL,
    "location_id" UUID,
    "activity_id" UUID,
    "note" TEXT,
    "moved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moved_by" UUID,

    CONSTRAINT "material_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cable_drums" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "manufacturer" TEXT,
    "cable_type" TEXT NOT NULL,
    "original_length_m" DECIMAL(10,1) NOT NULL,
    "remaining_m" DECIMAL(10,1) NOT NULL,
    "weight_kg" DECIMAL(10,1),
    "dimensions" TEXT,
    "status" "CableDrumStatus" NOT NULL DEFAULT 'IN_STOCK',
    "location_id" UUID,
    "reserved_activity_id" UUID,
    "delivery_id" UUID,
    "received_date" DATE,
    "next_inspection_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "cable_drums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cable_pulls" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "drum_id" UUID NOT NULL,
    "activity_id" UUID,
    "length_m" DECIMAL(10,1) NOT NULL,
    "pulled_on" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cable_pulls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lifting_accessories_company_id_id_key" ON "lifting_accessories"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lifting_accessories_company_id_code_key" ON "lifting_accessories"("company_id", "code");

-- CreateIndex
CREATE INDEX "lift_plans_company_id_site_id_planned_start_idx" ON "lift_plans"("company_id", "site_id", "planned_start");

-- CreateIndex
CREATE UNIQUE INDEX "lift_plans_company_id_id_key" ON "lift_plans"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lift_plan_versions_company_id_id_key" ON "lift_plan_versions"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lift_plan_versions_plan_id_version_number_key" ON "lift_plan_versions"("plan_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "lift_plan_accessories_version_id_accessory_id_key" ON "lift_plan_accessories"("version_id", "accessory_id");

-- CreateIndex
CREATE INDEX "material_batches_company_id_site_id_status_idx" ON "material_batches"("company_id", "site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_batches_company_id_id_key" ON "material_batches"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "material_batches_company_id_site_id_id_key" ON "material_batches"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "material_batches_company_id_code_key" ON "material_batches"("company_id", "code");

-- CreateIndex
CREATE INDEX "material_movements_company_id_batch_id_moved_at_idx" ON "material_movements"("company_id", "batch_id", "moved_at");

-- CreateIndex
CREATE INDEX "cable_drums_company_id_site_id_status_idx" ON "cable_drums"("company_id", "site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cable_drums_company_id_id_key" ON "cable_drums"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cable_drums_company_id_site_id_id_key" ON "cable_drums"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cable_drums_company_id_code_key" ON "cable_drums"("company_id", "code");

-- CreateIndex
CREATE INDEX "cable_pulls_company_id_drum_id_pulled_on_idx" ON "cable_pulls"("company_id", "drum_id", "pulled_on");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_company_id_site_id_id_key" ON "deliveries"("company_id", "site_id", "id");

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_lift_plan_id_fkey" FOREIGN KEY ("company_id", "lift_plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifting_accessories" ADD CONSTRAINT "lifting_accessories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_company_id_site_id_request_id_fkey" FOREIGN KEY ("company_id", "site_id", "request_id") REFERENCES "logistics_requests"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plans" ADD CONSTRAINT "lift_plans_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plan_versions" ADD CONSTRAINT "lift_plan_versions_company_id_plan_id_fkey" FOREIGN KEY ("company_id", "plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plan_versions" ADD CONSTRAINT "lift_plan_versions_company_id_crane_id_fkey" FOREIGN KEY ("company_id", "crane_id") REFERENCES "equipment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plan_versions" ADD CONSTRAINT "lift_plan_versions_company_id_risk_document_id_fkey" FOREIGN KEY ("company_id", "risk_document_id") REFERENCES "documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plan_accessories" ADD CONSTRAINT "lift_plan_accessories_company_id_version_id_fkey" FOREIGN KEY ("company_id", "version_id") REFERENCES "lift_plan_versions"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lift_plan_accessories" ADD CONSTRAINT "lift_plan_accessories_company_id_accessory_id_fkey" FOREIGN KEY ("company_id", "accessory_id") REFERENCES "lifting_accessories"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_batches" ADD CONSTRAINT "material_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_batches" ADD CONSTRAINT "material_batches_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_batches" ADD CONSTRAINT "material_batches_company_id_site_id_delivery_id_fkey" FOREIGN KEY ("company_id", "site_id", "delivery_id") REFERENCES "deliveries"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_batches" ADD CONSTRAINT "material_batches_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_batches" ADD CONSTRAINT "material_batches_company_id_site_id_location_id_fkey" FOREIGN KEY ("company_id", "site_id", "location_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_company_id_site_id_batch_id_fkey" FOREIGN KEY ("company_id", "site_id", "batch_id") REFERENCES "material_batches"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_company_id_site_id_location_id_fkey" FOREIGN KEY ("company_id", "site_id", "location_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_drums" ADD CONSTRAINT "cable_drums_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_drums" ADD CONSTRAINT "cable_drums_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_drums" ADD CONSTRAINT "cable_drums_company_id_site_id_location_id_fkey" FOREIGN KEY ("company_id", "site_id", "location_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_drums" ADD CONSTRAINT "cable_drums_company_id_site_id_reserved_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "reserved_activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_drums" ADD CONSTRAINT "cable_drums_company_id_site_id_delivery_id_fkey" FOREIGN KEY ("company_id", "site_id", "delivery_id") REFERENCES "deliveries"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_pulls" ADD CONSTRAINT "cable_pulls_company_id_site_id_drum_id_fkey" FOREIGN KEY ("company_id", "site_id", "drum_id") REFERENCES "cable_drums"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cable_pulls" ADD CONSTRAINT "cable_pulls_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

