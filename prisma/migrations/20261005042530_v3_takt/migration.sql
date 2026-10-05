-- CreateEnum
CREATE TYPE "BuildingKind" AS ENUM ('BUILDING', 'AREA');

-- CreateEnum
CREATE TYPE "TaktPlanVersionStatus" AS ENUM ('DRAFT', 'PROPOSED', 'BASELINE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ActivityExecution" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateEnum
CREATE TYPE "ConstraintType" AS ENUM ('DRAWINGS', 'MATERIAL', 'WORKFORCE', 'EQUIPMENT', 'PERMIT', 'AREA', 'OTHER');

-- CreateEnum
CREATE TYPE "ConstraintStatus" AS ENUM ('OPEN', 'CLEARED');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('TRADE', 'EQUIPMENT_TYPE');

-- CreateEnum
CREATE TYPE "ScheduleImportFormat" AS ENUM ('MSPDI', 'XER');

-- CreateEnum
CREATE TYPE "ScheduleImportStatus" AS ENUM ('PREVIEW', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "work_calendars" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "working_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_holidays" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "calendar_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "kind" "BuildingKind" NOT NULL DEFAULT 'BUILDING',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takt_areas" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "takt_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_packages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "color" TEXT NOT NULL DEFAULT '#1E88A8',
    "default_crew_size" INTEGER NOT NULL DEFAULT 2,
    "default_duration_cycles" INTEGER NOT NULL DEFAULT 1,
    "equipment_type_id" UUID,
    "equipment_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takt_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cycle_length_days" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "takt_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takt_plan_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "TaktPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "reason" TEXT,
    "based_on_id" UUID,
    "proposed_at" TIMESTAMPTZ(6),
    "proposed_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "superseded_at" TIMESTAMPTZ(6),
    "returned_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "takt_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takt_activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "takt_area_id" UUID NOT NULL,
    "work_package_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "crew_trade" TEXT,
    "crew_size" INTEGER NOT NULL DEFAULT 0,
    "equipment_type_id" UUID,
    "equipment_count" INTEGER NOT NULL DEFAULT 0,
    "execution" "ActivityExecution" NOT NULL DEFAULT 'NOT_STARTED',
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "actual_start" DATE,
    "actual_end" DATE,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "delay_reason" TEXT,
    "recovery_action" TEXT,
    "external_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "takt_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takt_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "start_cycle" INTEGER NOT NULL,
    "duration_cycles" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "takt_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_dependencies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "predecessor_id" UUID NOT NULL,
    "successor_id" UUID NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FS',
    "lag_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "activity_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_constraints" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "type" "ConstraintType" NOT NULL,
    "description" TEXT NOT NULL,
    "due_date" DATE,
    "status" "ConstraintStatus" NOT NULL DEFAULT 'OPEN',
    "cleared_at" TIMESTAMPTZ(6),
    "cleared_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "activity_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_progress" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "progress_pct" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "activity_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_requirements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "kind" "RequirementKind" NOT NULL,
    "trade" TEXT,
    "equipment_type_id" UUID,
    "quantity" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_imports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "format" "ScheduleImportFormat" NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "ScheduleImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "options" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "result_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "schedule_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_calendars_company_id_id_key" ON "work_calendars"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_calendars_company_id_name_key" ON "work_calendars"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_holidays_company_id_id_key" ON "calendar_holidays"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_holidays_calendar_id_date_key" ON "calendar_holidays"("calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_company_id_id_key" ON "buildings"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_company_id_site_id_id_key" ON "buildings"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_site_id_name_key" ON "buildings"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "takt_areas_company_id_id_key" ON "takt_areas"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_areas_company_id_site_id_id_key" ON "takt_areas"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_areas_building_id_code_key" ON "takt_areas"("building_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_company_id_id_key" ON "work_packages"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_company_id_project_id_id_key" ON "work_packages"("company_id", "project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_project_id_code_key" ON "work_packages"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plans_company_id_id_key" ON "takt_plans"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plans_company_id_project_id_site_id_id_key" ON "takt_plans"("company_id", "project_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plans_site_id_name_key" ON "takt_plans"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plan_versions_company_id_id_key" ON "takt_plan_versions"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plan_versions_company_id_plan_id_id_key" ON "takt_plan_versions"("company_id", "plan_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_plan_versions_plan_id_version_number_key" ON "takt_plan_versions"("plan_id", "version_number");

-- CreateIndex
CREATE INDEX "takt_activities_company_id_plan_id_idx" ON "takt_activities"("company_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_activities_company_id_id_key" ON "takt_activities"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_activities_company_id_plan_id_id_key" ON "takt_activities"("company_id", "plan_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_activities_plan_id_work_package_id_takt_area_id_key" ON "takt_activities"("plan_id", "work_package_id", "takt_area_id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_assignments_company_id_id_key" ON "takt_assignments"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "takt_assignments_version_id_activity_id_key" ON "takt_assignments"("version_id", "activity_id");

-- CreateIndex
CREATE INDEX "activity_dependencies_company_id_plan_id_idx" ON "activity_dependencies"("company_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_dependencies_company_id_id_key" ON "activity_dependencies"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_dependencies_predecessor_id_successor_id_key" ON "activity_dependencies"("predecessor_id", "successor_id");

-- CreateIndex
CREATE INDEX "activity_constraints_company_id_plan_id_status_idx" ON "activity_constraints"("company_id", "plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "activity_constraints_company_id_id_key" ON "activity_constraints"("company_id", "id");

-- CreateIndex
CREATE INDEX "activity_progress_company_id_plan_id_report_date_idx" ON "activity_progress"("company_id", "plan_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "activity_progress_company_id_id_key" ON "activity_progress"("company_id", "id");

-- CreateIndex
CREATE INDEX "resource_requirements_company_id_version_id_idx" ON "resource_requirements"("company_id", "version_id");

-- CreateIndex
CREATE INDEX "resource_requirements_company_id_start_date_end_date_idx" ON "resource_requirements"("company_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "resource_requirements_company_id_id_key" ON "resource_requirements"("company_id", "id");

-- CreateIndex
CREATE INDEX "schedule_imports_company_id_plan_id_idx" ON "schedule_imports"("company_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_imports_company_id_id_key" ON "schedule_imports"("company_id", "id");

-- AddForeignKey
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_company_id_calendar_id_fkey" FOREIGN KEY ("company_id", "calendar_id") REFERENCES "work_calendars"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_areas" ADD CONSTRAINT "takt_areas_company_id_site_id_building_id_fkey" FOREIGN KEY ("company_id", "site_id", "building_id") REFERENCES "buildings"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_plans" ADD CONSTRAINT "takt_plans_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_plans" ADD CONSTRAINT "takt_plans_company_id_calendar_id_fkey" FOREIGN KEY ("company_id", "calendar_id") REFERENCES "work_calendars"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_plan_versions" ADD CONSTRAINT "takt_plan_versions_company_id_plan_id_fkey" FOREIGN KEY ("company_id", "plan_id") REFERENCES "takt_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_activities" ADD CONSTRAINT "takt_activities_company_id_project_id_site_id_plan_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id", "plan_id") REFERENCES "takt_plans"("company_id", "project_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_activities" ADD CONSTRAINT "takt_activities_company_id_site_id_takt_area_id_fkey" FOREIGN KEY ("company_id", "site_id", "takt_area_id") REFERENCES "takt_areas"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_activities" ADD CONSTRAINT "takt_activities_company_id_project_id_work_package_id_fkey" FOREIGN KEY ("company_id", "project_id", "work_package_id") REFERENCES "work_packages"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_activities" ADD CONSTRAINT "takt_activities_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_assignments" ADD CONSTRAINT "takt_assignments_company_id_plan_id_version_id_fkey" FOREIGN KEY ("company_id", "plan_id", "version_id") REFERENCES "takt_plan_versions"("company_id", "plan_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takt_assignments" ADD CONSTRAINT "takt_assignments_company_id_plan_id_activity_id_fkey" FOREIGN KEY ("company_id", "plan_id", "activity_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_company_id_plan_id_predecessor_id_fkey" FOREIGN KEY ("company_id", "plan_id", "predecessor_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_company_id_plan_id_successor_id_fkey" FOREIGN KEY ("company_id", "plan_id", "successor_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_constraints" ADD CONSTRAINT "activity_constraints_company_id_plan_id_activity_id_fkey" FOREIGN KEY ("company_id", "plan_id", "activity_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_progress" ADD CONSTRAINT "activity_progress_company_id_plan_id_activity_id_fkey" FOREIGN KEY ("company_id", "plan_id", "activity_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_company_id_plan_id_version_id_fkey" FOREIGN KEY ("company_id", "plan_id", "version_id") REFERENCES "takt_plan_versions"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_company_id_plan_id_activity_id_fkey" FOREIGN KEY ("company_id", "plan_id", "activity_id") REFERENCES "takt_activities"("company_id", "plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_requirements" ADD CONSTRAINT "resource_requirements_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_imports" ADD CONSTRAINT "schedule_imports_company_id_plan_id_fkey" FOREIGN KEY ("company_id", "plan_id") REFERENCES "takt_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
