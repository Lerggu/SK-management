-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProjectAccess" AS ENUM ('ALL', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "EquipmentCategory" AS ENUM ('CRANE', 'TELEHANDLER', 'EXCAVATOR', 'WHEEL_LOADER', 'FORKLIFT', 'AERIAL_PLATFORM', 'VEHICLE', 'LIFTING_ACCESSORY', 'CABLE_EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('COST', 'BILLING');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CONTRACT', 'DRAWING', 'RAMS', 'LIFT_PLAN', 'ELECTRICAL_PLAN', 'INSPECTION', 'CERTIFICATE', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('CURRENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentLinkEntity" AS ENUM ('PROJECT', 'SITE', 'EMPLOYEE', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_id" TEXT,
    "default_currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "default_locale" TEXT NOT NULL DEFAULT 'fi',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Helsinki',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "email_verified" TIMESTAMPTZ(6),
    "image" TEXT,
    "locale" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_company_id" UUID,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tenant_id" TEXT,
    "email" TEXT,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "ext_expires_in" INTEGER,
    "refresh_token_expires_in" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_memberships" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invited_at" TIMESTAMPTZ(6),
    "invited_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "template_key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "project_access" "ProjectAccess" NOT NULL DEFAULT 'ASSIGNED',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "company_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "company_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "project_memberships" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_name" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "job_title" TEXT,
    "trade" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'EMPLOYEE',
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "user_id" UUID,
    "start_date" DATE,
    "end_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "rate_type" "RateType" NOT NULL,
    "unit" "RateUnit" NOT NULL DEFAULT 'HOUR',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "EquipmentCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "equipment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "equipment_type_id" UUID NOT NULL,
    "asset_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "registration_number" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "current_project_id" UUID,
    "current_site_id" UUID,
    "meter_hours" DECIMAL(10,1),
    "next_inspection_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "rate_type" "RateType" NOT NULL,
    "unit" "RateUnit" NOT NULL DEFAULT 'HOUR',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "equipment_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "site_id" UUID,
    "title" TEXT NOT NULL,
    "document_number" TEXT,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "revision_label" TEXT,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'CURRENT',
    "approval_state" "ApprovalState" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "issue_date" DATE,
    "change_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "entity_type" "DocumentLinkEntity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID,
    "company_id" UUID,
    "project_id" UUID,
    "actor_type" "ActorType" NOT NULL DEFAULT 'USER',
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_organization_id_idx" ON "companies"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities"("provider", "subject");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "company_memberships_user_id_idx" ON "company_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_company_id_id_key" ON "company_memberships"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_company_id_user_id_key" ON "company_memberships"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_id_key" ON "roles"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_key_key" ON "roles"("company_id", "key");

-- CreateIndex
CREATE INDEX "role_permissions_company_id_idx" ON "role_permissions"("company_id");

-- CreateIndex
CREATE INDEX "membership_roles_company_id_idx" ON "membership_roles"("company_id");

-- CreateIndex
CREATE INDEX "project_memberships_company_id_user_id_idx" ON "project_memberships"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_company_id_id_key" ON "project_memberships"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_project_id_user_id_key" ON "project_memberships"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_company_id_archived_at_idx" ON "projects"("company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_id_key" ON "projects"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_code_key" ON "projects"("company_id", "code");

-- CreateIndex
CREATE INDEX "sites_company_id_project_id_idx" ON "sites"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_company_id_id_key" ON "sites"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_company_id_project_id_id_key" ON "sites"("company_id", "project_id", "id");

-- CreateIndex
CREATE INDEX "employees_company_id_archived_at_idx" ON "employees"("company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_id_key" ON "employees"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_number_key" ON "employees"("company_id", "employee_number");

-- CreateIndex
CREATE INDEX "employee_rates_company_id_employee_id_rate_type_valid_from_idx" ON "employee_rates"("company_id", "employee_id", "rate_type", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_rates_company_id_id_key" ON "employee_rates"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_types_company_id_id_key" ON "equipment_types"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_types_company_id_name_key" ON "equipment_types"("company_id", "name");

-- CreateIndex
CREATE INDEX "equipment_company_id_archived_at_idx" ON "equipment"("company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_company_id_id_key" ON "equipment"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_company_id_asset_number_key" ON "equipment"("company_id", "asset_number");

-- CreateIndex
CREATE INDEX "equipment_rates_company_id_equipment_id_rate_type_valid_fro_idx" ON "equipment_rates"("company_id", "equipment_id", "rate_type", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_rates_company_id_id_key" ON "equipment_rates"("company_id", "id");

-- CreateIndex
CREATE INDEX "documents_company_id_project_id_idx" ON "documents"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "documents_company_id_archived_at_idx" ON "documents"("company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_company_id_id_key" ON "documents"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_company_id_id_key" ON "document_versions"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "document_links_company_id_entity_type_entity_id_idx" ON "document_links"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_entity_type_entity_id_key" ON "document_links"("document_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_company_id_occurred_at_idx" ON "audit_events"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_company_id_entity_type_entity_id_idx" ON "audit_events"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "audit_events"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_role_id_fkey" FOREIGN KEY ("company_id", "role_id") REFERENCES "roles"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_company_id_membership_id_fkey" FOREIGN KEY ("company_id", "membership_id") REFERENCES "company_memberships"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_company_id_role_id_fkey" FOREIGN KEY ("company_id", "role_id") REFERENCES "roles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_company_id_user_id_fkey" FOREIGN KEY ("company_id", "user_id") REFERENCES "company_memberships"("company_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_company_id_role_id_fkey" FOREIGN KEY ("company_id", "role_id") REFERENCES "roles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_equipment_type_id_fkey" FOREIGN KEY ("company_id", "equipment_type_id") REFERENCES "equipment_types"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_current_project_id_fkey" FOREIGN KEY ("company_id", "current_project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_current_project_id_current_site_id_fkey" FOREIGN KEY ("company_id", "current_project_id", "current_site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_rates" ADD CONSTRAINT "equipment_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_rates" ADD CONSTRAINT "equipment_rates_company_id_equipment_id_fkey" FOREIGN KEY ("company_id", "equipment_id") REFERENCES "equipment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
