-- Teams of employees (docs/adr/0029-teams.md). Generated from prisma/schema.prisma;
-- integrity rules, row-level security and the conversion of the existing
-- free-text team names into teams are hand-written.

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "team_id" UUID;

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'sky',
    "leader_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_company_id_archived_at_idx" ON "teams"("company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "teams_company_id_id_key" ON "teams"("company_id", "id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_team_id_fkey" FOREIGN KEY ("company_id", "team_id") REFERENCES "teams"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_leader_id_fkey" FOREIGN KEY ("company_id", "leader_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules ──────────────────────────────────────────────────
-- One active team per name in a company (archived names can be reused).
CREATE UNIQUE INDEX teams_company_active_name_key ON teams (company_id, lower(name)) WHERE archived_at IS NULL;
ALTER TABLE teams
  ADD CONSTRAINT teams_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  ADD CONSTRAINT teams_color CHECK (color IN ('slate', 'sky', 'amber', 'emerald', 'violet', 'rose', 'orange', 'teal'));
CREATE INDEX employees_company_id_team_id_idx ON employees (company_id, team_id);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO sk_app;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON teams
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ── Existing free-text team names become teams ───────────────────────
INSERT INTO teams (id, company_id, name, created_at, updated_at)
SELECT gen_random_uuid(), x.company_id, x.name, now(), now()
FROM (
  SELECT DISTINCT ON (company_id, lower(btrim(team))) company_id, btrim(team) AS name
  FROM employees
  WHERE team IS NOT NULL AND btrim(team) <> ''
  ORDER BY company_id, lower(btrim(team)), btrim(team)
) x;

UPDATE employees e
SET team_id = t.id, team = t.name
FROM teams t
WHERE t.company_id = e.company_id AND e.team IS NOT NULL AND lower(btrim(e.team)) = lower(t.name);

UPDATE employees SET team = NULL WHERE team_id IS NULL AND team IS NOT NULL;
