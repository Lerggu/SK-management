-- Order confirmations, invoices and credit notes (docs/adr/0033-sales-documents.md):
-- seller details per company, documents with lines, and an append-only send log.
-- Generated from prisma/schema.prisma; integrity rules, row-level security and
-- the immutability triggers below are hand-written.

-- CreateEnum
CREATE TYPE "SalesDocumentKind" AS ENUM ('ORDER_CONFIRMATION', 'INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "SalesVatMode" AS ENUM ('STANDARD', 'REVERSE_CHARGE');

-- CreateEnum
CREATE TYPE "SalesLogo" AS ENUM ('NONE', 'SK_INFRA');

-- CreateTable
CREATE TABLE "billing_settings" (
    "company_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "legal_name" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "vat_number" TEXT,
    "street_address" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Suomi',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "bank_name" TEXT,
    "payment_term_days" INTEGER NOT NULL DEFAULT 14,
    "penalty_interest" TEXT NOT NULL DEFAULT 'Viivästyskorko korkolain mukaan',
    "default_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 25.5,
    "logo" "SalesLogo" NOT NULL DEFAULT 'NONE',
    "next_order_number" INTEGER NOT NULL DEFAULT 1001,
    "next_invoice_number" INTEGER NOT NULL DEFAULT 10001,
    "footer_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "sales_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "SalesDocumentKind" NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fi',
    "customer_id" UUID,
    "project_id" UUID,
    "source_document_id" UUID,
    "title" TEXT,
    "buyer_name" TEXT NOT NULL,
    "buyer_business_id" TEXT,
    "buyer_vat_number" TEXT,
    "buyer_address" TEXT,
    "buyer_postal_code" TEXT,
    "buyer_city" TEXT,
    "buyer_country" TEXT,
    "buyer_contact" TEXT,
    "buyer_email" TEXT,
    "buyer_reference" TEXT,
    "our_reference" TEXT,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "delivery_date" DATE,
    "delivery_terms" TEXT,
    "delivery_method" TEXT,
    "delivery_address" TEXT,
    "payment_terms" TEXT,
    "vat_mode" "SalesVatMode" NOT NULL DEFAULT 'STANDARD',
    "notes" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "reference_number" TEXT,
    "total_net" DECIMAL(14,2),
    "total_vat" DECIMAL(14,2),
    "total_gross" DECIMAL(14,2),
    "pdf_storage_key" TEXT,
    "pdf_sha256" CHAR(64),
    "pdf_size_bytes" INTEGER,
    "issued_at" TIMESTAMPTZ(6),
    "issued_by" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "product_code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kpl',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "delivery_time" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "sales_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_sends" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "to_email" TEXT NOT NULL,
    "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" UUID,

    CONSTRAINT "sales_document_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_documents_company_id_kind_status_idx" ON "sales_documents"("company_id", "kind", "status");

-- CreateIndex
CREATE INDEX "sales_documents_company_id_customer_id_idx" ON "sales_documents"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_company_id_id_key" ON "sales_documents"("company_id", "id");

-- CreateIndex
CREATE INDEX "sales_document_lines_company_id_document_id_idx" ON "sales_document_lines"("company_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_document_lines_company_id_id_key" ON "sales_document_lines"("company_id", "id");

-- CreateIndex
CREATE INDEX "sales_document_sends_company_id_document_id_idx" ON "sales_document_sends"("company_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_document_sends_company_id_id_key" ON "sales_document_sends"("company_id", "id");

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_customer_id_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "customers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_source_document_id_fkey" FOREIGN KEY ("company_id", "source_document_id") REFERENCES "sales_documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "sales_documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_sends" ADD CONSTRAINT "sales_document_sends_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "sales_documents"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE billing_settings
  ADD CONSTRAINT billing_settings_payment_term CHECK (payment_term_days BETWEEN 0 AND 365),
  ADD CONSTRAINT billing_settings_vat_rate CHECK (default_vat_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT billing_settings_numbers CHECK (next_order_number > 0 AND next_invoice_number > 0);

ALTER TABLE sales_documents
  ADD CONSTRAINT sales_documents_language CHECK (language IN ('fi', 'en')),
  ADD CONSTRAINT sales_documents_due_date CHECK (due_date IS NULL OR due_date >= issue_date),
  -- An issued (or voided) document carries its number, totals and the PDF as issued.
  ADD CONSTRAINT sales_documents_issued CHECK (
    status = 'DRAFT' OR (number IS NOT NULL AND issued_at IS NOT NULL AND total_net IS NOT NULL AND total_vat IS NOT NULL
      AND total_gross IS NOT NULL AND pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  ADD CONSTRAINT sales_documents_draft CHECK (status <> 'DRAFT' OR (number IS NULL AND issued_at IS NULL)),
  ADD CONSTRAINT sales_documents_totals CHECK (total_gross IS NULL OR total_gross = total_net + total_vat),
  -- Invoices are corrected with a credit note, never voided (AVL 209 e §).
  ADD CONSTRAINT sales_documents_void CHECK (status <> 'VOID' OR (kind = 'ORDER_CONFIRMATION' AND voided_at IS NOT NULL)),
  ADD CONSTRAINT sales_documents_credit_source CHECK (kind <> 'CREDIT_NOTE' OR source_document_id IS NOT NULL),
  ADD CONSTRAINT sales_documents_send_count CHECK (send_count >= 0 AND (send_count = 0) = (sent_at IS NULL));

-- One number per series: order confirmations, and invoices together with credit notes.
CREATE UNIQUE INDEX sales_documents_order_number ON sales_documents (company_id, number) WHERE kind = 'ORDER_CONFIRMATION' AND number IS NOT NULL;
CREATE UNIQUE INDEX sales_documents_invoice_number ON sales_documents (company_id, number) WHERE kind IN ('INVOICE', 'CREDIT_NOTE') AND number IS NOT NULL;

ALTER TABLE sales_document_lines
  ADD CONSTRAINT sales_document_lines_quantity CHECK (quantity <> 0),
  ADD CONSTRAINT sales_document_lines_unit_price CHECK (unit_price >= 0),
  ADD CONSTRAINT sales_document_lines_discount CHECK (discount_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT sales_document_lines_vat_rate CHECK (vat_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT sales_document_lines_amount CHECK (amount = round(quantity * unit_price * (1 - discount_pct / 100), 2));

-- An issued document is immutable: only the void decision and the send
-- counters may change, and nothing is ever deleted.
CREATE FUNCTION sales_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'sent_at', 'send_count', 'voided_at', 'voided_by', 'void_reason', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales documents are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'VOID' THEN
      RAISE EXCEPTION 'a draft is archived, not voided' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'VOID' AND NEW.status <> 'VOID' THEN
    RAISE EXCEPTION 'a voided document stays void' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'an issued document cannot return to draft' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'an issued sales document is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.send_count < OLD.send_count THEN
    RAISE EXCEPTION 'the send count only grows' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_documents_guard BEFORE UPDATE OR DELETE ON sales_documents FOR EACH ROW EXECUTE FUNCTION sales_documents_guard();

-- Lines can only change while their document is a draft.
CREATE FUNCTION sales_document_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  doc_status "SalesDocumentStatus";
  row_ref sales_document_lines%ROWTYPE;
BEGIN
  row_ref := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT status INTO doc_status FROM sales_documents WHERE company_id = row_ref.company_id AND id = row_ref.document_id;
  IF doc_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'lines of an issued sales document are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.document_id <> OLD.document_id OR NEW.company_id <> OLD.company_id) THEN
    RAISE EXCEPTION 'a line cannot move to another document' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER sales_document_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines FOR EACH ROW EXECUTE FUNCTION sales_document_lines_guard();

-- The send log is append-only.
CREATE FUNCTION sales_document_sends_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sales_document_sends is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER sales_document_sends_append_only BEFORE UPDATE OR DELETE ON sales_document_sends FOR EACH ROW EXECUTE FUNCTION sales_document_sends_append_only();

-- ── Row-level security (ADR 0022) ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_settings', 'sales_documents', 'sales_document_lines', 'sales_document_sends'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sk_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
