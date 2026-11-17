-- Voice/text assistant (docs/adr/0031-assistant.md). Generated from
-- prisma/schema.prisma; row-level security is hand-written.

-- CreateEnum
CREATE TYPE "AssistantActionStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED', 'FAILED');

-- AlterEnum
ALTER TYPE "AiRunKind" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "ai_runs" ALTER COLUMN "project_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_actions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "money" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssistantActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "assistant_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_company_id_user_id_updated_at_idx" ON "assistant_conversations"("company_id", "user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_conversations_company_id_id_key" ON "assistant_conversations"("company_id", "id");

-- CreateIndex
CREATE INDEX "assistant_actions_company_id_conversation_id_position_idx" ON "assistant_actions"("company_id", "conversation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_actions_company_id_id_key" ON "assistant_actions"("company_id", "id");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_company_id_conversation_id_fkey" FOREIGN KEY ("company_id", "conversation_id") REFERENCES "assistant_conversations"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE assistant_actions
  ADD CONSTRAINT assistant_actions_decided CHECK ((status = 'PROPOSED') = (decided_at IS NULL)),
  ADD CONSTRAINT assistant_actions_summary_length CHECK (char_length(summary) <= 500);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_conversations, assistant_actions TO sk_app;
ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_conversations
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_actions
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
