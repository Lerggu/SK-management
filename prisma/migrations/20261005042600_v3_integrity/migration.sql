-- V3 integrity objects that Prisma does not model.
-- Documented in docs/adr/0012-takt-plan-versioning.md.

-- ── calendars ────────────────────────────────────────────────────────
ALTER TABLE work_calendars
  ADD CONSTRAINT work_calendars_weekdays CHECK (
    cardinality(working_weekdays) BETWEEN 1 AND 7 AND working_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
  );
CREATE UNIQUE INDEX work_calendars_one_default ON work_calendars (company_id) WHERE is_default AND archived_at IS NULL;

-- ── structure ────────────────────────────────────────────────────────
ALTER TABLE work_packages
  ADD CONSTRAINT work_packages_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT work_packages_crew_range CHECK (default_crew_size BETWEEN 0 AND 500),
  ADD CONSTRAINT work_packages_duration_range CHECK (default_duration_cycles BETWEEN 1 AND 365),
  ADD CONSTRAINT work_packages_equipment CHECK (equipment_count BETWEEN 0 AND 100 AND (equipment_count = 0 OR equipment_type_id IS NOT NULL));

ALTER TABLE takt_plans
  ADD CONSTRAINT takt_plans_cycle_length CHECK (cycle_length_days BETWEEN 1 AND 20);

ALTER TABLE takt_activities
  ADD CONSTRAINT takt_activities_progress CHECK (progress_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT takt_activities_crew CHECK (crew_size BETWEEN 0 AND 500),
  ADD CONSTRAINT takt_activities_equipment CHECK (equipment_count BETWEEN 0 AND 100 AND (equipment_count = 0 OR equipment_type_id IS NOT NULL)),
  ADD CONSTRAINT takt_activities_actuals CHECK (actual_end IS NULL OR (actual_start IS NOT NULL AND actual_end >= actual_start)),
  ADD CONSTRAINT takt_activities_complete CHECK (execution <> 'COMPLETE' OR (progress_pct = 100 AND actual_end IS NOT NULL));

ALTER TABLE takt_assignments
  ADD CONSTRAINT takt_assignments_range CHECK (start_cycle BETWEEN 0 AND 3650 AND duration_cycles BETWEEN 1 AND 365);

ALTER TABLE activity_dependencies
  ADD CONSTRAINT activity_dependencies_not_self CHECK (predecessor_id <> successor_id),
  ADD CONSTRAINT activity_dependencies_lag CHECK (lag_days BETWEEN -365 AND 365);

ALTER TABLE activity_progress
  ADD CONSTRAINT activity_progress_pct CHECK (progress_pct BETWEEN 0 AND 100);

ALTER TABLE resource_requirements
  ADD CONSTRAINT resource_requirements_kind CHECK (
    (kind = 'TRADE' AND trade IS NOT NULL AND equipment_type_id IS NULL)
    OR (kind = 'EQUIPMENT_TYPE' AND equipment_type_id IS NOT NULL AND trade IS NULL)
  ),
  ADD CONSTRAINT resource_requirements_quantity CHECK (quantity > 0),
  ADD CONSTRAINT resource_requirements_dates CHECK (end_date >= start_date);

ALTER TABLE schedule_imports
  ADD CONSTRAINT schedule_imports_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- ── plan versions ────────────────────────────────────────────────────
-- One baseline and at most one open (draft/proposed) version per plan.
CREATE UNIQUE INDEX takt_plan_versions_one_baseline ON takt_plan_versions (plan_id) WHERE status = 'BASELINE';
CREATE UNIQUE INDEX takt_plan_versions_one_open ON takt_plan_versions (plan_id) WHERE status IN ('DRAFT', 'PROPOSED');

ALTER TABLE takt_plan_versions
  ADD CONSTRAINT takt_plan_versions_number CHECK (version_number >= 1);

-- A baseline is never silently overwritten: BASELINE and SUPERSEDED versions
-- are frozen except BASELINE → SUPERSEDED (stamping superseded_at). Allowed
-- transitions: DRAFT ↔ PROPOSED, PROPOSED → BASELINE. Only drafts can be
-- deleted.
CREATE OR REPLACE FUNCTION takt_plan_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft plan versions can be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'plan versions start as drafts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'superseded plan versions are frozen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'BASELINE' THEN
    IF NEW.status = 'SUPERSEDED'
       AND NEW.plan_id = OLD.plan_id AND NEW.version_number = OLD.version_number
       AND NEW.start_date = OLD.start_date
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason
       AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
       AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the baseline is frozen; create a new plan version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'DRAFT' AND NEW.status = 'PROPOSED')
    OR (OLD.status = 'PROPOSED' AND NEW.status IN ('DRAFT', 'BASELINE'))
  ) THEN
    RAISE EXCEPTION 'invalid plan version transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'PROPOSED' AND NEW.status = 'PROPOSED' AND NEW.start_date <> OLD.start_date THEN
    RAISE EXCEPTION 'a proposed version cannot be edited; return it to draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER takt_plan_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON takt_plan_versions
  FOR EACH ROW EXECUTE FUNCTION takt_plan_versions_guard();

-- Assignments change only while their version is a draft (a deleted draft
-- cascades its assignments).
CREATE OR REPLACE FUNCTION takt_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM takt_plan_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'plan assignments can only change while the version is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER takt_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON takt_assignments
  FOR EACH ROW EXECUTE FUNCTION takt_assignments_guard();

-- Resource requirements are generated once, when a version becomes the
-- baseline, and never changed.
CREATE OR REPLACE FUNCTION resource_requirements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'resource requirements are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT status INTO parent_status FROM takt_plan_versions WHERE id = NEW.version_id;
  IF parent_status IS DISTINCT FROM 'BASELINE' THEN
    RAISE EXCEPTION 'resource requirements belong to a baseline version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resource_requirements_guard
  BEFORE INSERT OR UPDATE OR DELETE ON resource_requirements
  FOR EACH ROW EXECUTE FUNCTION resource_requirements_guard();

-- Progress history is append-only.
CREATE OR REPLACE FUNCTION activity_progress_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity progress history is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER activity_progress_guard
  BEFORE UPDATE OR DELETE ON activity_progress
  FOR EACH ROW EXECUTE FUNCTION activity_progress_guard();

-- Activities are archived, never deleted (progress and requirements refer to them).
CREATE OR REPLACE FUNCTION takt_activities_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'takt activities cannot be deleted (archive instead)' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER takt_activities_no_delete
  BEFORE DELETE ON takt_activities
  FOR EACH ROW EXECUTE FUNCTION takt_activities_no_delete();
