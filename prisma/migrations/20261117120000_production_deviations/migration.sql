-- Production control, phase 3: deviations of logistics tasks reported from
-- the phone, with photos (docs/adr/0026-production-control.md). Generated
-- from prisma/schema.prisma; integrity rules and row-level security below
-- are hand-written. No new permissions: members who see logistics report,
-- logistics approvers acknowledge and resolve.

-- CreateEnum
CREATE TYPE "DeviationType" AS ENUM ('LATE_DELIVERY', 'RESOURCE_MISSING', 'EQUIPMENT_FAULT', 'WEATHER', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "logistics_deviations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "type" "DeviationType" NOT NULL,
    "comment" TEXT,
    "status" "DeviationStatus" NOT NULL DEFAULT 'OPEN',
    "reported_by" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution" TEXT,
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "logistics_deviations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_deviation_photos" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "deviation_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "logistics_deviation_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logistics_deviations_company_id_request_id_status_idx" ON "logistics_deviations"("company_id", "request_id", "status");

-- CreateIndex
CREATE INDEX "logistics_deviations_company_id_status_created_at_idx" ON "logistics_deviations"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_deviations_company_id_id_key" ON "logistics_deviations"("company_id", "id");

-- CreateIndex
CREATE INDEX "logistics_deviation_photos_company_id_deviation_id_idx" ON "logistics_deviation_photos"("company_id", "deviation_id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_deviation_photos_company_id_id_key" ON "logistics_deviation_photos"("company_id", "id");

-- AddForeignKey
ALTER TABLE "logistics_deviations" ADD CONSTRAINT "logistics_deviations_company_id_request_id_fkey" FOREIGN KEY ("company_id", "request_id") REFERENCES "logistics_requests"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_deviation_photos" ADD CONSTRAINT "logistics_deviation_photos_company_id_deviation_id_fkey" FOREIGN KEY ("company_id", "deviation_id") REFERENCES "logistics_deviations"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE logistics_deviations
  ADD CONSTRAINT logistics_deviations_ack CHECK ((status = 'OPEN') = (acknowledged_at IS NULL) OR status = 'RESOLVED'),
  ADD CONSTRAINT logistics_deviations_resolved CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL));

-- Deviations are kept: never deleted.
CREATE OR REPLACE FUNCTION logistics_deviations_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'logistics deviations are never deleted' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER logistics_deviations_no_delete BEFORE DELETE ON logistics_deviations
  FOR EACH ROW EXECUTE FUNCTION logistics_deviations_no_delete();

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON logistics_deviations, logistics_deviation_photos TO sk_app;

ALTER TABLE logistics_deviations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON logistics_deviations
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

ALTER TABLE logistics_deviation_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON logistics_deviation_photos
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
