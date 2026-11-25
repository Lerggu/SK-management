-- Serialized AI budget reservations (docs/adr/0035-ai-budget-holds.md): a run
-- reserves part of the company's monthly cap before it calls the provider, so
-- concurrent runs cannot all pass the cap check (V8 report §5).
-- Generated from prisma/schema.prisma; row-level security below is hand-written.

-- CreateEnum
CREATE TYPE "AiBudgetPool" AS ENUM ('AI', 'MARKETING');

-- CreateTable
CREATE TABLE "ai_budget_holds" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pool" "AiBudgetPool" NOT NULL,
    "amount_eur" DECIMAL(14,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_budget_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_budget_holds_company_id_pool_expires_at_idx" ON "ai_budget_holds"("company_id", "pool", "expires_at");

-- AddForeignKey
ALTER TABLE "ai_budget_holds" ADD CONSTRAINT "ai_budget_holds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE ai_budget_holds
  ADD CONSTRAINT ai_budget_holds_amount CHECK (amount_eur > 0);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_budget_holds TO sk_app;
ALTER TABLE ai_budget_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_budget_holds USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
