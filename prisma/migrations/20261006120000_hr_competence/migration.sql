-- HR: personnel card, competence matrix, assessments, trainings, cards and
-- qualifications, orientations, equipment authorizations, languages, work
-- clothing, company items, attachments, job requirements and expiry
-- reminders (docs/adr/0025-hr-competence.md). Generated from
-- prisma/schema.prisma; the integrity rules, row-level security and
-- permissions below are hand-written.


-- CreateEnum
CREATE TYPE "CompetenceAssessmentKind" AS ENUM ('SUPERVISOR', 'SELF');

-- CreateEnum
CREATE TYPE "CompetenceAssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('PLANNED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LanguageLevel" AS ENUM ('NOT_ASSESSED', 'BEGINNER', 'BASIC', 'FLUENT', 'NATIVE');

-- CreateEnum
CREATE TYPE "AssessmentSource" AS ENUM ('SELF', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "OrientationScope" AS ENUM ('COMPANY', 'SITE', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "OrientationStatus" AS ENUM ('IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "CompanyItemType" AS ENUM ('PHONE', 'COMPUTER', 'HARNESS', 'TOOL', 'KEY', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyItemStatus" AS ENUM ('WITH_EMPLOYEE', 'RETURNED', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmployeeFileKind" AS ENUM ('PROFILE_PHOTO', 'CERTIFICATE', 'CARD_IMAGE', 'TRAINING_CERTIFICATE', 'ORIENTATION', 'AUTHORIZATION', 'ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeFileTarget" AS ENUM ('QUALIFICATION', 'TRAINING', 'ORIENTATION', 'AUTHORIZATION', 'ITEM');

-- CreateEnum
CREATE TYPE "JobRequirementKind" AS ENUM ('COMPETENCE', 'QUALIFICATION', 'ORIENTATION');

-- CreateEnum
CREATE TYPE "ExpiryReminderSource" AS ENUM ('QUALIFICATION', 'TRAINING');

-- CreateEnum
CREATE TYPE "ExpiryReminderRecipient" AS ENUM ('OWNER', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ExpiryReminderStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'NO_ADDRESS');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "driver_licence_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "driving_rights" TEXT,
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "interpreter_needed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jacket_size" TEXT,
ADD COLUMN     "job_profile_id" UUID,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "photo_file_id" UUID,
ADD COLUMN     "preferred_language" VARCHAR(3),
ADD COLUMN     "shoe_size" TEXT,
ADD COLUMN     "supervisor_id" UUID,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "trousers_size" TEXT;

-- CreateTable
CREATE TABLE "hr_settings" (
    "company_id" UUID NOT NULL,
    "reminder_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "hr_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "competence_areas" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_key" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "competence_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competence_assessments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "kind" "CompetenceAssessmentKind" NOT NULL,
    "status" "CompetenceAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "level" SMALLINT,
    "observations" TEXT,
    "strengths" TEXT,
    "development_areas" TEXT,
    "agreed_actions" TEXT,
    "action_owner_employee_id" UUID,
    "action_due_on" DATE,
    "action_done_at" TIMESTAMPTZ(6),
    "assessor_user_id" UUID NOT NULL,
    "assessed_on" DATE NOT NULL,
    "next_assessment_on" DATE,
    "published_at" TIMESTAMPTZ(6),
    "employee_comment" TEXT,
    "employee_comment_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "competence_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "status" "TrainingStatus" NOT NULL DEFAULT 'COMPLETED',
    "planned_on" DATE,
    "completed_on" DATE,
    "expires_on" DATE,
    "remind_before_expiry" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_issuer" TEXT,
    "default_validity_months" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "qualification_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_qualifications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type_id" UUID,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "card_number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "no_expiry" BOOLEAN NOT NULL DEFAULT false,
    "remind_before_expiry" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "renews_id" UUID,
    "replaced_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_authorizations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "equipment_type_id" UUID,
    "granted_by_user_id" UUID NOT NULL,
    "granted_on" DATE NOT NULL,
    "expires_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "equipment_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orientations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "scope" "OrientationScope" NOT NULL,
    "topic" TEXT NOT NULL,
    "target" TEXT,
    "instructor_name" TEXT NOT NULL,
    "completed_on" DATE,
    "status" "OrientationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "acknowledged_at" TIMESTAMPTZ(6),
    "renewal_due_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "orientations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_languages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "language" VARCHAR(3) NOT NULL,
    "speaking" "LanguageLevel" NOT NULL DEFAULT 'NOT_ASSESSED',
    "understanding" "LanguageLevel" NOT NULL DEFAULT 'NOT_ASSESSED',
    "reading" "LanguageLevel" NOT NULL DEFAULT 'NOT_ASSESSED',
    "writing" "LanguageLevel" NOT NULL DEFAULT 'NOT_ASSESSED',
    "source" "AssessmentSource" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "employee_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clothing_issues" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "size" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "issued_on" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" UUID,

    CONSTRAINT "clothing_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "item_type" "CompanyItemType" NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "issued_on" DATE NOT NULL,
    "condition_at_issue" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "status" "CompanyItemStatus" NOT NULL DEFAULT 'WITH_EMPLOYEE',
    "returned_on" DATE,
    "next_inspection_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "company_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_files" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "EmployeeFileKind" NOT NULL,
    "target_type" "EmployeeFileTarget",
    "target_id" UUID,
    "display_name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" UUID,

    CONSTRAINT "employee_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_profiles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requirements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "kind" "JobRequirementKind" NOT NULL,
    "area_id" UUID,
    "min_level" SMALLINT,
    "qualification_type_id" UUID,
    "orientation_scope" "OrientationScope",
    "orientation_topic" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expiry_reminders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source_type" "ExpiryReminderSource" NOT NULL,
    "source_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "expires_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "recipient_kind" "ExpiryReminderRecipient" NOT NULL,
    "recipient_email" TEXT,
    "status" "ExpiryReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expiry_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competence_areas_company_id_id_key" ON "competence_areas"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "competence_areas_company_id_category_name_key" ON "competence_areas"("company_id", "category", "name");

-- CreateIndex
CREATE INDEX "competence_assessments_company_id_employee_id_area_id_kind__idx" ON "competence_assessments"("company_id", "employee_id", "area_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "competence_assessments_company_id_id_key" ON "competence_assessments"("company_id", "id");

-- CreateIndex
CREATE INDEX "trainings_company_id_employee_id_idx" ON "trainings"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "trainings_company_id_expires_on_idx" ON "trainings"("company_id", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "trainings_company_id_id_key" ON "trainings"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_types_company_id_id_key" ON "qualification_types"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_types_company_id_name_key" ON "qualification_types"("company_id", "name");

-- CreateIndex
CREATE INDEX "employee_qualifications_company_id_employee_id_idx" ON "employee_qualifications"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_qualifications_company_id_expires_on_idx" ON "employee_qualifications"("company_id", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "employee_qualifications_company_id_id_key" ON "employee_qualifications"("company_id", "id");

-- CreateIndex
CREATE INDEX "equipment_authorizations_company_id_employee_id_idx" ON "equipment_authorizations"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_authorizations_company_id_id_key" ON "equipment_authorizations"("company_id", "id");

-- CreateIndex
CREATE INDEX "orientations_company_id_employee_id_idx" ON "orientations"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "orientations_company_id_id_key" ON "orientations"("company_id", "id");

-- CreateIndex
CREATE INDEX "employee_languages_company_id_language_idx" ON "employee_languages"("company_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "employee_languages_company_id_id_key" ON "employee_languages"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_languages_employee_id_language_source_key" ON "employee_languages"("employee_id", "language", "source");

-- CreateIndex
CREATE INDEX "clothing_issues_company_id_employee_id_idx" ON "clothing_issues"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "clothing_issues_company_id_id_key" ON "clothing_issues"("company_id", "id");

-- CreateIndex
CREATE INDEX "company_items_company_id_employee_id_idx" ON "company_items"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "company_items_company_id_status_idx" ON "company_items"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_items_company_id_id_key" ON "company_items"("company_id", "id");

-- CreateIndex
CREATE INDEX "employee_files_company_id_employee_id_idx" ON "employee_files"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_files_company_id_target_type_target_id_idx" ON "employee_files"("company_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_files_company_id_id_key" ON "employee_files"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_profiles_company_id_id_key" ON "job_profiles"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_profiles_company_id_name_key" ON "job_profiles"("company_id", "name");

-- CreateIndex
CREATE INDEX "job_requirements_company_id_profile_id_idx" ON "job_requirements"("company_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_requirements_company_id_id_key" ON "job_requirements"("company_id", "id");

-- CreateIndex
CREATE INDEX "expiry_reminders_company_id_status_idx" ON "expiry_reminders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expiry_reminders_company_id_id_key" ON "expiry_reminders"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expiry_reminders_source_type_source_id_expires_on_recipient_key" ON "expiry_reminders"("source_type", "source_id", "expires_on", "recipient_kind");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_supervisor_id_fkey" FOREIGN KEY ("company_id", "supervisor_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_job_profile_id_fkey" FOREIGN KEY ("company_id", "job_profile_id") REFERENCES "job_profiles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competence_areas" ADD CONSTRAINT "competence_areas_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competence_assessments" ADD CONSTRAINT "competence_assessments_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competence_assessments" ADD CONSTRAINT "competence_assessments_company_id_area_id_fkey" FOREIGN KEY ("company_id", "area_id") REFERENCES "competence_areas"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competence_assessments" ADD CONSTRAINT "competence_assessments_company_id_action_owner_employee_id_fkey" FOREIGN KEY ("company_id", "action_owner_employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_types" ADD CONSTRAINT "qualification_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_company_id_type_id_fkey" FOREIGN KEY ("company_id", "type_id") REFERENCES "qualification_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_authorizations" ADD CONSTRAINT "equipment_authorizations_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_authorizations" ADD CONSTRAINT "equipment_authorizations_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orientations" ADD CONSTRAINT "orientations_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_languages" ADD CONSTRAINT "employee_languages_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clothing_issues" ADD CONSTRAINT "clothing_issues_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_items" ADD CONSTRAINT "company_items_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_files" ADD CONSTRAINT "employee_files_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profiles" ADD CONSTRAINT "job_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_company_id_profile_id_fkey" FOREIGN KEY ("company_id", "profile_id") REFERENCES "job_profiles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_company_id_area_id_fkey" FOREIGN KEY ("company_id", "area_id") REFERENCES "competence_areas"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_company_id_qualification_type_id_fkey" FOREIGN KEY ("company_id", "qualification_type_id") REFERENCES "qualification_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE employees
  ADD CONSTRAINT employees_supervisor_not_self CHECK (supervisor_id IS NULL OR supervisor_id <> id);

ALTER TABLE competence_assessments
  ADD CONSTRAINT competence_assessments_level CHECK (level IS NULL OR level BETWEEN 1 AND 4),
  ADD CONSTRAINT competence_assessments_published CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),
  ADD CONSTRAINT competence_assessments_next_after CHECK (next_assessment_on IS NULL OR next_assessment_on >= assessed_on),
  ADD CONSTRAINT competence_assessments_comment_published CHECK (employee_comment IS NULL OR status = 'PUBLISHED');

ALTER TABLE trainings
  ADD CONSTRAINT trainings_completed_date CHECK (status <> 'COMPLETED' OR completed_on IS NOT NULL),
  ADD CONSTRAINT trainings_expiry_after CHECK (expires_on IS NULL OR completed_on IS NULL OR expires_on >= completed_on);

ALTER TABLE employee_qualifications
  ADD CONSTRAINT employee_qualifications_expiry CHECK (NOT (no_expiry AND expires_on IS NOT NULL)),
  ADD CONSTRAINT employee_qualifications_expiry_after CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on);

ALTER TABLE equipment_authorizations
  ADD CONSTRAINT equipment_authorizations_expiry_after CHECK (expires_on IS NULL OR expires_on >= granted_on);

ALTER TABLE orientations
  ADD CONSTRAINT orientations_done_date CHECK (status <> 'DONE' OR completed_on IS NOT NULL);

ALTER TABLE clothing_issues
  ADD CONSTRAINT clothing_issues_quantity CHECK (quantity > 0);

ALTER TABLE company_items
  ADD CONSTRAINT company_items_returned_date CHECK (status <> 'RETURNED' OR returned_on IS NOT NULL);

ALTER TABLE employee_files
  ADD CONSTRAINT employee_files_target CHECK ((target_type IS NULL) = (target_id IS NULL));

ALTER TABLE job_requirements
  ADD CONSTRAINT job_requirements_shape CHECK (
    (kind = 'COMPETENCE' AND area_id IS NOT NULL AND min_level BETWEEN 1 AND 4 AND qualification_type_id IS NULL AND orientation_topic IS NULL)
    OR (kind = 'QUALIFICATION' AND qualification_type_id IS NOT NULL AND area_id IS NULL AND orientation_topic IS NULL)
    OR (kind = 'ORIENTATION' AND orientation_scope IS NOT NULL AND orientation_topic IS NOT NULL AND area_id IS NULL AND qualification_type_id IS NULL)
  );

ALTER TABLE expiry_reminders
  ADD CONSTRAINT expiry_reminders_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL));

-- A published assessment is final: only the employee's comment and the
-- follow-up of the agreed action may change. Assessments are never deleted.
CREATE OR REPLACE FUNCTION competence_assessments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'competence assessments are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'PUBLISHED' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.level IS DISTINCT FROM OLD.level
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
    OR NEW.area_id IS DISTINCT FROM OLD.area_id OR NEW.observations IS DISTINCT FROM OLD.observations
    OR NEW.strengths IS DISTINCT FROM OLD.strengths OR NEW.development_areas IS DISTINCT FROM OLD.development_areas
    OR NEW.agreed_actions IS DISTINCT FROM OLD.agreed_actions OR NEW.action_owner_employee_id IS DISTINCT FROM OLD.action_owner_employee_id
    OR NEW.action_due_on IS DISTINCT FROM OLD.action_due_on OR NEW.assessor_user_id IS DISTINCT FROM OLD.assessor_user_id
    OR NEW.assessed_on IS DISTINCT FROM OLD.assessed_on OR NEW.next_assessment_on IS DISTINCT FROM OLD.next_assessment_on
    OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'a published competence assessment cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competence_assessments_guard
  BEFORE UPDATE OR DELETE ON competence_assessments
  FOR EACH ROW EXECUTE FUNCTION competence_assessments_guard();

-- Clothing hand-outs are kept: an entry can only be cancelled (archived) once.
CREATE OR REPLACE FUNCTION clothing_issues_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clothing hand-outs are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.archived_at IS NOT NULL
    OR (to_jsonb(NEW) - 'archived_at' - 'archived_by') IS DISTINCT FROM (to_jsonb(OLD) - 'archived_at' - 'archived_by') THEN
    RAISE EXCEPTION 'a clothing hand-out can only be cancelled' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clothing_issues_guard
  BEFORE UPDATE OR DELETE ON clothing_issues
  FOR EACH ROW EXECUTE FUNCTION clothing_issues_guard();

-- ── Row-level security (ADR 0022): same tenant policy as every company table.
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_settings, competence_areas, competence_assessments, trainings,
  qualification_types, employee_qualifications, equipment_authorizations, orientations, employee_languages,
  clothing_issues, company_items, employee_files, job_profiles, job_requirements, expiry_reminders TO sk_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_settings', 'competence_areas', 'competence_assessments', 'trainings',
    'qualification_types', 'employee_qualifications', 'equipment_authorizations', 'orientations',
    'employee_languages', 'clothing_issues', 'company_items', 'employee_files', 'job_profiles',
    'job_requirements', 'expiry_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END$$;

-- ── Permissions (src/platform/authz/permissions.ts) ──────────────────
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('hr.view', 'workforce', 'View work-related HR data: competence matrix, published assessments, trainings, cards, orientations, permits and languages', true),
  ('hr.manage', 'workforce', 'Manage all HR data: competence areas, card types, requirements, assessments, attachments, clothing and company items', true);

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN (VALUES
  ('CEO', 'hr.view'), ('CEO', 'hr.manage'),
  ('PROJECT_DIRECTOR', 'hr.view'),
  ('PROJECT_MANAGER', 'hr.view'),
  ('SITE_MANAGER', 'hr.view'),
  ('HSE', 'hr.view')
) AS g(template_key, permission_key) ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;

-- Every existing company gets the new HR_ADMIN system role.
INSERT INTO roles (id, company_id, key, template_key, name, project_access, is_system, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'HR_ADMIN', 'HR_ADMIN',
       CASE WHEN c.default_locale = 'en' THEN 'HR administrator' ELSE 'Henkilöstöhallinto' END,
       'ASSIGNED', true, now(), now()
FROM companies c
ON CONFLICT (company_id, key) DO NOTHING;

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, p.key, now()
FROM roles r
CROSS JOIN (VALUES ('employee.view'), ('employee.manage'), ('hr.view'), ('hr.manage'), ('equipment.view')) AS p(key)
WHERE r.template_key = 'HR_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'HR', 'createdRole', 'HR_ADMIN', 'granted', (
         SELECT jsonb_object_agg(x.template_key, x.keys) FROM (
           SELECT r.template_key, jsonb_agg(rp.permission_key ORDER BY rp.permission_key) AS keys
           FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
           WHERE r.company_id = c.id AND (rp.permission_key LIKE 'hr.%' OR r.template_key = 'HR_ADMIN')
           GROUP BY r.template_key) x)),
       jsonb_build_object('migration', '20261006120000_hr_competence')
FROM companies c;
