
-- CreateEnum
CREATE TYPE "HseObservationKind" AS ENUM ('SAFETY_OBSERVATION', 'NEAR_MISS');

-- CreateEnum
CREATE TYPE "HseCategory" AS ENUM ('PPE', 'HOUSEKEEPING', 'WORK_AT_HEIGHT', 'LIFTING', 'EXCAVATION', 'ELECTRICAL', 'TRAFFIC', 'MACHINERY', 'ENVIRONMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "HseObservationStatus" AS ENUM ('OPEN', 'TRIAGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('INJURY', 'PROPERTY_DAMAGE', 'ENVIRONMENTAL', 'DANGEROUS_OCCURRENCE');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('FIRST_AID', 'MEDICAL_TREATMENT', 'LOST_TIME', 'SERIOUS');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'TRIAGED', 'INVESTIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "HseRecordType" AS ENUM ('OBSERVATION', 'INCIDENT', 'INSPECTION', 'RISK_ASSESSMENT');

-- CreateEnum
CREATE TYPE "HseActionStatus" AS ENUM ('OPEN', 'DONE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "RiskAssessmentStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PermitType" AS ENUM ('HOT_WORK', 'CONFINED_SPACE', 'EXCAVATION', 'ELECTRICAL', 'WORK_AT_HEIGHT', 'LIFTING', 'OTHER');

-- CreateEnum
CREATE TYPE "PermitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HseInspectionKind" AS ENUM ('MVR', 'TR', 'GENERAL');

-- CreateEnum
CREATE TYPE "ClientApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ClientApprovalChannel" AS ENUM ('PORTAL', 'RECORDED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "shared_with_client" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shared_with_subcontractors" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hse_observations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "number" INTEGER NOT NULL,
    "kind" "HseObservationKind" NOT NULL,
    "category" "HseCategory" NOT NULL DEFAULT 'OTHER',
    "severity" "HseSeverity" NOT NULL DEFAULT 'LOW',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "lift_plan_id" UUID,
    "status" "HseObservationStatus" NOT NULL DEFAULT 'OPEN',
    "reported_by_external" BOOLEAN NOT NULL DEFAULT false,
    "triaged_at" TIMESTAMPTZ(6),
    "triaged_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "close_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "hse_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "number" INTEGER NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "lift_plan_id" UUID,
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "reported_by_external" BOOLEAN NOT NULL DEFAULT false,
    "immediate_actions" TEXT,
    "triaged_at" TIMESTAMPTZ(6),
    "triaged_by" UUID,
    "investigation_started_at" TIMESTAMPTZ(6),
    "investigator_id" UUID,
    "root_cause" TEXT,
    "lost_days" INTEGER,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "close_note" TEXT,
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_persons" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "employee_id" UUID,
    "person_name" TEXT NOT NULL,
    "employer_name" TEXT,
    "injury_description" TEXT,
    "body_part" TEXT,
    "absence_days" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "incident_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_actions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_type" "HseRecordType" NOT NULL,
    "source_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" UUID,
    "due_date" DATE,
    "status" "HseActionStatus" NOT NULL DEFAULT 'OPEN',
    "done_at" TIMESTAMPTZ(6),
    "done_by" UUID,
    "done_note" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "hse_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toolbox_talks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "held_on" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "presenter" TEXT,
    "attendee_count" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "toolbox_talks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "title" TEXT NOT NULL,
    "work_description" TEXT,
    "lift_plan_id" UUID,
    "status" "RiskAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessment_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "risk_assessment_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "hazard" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "consequence" INTEGER NOT NULL,
    "controls" TEXT,
    "residual_likelihood" INTEGER,
    "residual_consequence" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risk_assessment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_permits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "number" INTEGER NOT NULL,
    "type" "PermitType" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "contractor" TEXT,
    "precautions" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6) NOT NULL,
    "lift_plan_id" UUID,
    "status" "PermitStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_external" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "work_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_inspections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID,
    "kind" "HseInspectionKind" NOT NULL,
    "inspected_on" DATE NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "incorrect_count" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "hse_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_photos" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "record_type" "HseRecordType" NOT NULL,
    "record_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "hse_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_client_approvals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "variation_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" UUID,
    "decision" "ClientApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "channel" "ClientApprovalChannel",
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "decision_ip" TEXT,

    CONSTRAINT "variation_client_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sign_in_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_sha256" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sign_in_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_mail_outbox" (
    "id" UUID NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_mail_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hse_observations_company_id_project_id_status_idx" ON "hse_observations"("company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hse_observations_company_id_id_key" ON "hse_observations"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hse_observations_project_id_number_key" ON "hse_observations"("project_id", "number");

-- CreateIndex
CREATE INDEX "incidents_company_id_project_id_status_idx" ON "incidents"("company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_company_id_id_key" ON "incidents"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_project_id_number_key" ON "incidents"("project_id", "number");

-- CreateIndex
CREATE INDEX "incident_persons_company_id_incident_id_idx" ON "incident_persons"("company_id", "incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_persons_company_id_id_key" ON "incident_persons"("company_id", "id");

-- CreateIndex
CREATE INDEX "hse_actions_company_id_project_id_status_idx" ON "hse_actions"("company_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "hse_actions_company_id_source_type_source_id_idx" ON "hse_actions"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "hse_actions_company_id_id_key" ON "hse_actions"("company_id", "id");

-- CreateIndex
CREATE INDEX "toolbox_talks_company_id_project_id_held_on_idx" ON "toolbox_talks"("company_id", "project_id", "held_on");

-- CreateIndex
CREATE UNIQUE INDEX "toolbox_talks_company_id_id_key" ON "toolbox_talks"("company_id", "id");

-- CreateIndex
CREATE INDEX "risk_assessments_company_id_project_id_status_idx" ON "risk_assessments"("company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_company_id_id_key" ON "risk_assessments"("company_id", "id");

-- CreateIndex
CREATE INDEX "risk_assessment_items_company_id_risk_assessment_id_idx" ON "risk_assessment_items"("company_id", "risk_assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessment_items_company_id_id_key" ON "risk_assessment_items"("company_id", "id");

-- CreateIndex
CREATE INDEX "work_permits_company_id_project_id_status_idx" ON "work_permits"("company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_permits_company_id_id_key" ON "work_permits"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_permits_project_id_number_key" ON "work_permits"("project_id", "number");

-- CreateIndex
CREATE INDEX "hse_inspections_company_id_project_id_inspected_on_idx" ON "hse_inspections"("company_id", "project_id", "inspected_on");

-- CreateIndex
CREATE UNIQUE INDEX "hse_inspections_company_id_id_key" ON "hse_inspections"("company_id", "id");

-- CreateIndex
CREATE INDEX "hse_photos_company_id_record_type_record_id_idx" ON "hse_photos"("company_id", "record_type", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "hse_photos_company_id_id_key" ON "hse_photos"("company_id", "id");

-- CreateIndex
CREATE INDEX "variation_client_approvals_company_id_project_id_decision_idx" ON "variation_client_approvals"("company_id", "project_id", "decision");

-- CreateIndex
CREATE INDEX "variation_client_approvals_company_id_variation_id_idx" ON "variation_client_approvals"("company_id", "variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "variation_client_approvals_company_id_id_key" ON "variation_client_approvals"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "email_sign_in_tokens_token_sha256_key" ON "email_sign_in_tokens"("token_sha256");

-- CreateIndex
CREATE INDEX "email_sign_in_tokens_user_id_created_at_idx" ON "email_sign_in_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "dev_mail_outbox_to_created_at_idx" ON "dev_mail_outbox"("to", "created_at");

-- AddForeignKey
ALTER TABLE "hse_observations" ADD CONSTRAINT "hse_observations_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_observations" ADD CONSTRAINT "hse_observations_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_observations" ADD CONSTRAINT "hse_observations_company_id_lift_plan_id_fkey" FOREIGN KEY ("company_id", "lift_plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_lift_plan_id_fkey" FOREIGN KEY ("company_id", "lift_plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_persons" ADD CONSTRAINT "incident_persons_company_id_incident_id_fkey" FOREIGN KEY ("company_id", "incident_id") REFERENCES "incidents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_persons" ADD CONSTRAINT "incident_persons_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_company_id_assignee_id_fkey" FOREIGN KEY ("company_id", "assignee_id") REFERENCES "company_memberships"("company_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_company_id_lift_plan_id_fkey" FOREIGN KEY ("company_id", "lift_plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessment_items" ADD CONSTRAINT "risk_assessment_items_company_id_risk_assessment_id_fkey" FOREIGN KEY ("company_id", "risk_assessment_id") REFERENCES "risk_assessments"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_company_id_lift_plan_id_fkey" FOREIGN KEY ("company_id", "lift_plan_id") REFERENCES "lift_plans"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_photos" ADD CONSTRAINT "hse_photos_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_client_approvals" ADD CONSTRAINT "variation_client_approvals_company_id_variation_id_fkey" FOREIGN KEY ("company_id", "variation_id") REFERENCES "variations"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_client_approvals" ADD CONSTRAINT "variation_client_approvals_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sign_in_tokens" ADD CONSTRAINT "email_sign_in_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

