-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED');

-- CreateEnum
CREATE TYPE "WorkTimeClass" AS ENUM ('NORMAL', 'OVERTIME_50', 'OVERTIME_100', 'TRAVEL');

-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "DailyReportEntryKind" AS ENUM ('WORK', 'EQUIPMENT', 'DELAY', 'INSTRUCTION');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('LABOR', 'EQUIPMENT', 'MATERIALS', 'SUBCONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "work_date" DATE NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "hours" DECIMAL(5,2) NOT NULL,
    "work_class" "WorkTimeClass" NOT NULL DEFAULT 'NORMAL',
    "note" TEXT,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "correction_of_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "rejection_reason" TEXT,
    "exported_at" TIMESTAMPTZ(6),
    "export_batch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "weather" TEXT,
    "summary" TEXT,
    "attendance_snapshot" JSONB,
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "daily_report_id" UUID NOT NULL,
    "kind" "DailyReportEntryKind" NOT NULL,
    "description" TEXT,
    "equipment_id" UUID,
    "hours" DECIMAL(6,2),
    "is_addendum" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "daily_report_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_attachments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "daily_report_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "caption" TEXT,
    "is_addendum" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "daily_report_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "note" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "activated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "category" "CostCategory" NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_company_id_employee_id_work_date_idx" ON "time_entries"("company_id", "employee_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entries_company_id_project_id_status_work_date_idx" ON "time_entries"("company_id", "project_id", "status", "work_date");

-- CreateIndex
CREATE INDEX "time_entries_company_id_export_batch_id_idx" ON "time_entries"("company_id", "export_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_company_id_id_key" ON "time_entries"("company_id", "id");

-- CreateIndex
CREATE INDEX "daily_reports_company_id_project_id_report_date_idx" ON "daily_reports"("company_id", "project_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_company_id_id_key" ON "daily_reports"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_site_id_report_date_key" ON "daily_reports"("site_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_report_entries_company_id_daily_report_id_idx" ON "daily_report_entries"("company_id", "daily_report_id");

-- CreateIndex
CREATE INDEX "daily_report_entries_company_id_equipment_id_idx" ON "daily_report_entries"("company_id", "equipment_id");

-- CreateIndex
CREATE INDEX "daily_report_attachments_company_id_daily_report_id_idx" ON "daily_report_attachments"("company_id", "daily_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_attachments_company_id_id_key" ON "daily_report_attachments"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_company_id_id_key" ON "budgets"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_project_id_version_number_key" ON "budgets"("project_id", "version_number");

-- CreateIndex
CREATE INDEX "budget_lines_company_id_budget_id_idx" ON "budget_lines"("company_id", "budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_company_id_id_key" ON "budget_lines"("company_id", "id");

-- CreateIndex
CREATE INDEX "cost_entries_company_id_project_id_entry_date_idx" ON "cost_entries"("company_id", "project_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entries_company_id_id_key" ON "cost_entries"("company_id", "id");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_correction_of_id_fkey" FOREIGN KEY ("company_id", "correction_of_id") REFERENCES "time_entries"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_company_id_daily_report_id_fkey" FOREIGN KEY ("company_id", "daily_report_id") REFERENCES "daily_reports"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_company_id_equipment_id_fkey" FOREIGN KEY ("company_id", "equipment_id") REFERENCES "equipment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_attachments" ADD CONSTRAINT "daily_report_attachments_company_id_daily_report_id_fkey" FOREIGN KEY ("company_id", "daily_report_id") REFERENCES "daily_reports"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_company_id_budget_id_fkey" FOREIGN KEY ("company_id", "budget_id") REFERENCES "budgets"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
