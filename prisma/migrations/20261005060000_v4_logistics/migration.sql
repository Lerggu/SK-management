-- CreateEnum
CREATE TYPE "BookingResourceKind" AS ENUM ('EMPLOYEE', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogisticsLocationKind" AS ENUM ('GATE', 'UNLOADING', 'STORAGE');

-- CreateEnum
CREATE TYPE "LogisticsServiceType" AS ENUM ('DELIVERY', 'LIFT', 'INTERNAL_MOVE', 'WASTE_REMOVAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LogisticsPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LogisticsRequestStatus" AS ENUM ('DRAFT', 'REQUESTED', 'REVIEW', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'ARRIVED_GATE', 'CHECKED_IN', 'UNLOADING', 'STORED', 'MOVED_TO_WORKFACE', 'INSTALLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "shareable_in_group" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "shareable_in_group" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "resource_bookings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_company_id" UUID NOT NULL,
    "resource_kind" "BookingResourceKind" NOT NULL,
    "employee_id" UUID,
    "equipment_id" UUID,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "activity_id" UUID,
    "requirement_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "conflicts_accepted" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "resource_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_locations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "LogisticsLocationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "opens_minute" INTEGER,
    "closes_minute" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "logistics_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "activity_id" UUID,
    "service_type" "LogisticsServiceType" NOT NULL,
    "title" TEXT NOT NULL,
    "requested_start" TIMESTAMPTZ(6) NOT NULL,
    "requested_end" TIMESTAMPTZ(6) NOT NULL,
    "load_description" TEXT,
    "weight_kg" DECIMAL(10,1),
    "dimensions" TEXT,
    "pickup" TEXT,
    "destination" TEXT,
    "equipment_type_id" UUID,
    "priority" "LogisticsPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "LogisticsRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "decision_note" TEXT,
    "requested_at" TIMESTAMPTZ(6),
    "requested_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "logistics_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "unloading_id" UUID,
    "storage_id" UUID,
    "request_id" UUID,
    "activity_id" UUID,
    "constraint_id" UUID,
    "supplier" TEXT NOT NULL,
    "carrier" TEXT,
    "vehicle" TEXT,
    "material" TEXT NOT NULL,
    "quantity" TEXT,
    "weight_kg" DECIMAL(10,1),
    "slot_start" TIMESTAMPTZ(6) NOT NULL,
    "slot_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PLANNED',
    "arrived_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_bookings_company_id_project_id_starts_at_idx" ON "resource_bookings"("company_id", "project_id", "starts_at");

-- CreateIndex
CREATE INDEX "resource_bookings_owner_company_id_starts_at_idx" ON "resource_bookings"("owner_company_id", "starts_at");

-- CreateIndex
CREATE INDEX "resource_bookings_employee_id_starts_at_idx" ON "resource_bookings"("employee_id", "starts_at");

-- CreateIndex
CREATE INDEX "resource_bookings_equipment_id_starts_at_idx" ON "resource_bookings"("equipment_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_bookings_company_id_id_key" ON "resource_bookings"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_locations_company_id_id_key" ON "logistics_locations"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_locations_company_id_site_id_id_key" ON "logistics_locations"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_locations_site_id_kind_name_key" ON "logistics_locations"("site_id", "kind", "name");

-- CreateIndex
CREATE INDEX "logistics_requests_company_id_site_id_status_requested_star_idx" ON "logistics_requests"("company_id", "site_id", "status", "requested_start");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_requests_company_id_id_key" ON "logistics_requests"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_requests_company_id_site_id_id_key" ON "logistics_requests"("company_id", "site_id", "id");

-- CreateIndex
CREATE INDEX "deliveries_company_id_site_id_slot_start_idx" ON "deliveries"("company_id", "site_id", "slot_start");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_company_id_id_key" ON "deliveries"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_activities_company_id_site_id_id_key" ON "takt_activities"("company_id", "site_id", "id");

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_owner_company_id_fkey" FOREIGN KEY ("owner_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_owner_company_id_employee_id_fkey" FOREIGN KEY ("owner_company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_owner_company_id_equipment_id_fkey" FOREIGN KEY ("owner_company_id", "equipment_id") REFERENCES "equipment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_activity_id_fkey" FOREIGN KEY ("company_id", "activity_id") REFERENCES "takt_activities"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_company_id_requirement_id_fkey" FOREIGN KEY ("company_id", "requirement_id") REFERENCES "resource_requirements"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_locations" ADD CONSTRAINT "logistics_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_locations" ADD CONSTRAINT "logistics_locations_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_requests" ADD CONSTRAINT "logistics_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_requests" ADD CONSTRAINT "logistics_requests_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_requests" ADD CONSTRAINT "logistics_requests_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_requests" ADD CONSTRAINT "logistics_requests_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_site_id_gate_id_fkey" FOREIGN KEY ("company_id", "site_id", "gate_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_site_id_unloading_id_fkey" FOREIGN KEY ("company_id", "site_id", "unloading_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_site_id_storage_id_fkey" FOREIGN KEY ("company_id", "site_id", "storage_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_site_id_request_id_fkey" FOREIGN KEY ("company_id", "site_id", "request_id") REFERENCES "logistics_requests"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_site_id_activity_id_fkey" FOREIGN KEY ("company_id", "site_id", "activity_id") REFERENCES "takt_activities"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_constraint_id_fkey" FOREIGN KEY ("company_id", "constraint_id") REFERENCES "activity_constraints"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

