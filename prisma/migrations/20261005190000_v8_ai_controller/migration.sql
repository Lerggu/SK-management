-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('REVIEW', 'QUESTION');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED_BUDGET');

-- CreateEnum
CREATE TYPE "AiSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiRecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "ai_monthly_budget_eur" DECIMAL(14,2) NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "question" TEXT,
    "locale" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "severity" "AiSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" "AiRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_company_id_created_at_idx" ON "ai_runs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_company_id_project_id_created_at_idx" ON "ai_runs"("company_id", "project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_runs_company_id_id_key" ON "ai_runs"("company_id", "id");

-- CreateIndex
CREATE INDEX "ai_recommendations_company_id_project_id_status_idx" ON "ai_recommendations"("company_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_recommendations_company_id_id_key" ON "ai_recommendations"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_recommendations_run_id_position_key" ON "ai_recommendations"("run_id", "position");

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_company_id_run_id_fkey" FOREIGN KEY ("company_id", "run_id") REFERENCES "ai_runs"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── V8 integrity (docs/adr/0023-ai-project-controller.md) ─────────────
ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_tokens_non_negative CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0),
  ADD CONSTRAINT ai_runs_cost_non_negative CHECK (cost_eur >= 0),
  ADD CONSTRAINT ai_runs_question_kind CHECK ((kind = 'QUESTION') = (question IS NOT NULL));

ALTER TABLE companies
  ADD CONSTRAINT companies_ai_budget_non_negative CHECK (ai_monthly_budget_eur >= 0);

-- A recommendation is decided once: decision fields are set together.
ALTER TABLE ai_recommendations
  ADD CONSTRAINT ai_recommendations_decision CHECK ((status = 'PROPOSED') = (decided_at IS NULL));

-- AI runs are an append-only record of what was asked and answered.
CREATE OR REPLACE FUNCTION ai_runs_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_runs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER ai_runs_block_update_delete
  BEFORE UPDATE OR DELETE ON ai_runs
  FOR EACH ROW EXECUTE FUNCTION ai_runs_block_mutation();

-- ── Row-level security (ADR 0022): same tenant policy as every company table.
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_runs, ai_recommendations TO sk_app;

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_runs
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_recommendations
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ── Permission ai.use (owner decision: only users entitled to the project
-- controller; sensitive, so never granted to external parties).
INSERT INTO permissions (key, category, description, is_sensitive) VALUES
  ('ai.use', 'ai', 'Use the AI project controller (sends project data the user can see to the AI provider)', true);

INSERT INTO role_permissions (company_id, role_id, permission_key, created_at)
SELECT r.company_id, r.id, 'ai.use', now()
FROM roles r
WHERE r.template_key IN ('CEO', 'PROJECT_DIRECTOR', 'PROJECT_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO audit_events (id, occurred_at, organization_id, company_id, actor_type, action, entity_type, after, metadata)
SELECT gen_random_uuid(), now(), c.organization_id, c.id, 'SYSTEM', 'role.permissions_migration', 'role',
       jsonb_build_object('release', 'V8', 'granted', jsonb_build_object('ai.use', jsonb_build_array('CEO', 'PROJECT_DIRECTOR', 'PROJECT_MANAGER')), 'aiMonthlyBudgetEur', c.ai_monthly_budget_eur),
       jsonb_build_object('migration', '20261005190000_v8_ai_controller')
FROM companies c;
