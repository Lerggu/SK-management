-- Site map in production control (docs/adr/0034-site-map.md): an overview
-- image per site, objects on it (gates with their codes, cranes, storage …),
-- logistics tasks pinned to it, and deviations that concern an object.
-- Generated from prisma/schema.prisma; integrity rules and row-level security
-- below are hand-written.

-- CreateEnum
CREATE TYPE "SiteMapObjectKind" AS ENUM ('GATE', 'UNLOADING', 'STORAGE', 'CRANE', 'LIFT_AREA', 'SITE_OFFICE', 'PARKING', 'WASTE', 'DANGER_ZONE', 'OTHER');

-- AlterTable
ALTER TABLE "logistics_deviations" ADD COLUMN     "map_object_id" UUID,
ALTER COLUMN "request_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "site_maps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "title" TEXT,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width_px" INTEGER NOT NULL,
    "height_px" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" UUID,

    CONSTRAINT "site_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_map_objects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "SiteMapObjectKind" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "location_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "site_map_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_map_task_pins" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "object_id" UUID,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "site_map_task_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logistics_deviations_company_id_map_object_id_status_idx" ON "logistics_deviations"("company_id", "map_object_id", "status");

-- CreateIndex
CREATE INDEX "site_maps_company_id_site_id_idx" ON "site_maps"("company_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_maps_company_id_id_key" ON "site_maps"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_objects_location_id_key" ON "site_map_objects"("location_id");

-- CreateIndex
CREATE INDEX "site_map_objects_company_id_site_id_archived_at_idx" ON "site_map_objects"("company_id", "site_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_objects_company_id_id_key" ON "site_map_objects"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_objects_company_id_project_id_id_key" ON "site_map_objects"("company_id", "project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_objects_company_id_site_id_id_key" ON "site_map_objects"("company_id", "site_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_objects_company_id_site_id_location_id_key" ON "site_map_objects"("company_id", "site_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_task_pins_request_id_key" ON "site_map_task_pins"("request_id");

-- CreateIndex
CREATE INDEX "site_map_task_pins_company_id_site_id_idx" ON "site_map_task_pins"("company_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_task_pins_company_id_id_key" ON "site_map_task_pins"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_map_task_pins_company_id_site_id_request_id_key" ON "site_map_task_pins"("company_id", "site_id", "request_id");

-- AddForeignKey
ALTER TABLE "logistics_deviations" ADD CONSTRAINT "logistics_deviations_company_id_project_id_map_object_id_fkey" FOREIGN KEY ("company_id", "project_id", "map_object_id") REFERENCES "site_map_objects"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_objects" ADD CONSTRAINT "site_map_objects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_objects" ADD CONSTRAINT "site_map_objects_company_id_project_id_site_id_fkey" FOREIGN KEY ("company_id", "project_id", "site_id") REFERENCES "sites"("company_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_objects" ADD CONSTRAINT "site_map_objects_company_id_site_id_location_id_fkey" FOREIGN KEY ("company_id", "site_id", "location_id") REFERENCES "logistics_locations"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_task_pins" ADD CONSTRAINT "site_map_task_pins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_task_pins" ADD CONSTRAINT "site_map_task_pins_company_id_site_id_request_id_fkey" FOREIGN KEY ("company_id", "site_id", "request_id") REFERENCES "logistics_requests"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_map_task_pins" ADD CONSTRAINT "site_map_task_pins_company_id_site_id_object_id_fkey" FOREIGN KEY ("company_id", "site_id", "object_id") REFERENCES "site_map_objects"("company_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules ──────────────────────────────────────────────────
-- A deviation concerns a task, a map object, or both.
ALTER TABLE logistics_deviations
  ADD CONSTRAINT logistics_deviations_subject CHECK (request_id IS NOT NULL OR map_object_id IS NOT NULL);

-- One active map per site.
CREATE UNIQUE INDEX site_maps_one_active ON site_maps (company_id, site_id) WHERE archived_at IS NULL;
ALTER TABLE site_maps
  ADD CONSTRAINT site_maps_size CHECK (width_px BETWEEN 1 AND 20000 AND height_px BETWEEN 1 AND 20000 AND size_bytes > 0);

-- Positions are fractions of the map image; an area stays inside it.
ALTER TABLE site_map_objects
  ADD CONSTRAINT site_map_objects_position CHECK (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1),
  ADD CONSTRAINT site_map_objects_area CHECK ((width IS NULL) = (height IS NULL) AND (width IS NULL OR (width > 0 AND height > 0 AND x + width <= 1.000001 AND y + height <= 1.000001))),
  ADD CONSTRAINT site_map_objects_location_kind CHECK (location_id IS NULL OR kind IN ('GATE', 'UNLOADING', 'STORAGE'));
-- A code identifies one active object on a site (P1, N2 …), case-insensitively.
CREATE UNIQUE INDEX site_map_objects_code ON site_map_objects (company_id, site_id, lower(code)) WHERE code IS NOT NULL AND archived_at IS NULL;

ALTER TABLE site_map_task_pins
  ADD CONSTRAINT site_map_task_pins_position CHECK (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_maps', 'site_map_objects', 'site_map_task_pins'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sk_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
