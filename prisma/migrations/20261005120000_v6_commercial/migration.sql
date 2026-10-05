-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('LEAD', 'QUALIFIED', 'RFQ', 'TENDER', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SENT', 'WON', 'LOST', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuoteLineCategory" AS ENUM ('LABOR', 'EQUIPMENT', 'LIFTING', 'TRANSPORT', 'MATERIALS', 'TRAVEL', 'ACCOMMODATION', 'SUBCONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "VariationStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'SUBMITTED_TO_CLIENT', 'APPROVED', 'REJECTED', 'EXECUTED', 'READY_TO_INVOICE', 'INVOICED');

-- CreateEnum
CREATE TYPE "InvoiceSourceType" AS ENUM ('LABOR', 'EQUIPMENT', 'VARIATION', 'MILESTONE', 'INTERNAL_BOOKING');

-- CreateEnum
CREATE TYPE "InvoiceCandidateStatus" AS ENUM ('OPEN', 'EXPORTED', 'INVOICED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceExportKind" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'JSON');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "customer_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "business_id" TEXT,
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'LEAD',
    "estimated_value" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "probability_pct" INTEGER,
    "expected_close_date" DATE,
    "owner_user_id" UUID,
    "lost_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "project_id" UUID,
    "quote_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT,
    "overhead_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "risk_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "margin_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valid_until" DATE,
    "change_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "outcome_at" TIMESTAMPTZ(6),
    "outcome_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "category" "QuoteLineCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "quote_version_id" UUID,
    "contract_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "signed_date" DATE,
    "retention_note" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_milestones" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "contract_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contract_id" UUID,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cause" TEXT,
    "client_reference" TEXT,
    "status" "VariationStatus" NOT NULL DEFAULT 'DRAFT',
    "labor_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "equipment_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "materials_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subcontract_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "markup_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sales_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "evidence_document_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "internal_approved_at" TIMESTAMPTZ(6),
    "internal_approved_by" UUID,
    "client_decision_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "executed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_candidates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "customer_id" UUID,
    "bill_to_company_id" UUID,
    "source_type" "InvoiceSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "period_date" DATE NOT NULL,
    "status" "InvoiceCandidateStatus" NOT NULL DEFAULT 'OPEN',
    "export_batch_id" UUID,
    "invoiced_at" TIMESTAMPTZ(6),
    "invoiced_by" UUID,
    "invoice_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "invoice_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_export_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "InvoiceExportKind" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "reexport" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "invoice_export_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_forecasts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "etc_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cost_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_id_key" ON "customers"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_name_key" ON "customers"("company_id", "name");

-- CreateIndex
CREATE INDEX "contacts_company_id_customer_id_idx" ON "contacts"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_company_id_id_key" ON "contacts"("company_id", "id");

-- CreateIndex
CREATE INDEX "opportunities_company_id_stage_idx" ON "opportunities"("company_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_company_id_id_key" ON "opportunities"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_company_id_id_key" ON "quotes"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_company_id_quote_number_key" ON "quotes"("company_id", "quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_company_id_id_key" ON "quote_versions"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_quote_id_version_number_key" ON "quote_versions"("quote_id", "version_number");

-- CreateIndex
CREATE INDEX "quote_lines_company_id_version_id_idx" ON "quote_lines"("company_id", "version_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_company_id_id_key" ON "contracts"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_company_id_project_id_id_key" ON "contracts"("company_id", "project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_company_id_contract_number_key" ON "contracts"("company_id", "contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_company_id_quote_version_id_key" ON "contracts"("company_id", "quote_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_milestones_company_id_id_key" ON "contract_milestones"("company_id", "id");

-- CreateIndex
CREATE INDEX "variations_company_id_status_idx" ON "variations"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "variations_company_id_id_key" ON "variations"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "variations_project_id_number_key" ON "variations"("project_id", "number");

-- CreateIndex
CREATE INDEX "invoice_candidates_company_id_status_period_date_idx" ON "invoice_candidates"("company_id", "status", "period_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_candidates_company_id_id_key" ON "invoice_candidates"("company_id", "id");

-- CreateIndex
CREATE INDEX "invoice_candidates_company_id_source_type_source_id_idx" ON "invoice_candidates"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "invoice_export_batches_company_id_created_at_idx" ON "invoice_export_batches"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_export_batches_company_id_id_key" ON "invoice_export_batches"("company_id", "id");

-- CreateIndex
CREATE INDEX "cost_forecasts_company_id_project_id_category_created_at_idx" ON "cost_forecasts"("company_id", "project_id", "category", "created_at");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_opportunity_id_fkey" FOREIGN KEY ("company_id", "opportunity_id") REFERENCES "opportunities"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_company_id_quote_id_fkey" FOREIGN KEY ("company_id", "quote_id") REFERENCES "quotes"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_company_id_version_id_fkey" FOREIGN KEY ("company_id", "version_id") REFERENCES "quote_versions"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_quote_version_id_fkey" FOREIGN KEY ("company_id", "quote_version_id") REFERENCES "quote_versions"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_company_id_contract_id_fkey" FOREIGN KEY ("company_id", "contract_id") REFERENCES "contracts"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_company_id_project_id_contract_id_fkey" FOREIGN KEY ("company_id", "project_id", "contract_id") REFERENCES "contracts"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_company_id_evidence_document_id_fkey" FOREIGN KEY ("company_id", "evidence_document_id") REFERENCES "documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_candidates" ADD CONSTRAINT "invoice_candidates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_candidates" ADD CONSTRAINT "invoice_candidates_bill_to_company_id_fkey" FOREIGN KEY ("bill_to_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_candidates" ADD CONSTRAINT "invoice_candidates_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_candidates" ADD CONSTRAINT "invoice_candidates_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_candidates" ADD CONSTRAINT "invoice_candidates_company_id_export_batch_id_fkey" FOREIGN KEY ("company_id", "export_batch_id") REFERENCES "invoice_export_batches"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_export_batches" ADD CONSTRAINT "invoice_export_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_forecasts" ADD CONSTRAINT "cost_forecasts_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

