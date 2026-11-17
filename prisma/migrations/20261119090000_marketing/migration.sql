-- Marketing automation (docs/adr/0032-marketing-automation.md): discovery
-- agent fills the marketing register (leads, sources, public business
-- contacts); the letter agent drafts targeted letters and call scripts that a
-- person approves before sending. Generated from prisma/schema.prisma;
-- integrity rules, row-level security and permissions below are hand-written.

-- CreateEnum
CREATE TYPE "MarketingCategory" AS ENUM ('DATA_CENTER', 'INDUSTRIAL', 'GRID', 'ENERGY', 'INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketingStage" AS ENUM ('PLANNING', 'PERMITTING', 'TENDERING', 'CONSTRUCTION', 'OPERATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MarketingSourceKind" AS ENUM ('TED', 'HILMA', 'GRID', 'WEB', 'MANUAL');

-- CreateEnum
CREATE TYPE "MarketingMessageStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MarketingCallStatus" AS ENUM ('TODO', 'CALLED', 'NO_ANSWER', 'NOT_INTERESTED', 'MEETING');

-- CreateEnum
CREATE TYPE "MarketingRunKind" AS ENUM ('DISCOVERY', 'DRAFT', 'SEND');

-- CreateEnum
CREATE TYPE "MarketingRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED_BUDGET');

-- CreateTable
CREATE TABLE "marketing_settings" (
    "company_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_send" BOOLEAN NOT NULL DEFAULT false,
    "countries" TEXT[] DEFAULT ARRAY['FI', 'SE', 'NO', 'DK', 'EE', 'LV', 'LT', 'DE', 'PL', 'NL']::TEXT[],
    "min_score" INTEGER NOT NULL DEFAULT 60,
    "daily_send_limit" INTEGER NOT NULL DEFAULT 20,
    "interval_hours" INTEGER NOT NULL DEFAULT 24,
    "ai_monthly_budget_eur" DECIMAL(14,2) NOT NULL DEFAULT 40,
    "reply_to_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "sender_name" TEXT,
    "pitch" TEXT,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "marketing_leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "category" "MarketingCategory" NOT NULL DEFAULT 'OTHER',
    "stage" "MarketingStage" NOT NULL DEFAULT 'UNKNOWN',
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    "country" CHAR(2),
    "location" TEXT,
    "owner_org" TEXT,
    "timing" TEXT,
    "start_date" DATE,
    "tender_deadline" DATE,
    "budget" DECIMAL(14,2),
    "currency" CHAR(3),
    "budget_text" TEXT,
    "voltage_kv" INTEGER,
    "fit_score" INTEGER NOT NULL DEFAULT 0,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fit_reason" TEXT,
    "opportunity_id" UUID,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "marketing_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_lead_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" "MarketingSourceKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "published_at" DATE,
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "organization" TEXT,
    "responsibility" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "marketing_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "call_script" TEXT,
    "status" "MarketingMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "call_status" "MarketingCallStatus",
    "call_note" TEXT,
    "called_at" TIMESTAMPTZ(6),
    "called_by" UUID,
    "unsubscribe_token" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "sent_to" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "marketing_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_suppressions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'UNSUBSCRIBE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "MarketingRunKind" NOT NULL,
    "source" TEXT,
    "status" "MarketingRunStatus" NOT NULL DEFAULT 'RUNNING',
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "started_by" UUID,

    CONSTRAINT "marketing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_leads_company_id_status_fit_score_idx" ON "marketing_leads"("company_id", "status", "fit_score");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_leads_company_id_id_key" ON "marketing_leads"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_leads_company_id_dedupe_key_key" ON "marketing_leads"("company_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "marketing_lead_sources_company_id_lead_id_idx" ON "marketing_lead_sources"("company_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_lead_sources_company_id_id_key" ON "marketing_lead_sources"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_lead_sources_company_id_kind_external_id_key" ON "marketing_lead_sources"("company_id", "kind", "external_id");

-- CreateIndex
CREATE INDEX "marketing_contacts_company_id_lead_id_idx" ON "marketing_contacts"("company_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_contacts_company_id_id_key" ON "marketing_contacts"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_messages_unsubscribe_token_key" ON "marketing_messages"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "marketing_messages_company_id_status_idx" ON "marketing_messages"("company_id", "status");

-- CreateIndex
CREATE INDEX "marketing_messages_company_id_lead_id_idx" ON "marketing_messages"("company_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_messages_company_id_id_key" ON "marketing_messages"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_suppressions_company_id_id_key" ON "marketing_suppressions"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_suppressions_company_id_email_key" ON "marketing_suppressions"("company_id", "email");

-- CreateIndex
CREATE INDEX "marketing_runs_company_id_started_at_idx" ON "marketing_runs"("company_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_runs_company_id_id_key" ON "marketing_runs"("company_id", "id");

-- AddForeignKey
ALTER TABLE "marketing_settings" ADD CONSTRAINT "marketing_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_leads" ADD CONSTRAINT "marketing_leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_leads" ADD CONSTRAINT "marketing_leads_company_id_opportunity_id_fkey" FOREIGN KEY ("company_id", "opportunity_id") REFERENCES "opportunities"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_lead_sources" ADD CONSTRAINT "marketing_lead_sources_company_id_lead_id_fkey" FOREIGN KEY ("company_id", "lead_id") REFERENCES "marketing_leads"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_company_id_lead_id_fkey" FOREIGN KEY ("company_id", "lead_id") REFERENCES "marketing_leads"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_messages" ADD CONSTRAINT "marketing_messages_company_id_lead_id_fkey" FOREIGN KEY ("company_id", "lead_id") REFERENCES "marketing_leads"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_messages" ADD CONSTRAINT "marketing_messages_company_id_contact_id_fkey" FOREIGN KEY ("company_id", "contact_id") REFERENCES "marketing_contacts"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_suppressions" ADD CONSTRAINT "marketing_suppressions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_runs" ADD CONSTRAINT "marketing_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "marketing_messages" ADD CONSTRAINT "marketing_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE marketing_settings
  ADD CONSTRAINT marketing_settings_min_score CHECK (min_score BETWEEN 0 AND 100),
  ADD CONSTRAINT marketing_settings_daily_limit CHECK (daily_send_limit BETWEEN 0 AND 200),
  ADD CONSTRAINT marketing_settings_interval CHECK (interval_hours BETWEEN 1 AND 168),
  ADD CONSTRAINT marketing_settings_budget CHECK (ai_monthly_budget_eur >= 0);
ALTER TABLE marketing_leads
  ADD CONSTRAINT marketing_leads_fit_score CHECK (fit_score BETWEEN 0 AND 100),
  ADD CONSTRAINT marketing_leads_budget CHECK (budget IS NULL OR budget >= 0),
  ADD CONSTRAINT marketing_leads_currency CHECK ((budget IS NULL) OR (currency IS NOT NULL));
ALTER TABLE marketing_messages
  ADD CONSTRAINT marketing_messages_sent CHECK (status <> 'SENT' OR (sent_at IS NOT NULL AND sent_to IS NOT NULL)),
  ADD CONSTRAINT marketing_messages_approved CHECK (status NOT IN ('APPROVED', 'SENDING', 'SENT') OR approved_at IS NOT NULL);
ALTER TABLE marketing_suppressions
  ADD CONSTRAINT marketing_suppressions_lower CHECK (email = lower(email));

-- ── Row-level security (ADR 0022) ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_settings', 'marketing_leads', 'marketing_lead_sources', 'marketing_contacts', 'marketing_messages', 'marketing_suppressions', 'marketing_runs'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sk_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

-- ── Permissions (src/platform/authz/permissions.ts) ──────────────────
-- Owner decision 2026-11-18: marketing only for the CEO and project manager roles.
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('marketing.view', 'commercial', 'View the marketing register, letters and call list', false),
  ('marketing.manage', 'commercial', 'Manage marketing settings, run the agents and edit the register and contacts', false),
  ('marketing.approve', 'commercial', 'Approve and send marketing letters', false);

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, g.permission_key, now()
FROM roles r
JOIN (VALUES
  ('CEO', 'marketing.view'), ('CEO', 'marketing.manage'), ('CEO', 'marketing.approve'),
  ('PROJECT_MANAGER', 'marketing.view'), ('PROJECT_MANAGER', 'marketing.manage'), ('PROJECT_MANAGER', 'marketing.approve')
) AS g(template_key, permission_key) ON g.template_key = r.template_key
ON CONFLICT DO NOTHING;
