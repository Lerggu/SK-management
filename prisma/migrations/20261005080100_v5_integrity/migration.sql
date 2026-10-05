-- V5 integrity objects that Prisma does not model.
-- Documented in docs/adr/0016-lift-plans.md and 0017-material-and-cable-drums.md.

-- ── lifting accessories ──────────────────────────────────────────────
ALTER TABLE lifting_accessories
  ADD CONSTRAINT lifting_accessories_wll CHECK (wll_kg > 0);

-- ── lift plans ───────────────────────────────────────────────────────
ALTER TABLE lift_plans
  ADD CONSTRAINT lift_plans_period CHECK (planned_end > planned_start),
  ADD CONSTRAINT lift_plans_completion CHECK (
    (status = 'COMPLETED') = (completed_at IS NOT NULL)
  );

ALTER TABLE lift_plan_versions
  ADD CONSTRAINT lift_plan_versions_number CHECK (version_number >= 1),
  ADD CONSTRAINT lift_plan_versions_positive CHECK (
    (load_weight_kg IS NULL OR load_weight_kg > 0)
    AND (rigging_weight_kg IS NULL OR rigging_weight_kg >= 0)
    AND (radius_m IS NULL OR radius_m > 0)
    AND (crane_capacity_kg IS NULL OR crane_capacity_kg > 0)
    AND (safety_distance_m IS NULL OR safety_distance_m >= 0)
  );

-- At most one approved and at most one open (draft/submitted) version per plan.
CREATE UNIQUE INDEX lift_plan_versions_one_approved ON lift_plan_versions (plan_id) WHERE status = 'APPROVED';
CREATE UNIQUE INDEX lift_plan_versions_one_open ON lift_plan_versions (plan_id) WHERE status IN ('DRAFT', 'SUBMITTED');

-- An approved lift plan is locked: APPROVED and SUPERSEDED versions are
-- frozen except APPROVED → SUPERSEDED; REJECTED versions are final. Allowed
-- transitions: DRAFT → SUBMITTED, SUBMITTED → DRAFT | APPROVED | REJECTED.
-- Only DRAFT versions are editable. The approver can never be the person
-- who submitted the version. Versions are never deleted.
CREATE OR REPLACE FUNCTION lift_plan_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lift plan versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'lift plan versions start as drafts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.plan_id <> OLD.plan_id OR NEW.company_id <> OLD.company_id OR NEW.version_number <> OLD.version_number THEN
    RAISE EXCEPTION 'lift plan version identity cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'REJECTED') THEN
    RAISE EXCEPTION 'superseded or rejected lift plan versions are frozen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'APPROVED' THEN
    IF NEW.status = 'SUPERSEDED'
       AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by') = (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'an approved lift plan is locked; create a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('DRAFT', 'APPROVED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'invalid lift plan version transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'SUBMITTED'
     AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by' - 'decided_at' - 'decided_by' - 'decision_note' - 'submitted_at' - 'submitted_by')
       <> (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by' - 'decided_at' - 'decided_by' - 'decision_note' - 'submitted_at' - 'submitted_by') THEN
    RAISE EXCEPTION 'a submitted lift plan cannot be edited; return it to draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    IF NEW.decided_by IS NULL OR NEW.decided_by IS NOT DISTINCT FROM NEW.submitted_by THEN
      RAISE EXCEPTION 'a lift plan cannot be approved by the person who submitted it' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lift_plan_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON lift_plan_versions
  FOR EACH ROW EXECUTE FUNCTION lift_plan_versions_guard();

-- Accessories change only while their version is a draft.
ALTER TABLE lift_plan_accessories
  ADD CONSTRAINT lift_plan_accessories_count CHECK (count BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION lift_plan_accessories_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM lift_plan_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'lift plan accessories can only change while the version is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lift_plan_accessories_guard
  BEFORE INSERT OR UPDATE OR DELETE ON lift_plan_accessories
  FOR EACH ROW EXECUTE FUNCTION lift_plan_accessories_guard();

-- A lift is completed only with an approved plan version (acceptance
-- criterion 1); completed and cancelled lifts are final.
CREATE OR REPLACE FUNCTION lift_plans_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lift plans cannot be deleted (cancel instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'lift plans start open' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.company_id <> OLD.company_id OR NEW.site_id <> OLD.site_id OR NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'a lift plan cannot move to another site' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'completed or cancelled lifts are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM lift_plan_versions v WHERE v.plan_id = NEW.id AND v.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'a lift cannot be carried out without an approved lift plan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lift_plans_guard
  BEFORE INSERT OR UPDATE OR DELETE ON lift_plans
  FOR EACH ROW EXECUTE FUNCTION lift_plans_guard();

-- ── material batches ─────────────────────────────────────────────────
ALTER TABLE material_batches
  ADD CONSTRAINT material_batches_quantity CHECK (quantity > 0);

-- ── append-only logs ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION v5_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER material_movements_append_only
  BEFORE UPDATE OR DELETE ON material_movements
  FOR EACH ROW EXECUTE FUNCTION v5_append_only();

CREATE TRIGGER cable_pulls_append_only
  BEFORE UPDATE OR DELETE ON cable_pulls
  FOR EACH ROW EXECUTE FUNCTION v5_append_only();

-- ── cable drums (owner decision 2: metres per pull) ──────────────────
ALTER TABLE cable_drums
  ADD CONSTRAINT cable_drums_length CHECK (original_length_m > 0),
  ADD CONSTRAINT cable_drums_remaining CHECK (remaining_m >= 0 AND remaining_m <= original_length_m),
  ADD CONSTRAINT cable_drums_weight CHECK (weight_kg IS NULL OR weight_kg > 0);

ALTER TABLE cable_pulls
  ADD CONSTRAINT cable_pulls_length CHECK (length_m > 0);

-- Remaining length is never written directly: it starts at the original
-- length and only a pull decrements it. A pull longer than the remaining
-- length fails on the CHECK above.
CREATE OR REPLACE FUNCTION cable_drums_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cable drums cannot be deleted (archive instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.remaining_m := NEW.original_length_m;
    RETURN NEW;
  END IF;
  IF NEW.original_length_m <> OLD.original_length_m THEN
    RAISE EXCEPTION 'the original drum length cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.remaining_m <> OLD.remaining_m AND current_setting('sk.cable_pull', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'remaining length changes only through a cable pull' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.site_id <> OLD.site_id OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'a cable drum cannot move to another site' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cable_drums_guard
  BEFORE INSERT OR UPDATE OR DELETE ON cable_drums
  FOR EACH ROW EXECUTE FUNCTION cable_drums_guard();

CREATE OR REPLACE FUNCTION cable_pulls_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('sk.cable_pull', 'on', true);
  UPDATE cable_drums
     SET remaining_m = remaining_m - NEW.length_m,
         status = CASE WHEN remaining_m - NEW.length_m = 0 THEN 'EMPTY'::"CableDrumStatus"
                       WHEN status = 'IN_STOCK' THEN 'IN_USE'::"CableDrumStatus"
                       ELSE status END
   WHERE id = NEW.drum_id AND company_id = NEW.company_id;
  PERFORM set_config('sk.cable_pull', 'off', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER cable_pulls_apply
  AFTER INSERT ON cable_pulls
  FOR EACH ROW EXECUTE FUNCTION cable_pulls_apply();
