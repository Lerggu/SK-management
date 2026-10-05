-- V7 integrity objects that Prisma does not model.
-- Documented in docs/adr/0020-external-access-and-portals.md and
-- docs/adr/0021-hse-workflows.md.

-- ── checks ───────────────────────────────────────────────────────────
ALTER TABLE hse_observations ADD CONSTRAINT hse_observations_number CHECK (number >= 1);
ALTER TABLE incidents
  ADD CONSTRAINT incidents_number CHECK (number >= 1),
  ADD CONSTRAINT incidents_lost_days CHECK (lost_days IS NULL OR lost_days >= 0);
ALTER TABLE incident_persons ADD CONSTRAINT incident_persons_absence CHECK (absence_days IS NULL OR absence_days >= 0);
ALTER TABLE toolbox_talks ADD CONSTRAINT toolbox_talks_attendees CHECK (attendee_count >= 0);
ALTER TABLE risk_assessment_items
  ADD CONSTRAINT risk_items_scale CHECK (
    likelihood BETWEEN 1 AND 5 AND consequence BETWEEN 1 AND 5
    AND (residual_likelihood IS NULL OR residual_likelihood BETWEEN 1 AND 5)
    AND (residual_consequence IS NULL OR residual_consequence BETWEEN 1 AND 5)
  );
ALTER TABLE work_permits
  ADD CONSTRAINT work_permits_number CHECK (number >= 1),
  ADD CONSTRAINT work_permits_validity CHECK (valid_to > valid_from);
ALTER TABLE hse_inspections ADD CONSTRAINT hse_inspections_counts CHECK (correct_count >= 0 AND incorrect_count >= 0 AND correct_count + incorrect_count > 0);
ALTER TABLE variation_client_approvals
  ADD CONSTRAINT client_approvals_hash CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT client_approvals_decided CHECK (
    (decision = 'PENDING' AND decided_at IS NULL AND channel IS NULL)
    OR (decision = 'WITHDRAWN' AND decided_at IS NOT NULL)
    OR (decision IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL AND channel IS NOT NULL)
  );
ALTER TABLE email_sign_in_tokens ADD CONSTRAINT email_tokens_expiry CHECK (expires_at > created_at);
-- Only project documents can be shared with external parties.
ALTER TABLE documents ADD CONSTRAINT documents_external_share CHECK (project_id IS NOT NULL OR (NOT shared_with_client AND NOT shared_with_subcontractors));

-- At most one pending client approval per variation.
CREATE UNIQUE INDEX variation_client_approvals_one_pending ON variation_client_approvals (variation_id) WHERE decision = 'PENDING';

-- ── observations ─────────────────────────────────────────────────────
-- OPEN → TRIAGED | CLOSED; TRIAGED → CLOSED. Closed records are final.
CREATE OR REPLACE FUNCTION hse_observations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HSE observations cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'HSE observations start as OPEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'a closed HSE observation is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'OPEN' AND NEW.status IN ('TRIAGED', 'CLOSED'))
          OR (OLD.status = 'TRIAGED' AND NEW.status = 'CLOSED')) THEN
    RAISE EXCEPTION 'invalid HSE observation transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.number <> OLD.number OR NEW.project_id <> OLD.project_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'reporter, number, project and kind of an HSE observation cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hse_observations_guard BEFORE INSERT OR UPDATE OR DELETE ON hse_observations FOR EACH ROW EXECUTE FUNCTION hse_observations_guard();

-- ── incidents ────────────────────────────────────────────────────────
-- REPORTED → TRIAGED; TRIAGED → INVESTIGATING | CLOSED; INVESTIGATING →
-- CLOSED. Lost-time and serious incidents close only after investigation
-- with a root cause. No incident closes while a corrective action of it is
-- not VERIFIED (approved).
CREATE OR REPLACE FUNCTION incidents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'incidents cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REPORTED' THEN
      RAISE EXCEPTION 'incidents start as REPORTED' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'a closed incident is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'REPORTED' AND NEW.status = 'TRIAGED')
          OR (OLD.status = 'TRIAGED' AND NEW.status IN ('INVESTIGATING', 'CLOSED'))
          OR (OLD.status = 'INVESTIGATING' AND NEW.status = 'CLOSED')) THEN
    RAISE EXCEPTION 'invalid incident transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.number <> OLD.number OR NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'reporter, number and project of an incident cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'CLOSED' THEN
    IF NEW.severity IN ('LOST_TIME', 'SERIOUS') AND (OLD.status <> 'INVESTIGATING' OR NEW.root_cause IS NULL OR btrim(NEW.root_cause) = '') THEN
      RAISE EXCEPTION 'lost-time and serious incidents close only after an investigation with a root cause' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM hse_actions a WHERE a.company_id = NEW.company_id AND a.source_type = 'INCIDENT' AND a.source_id = NEW.id AND a.status <> 'VERIFIED') THEN
      RAISE EXCEPTION 'an incident cannot close while corrective actions are unapproved' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER incidents_guard BEFORE INSERT OR UPDATE OR DELETE ON incidents FOR EACH ROW EXECUTE FUNCTION incidents_guard();

-- ── corrective actions ───────────────────────────────────────────────
-- The source record must exist in the same company and project. OPEN →
-- DONE; DONE → OPEN | VERIFIED. Verified actions are final.
CREATE OR REPLACE FUNCTION hse_actions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HSE actions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'HSE actions start as OPEN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    ok := CASE NEW.source_type
      WHEN 'OBSERVATION' THEN EXISTS (SELECT 1 FROM hse_observations s WHERE s.id = NEW.source_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id AND s.status <> 'CLOSED')
      WHEN 'INCIDENT' THEN EXISTS (SELECT 1 FROM incidents s WHERE s.id = NEW.source_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id AND s.status <> 'CLOSED')
      WHEN 'INSPECTION' THEN EXISTS (SELECT 1 FROM hse_inspections s WHERE s.id = NEW.source_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
      WHEN 'RISK_ASSESSMENT' THEN EXISTS (SELECT 1 FROM risk_assessments s WHERE s.id = NEW.source_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
    END;
    IF NOT ok THEN
      RAISE EXCEPTION 'HSE action source not found or closed' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'VERIFIED' THEN
    RAISE EXCEPTION 'a verified HSE action is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.source_type <> OLD.source_type OR NEW.source_id <> OLD.source_id OR NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'the source of an HSE action cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'OPEN' AND NEW.status = 'DONE')
          OR (OLD.status = 'DONE' AND NEW.status IN ('OPEN', 'VERIFIED'))) THEN
    RAISE EXCEPTION 'invalid HSE action transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hse_actions_guard BEFORE INSERT OR UPDATE OR DELETE ON hse_actions FOR EACH ROW EXECUTE FUNCTION hse_actions_guard();

-- ── risk assessments ─────────────────────────────────────────────────
-- DRAFT → APPROVED (by someone other than the author) → ARCHIVED. Content
-- and items are frozen once approved.
CREATE OR REPLACE FUNCTION risk_assessments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meta_cols text[] := ARRAY['status', 'updated_at', 'updated_by', 'archived_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk assessments cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'risk assessments start as drafts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' AND (to_jsonb(NEW) - meta_cols) <> (to_jsonb(OLD) - meta_cols) THEN
    RAISE EXCEPTION 'an approved risk assessment is frozen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'ARCHIVED'))
          OR (OLD.status = 'APPROVED' AND NEW.status = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'invalid risk assessment transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'ARCHIVED' AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'an archived risk assessment is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status = 'DRAFT'
     AND (NEW.approved_by IS NULL OR NEW.approved_by IS NOT DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'a risk assessment cannot be approved by its author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER risk_assessments_guard BEFORE INSERT OR UPDATE OR DELETE ON risk_assessments FOR EACH ROW EXECUTE FUNCTION risk_assessments_guard();

CREATE OR REPLACE FUNCTION risk_assessment_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.risk_assessment_id ELSE NEW.risk_assessment_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.risk_assessment_id <> OLD.risk_assessment_id THEN
    RAISE EXCEPTION 'risk items cannot move between assessments' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM risk_assessments r WHERE r.id = parent_id AND r.status = 'DRAFT') THEN
    RAISE EXCEPTION 'risk items can change only while the assessment is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER risk_assessment_items_guard BEFORE INSERT OR UPDATE OR DELETE ON risk_assessment_items FOR EACH ROW EXECUTE FUNCTION risk_assessment_items_guard();

-- ── permits to work ──────────────────────────────────────────────────
-- REQUESTED → APPROVED | REJECTED; APPROVED → CLOSED. The requester cannot
-- decide their own permit; content is frozen once decided.
CREATE OR REPLACE FUNCTION work_permits_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meta_cols text[] := ARRAY['status', 'updated_at', 'updated_by', 'decided_at', 'decided_by', 'decision_note', 'closed_at', 'closed_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permits cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'permits start as REQUESTED' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'REQUESTED' AND (to_jsonb(NEW) - meta_cols) <> (to_jsonb(OLD) - meta_cols) THEN
    RAISE EXCEPTION 'a decided permit is frozen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('REJECTED', 'CLOSED') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'permit is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED'))
          OR (OLD.status = 'APPROVED' AND NEW.status = 'CLOSED')) THEN
    RAISE EXCEPTION 'invalid permit transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED')
     AND (NEW.decided_by IS NULL OR NEW.decided_by IS NOT DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'a permit cannot be decided by its requester' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_permits_guard BEFORE INSERT OR UPDATE OR DELETE ON work_permits FOR EACH ROW EXECUTE FUNCTION work_permits_guard();

-- ── photos (append-only) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hse_photos_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'HSE photos are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  ok := CASE NEW.record_type
    WHEN 'OBSERVATION' THEN EXISTS (SELECT 1 FROM hse_observations s WHERE s.id = NEW.record_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
    WHEN 'INCIDENT' THEN EXISTS (SELECT 1 FROM incidents s WHERE s.id = NEW.record_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
    WHEN 'INSPECTION' THEN EXISTS (SELECT 1 FROM hse_inspections s WHERE s.id = NEW.record_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
    WHEN 'RISK_ASSESSMENT' THEN EXISTS (SELECT 1 FROM risk_assessments s WHERE s.id = NEW.record_id AND s.company_id = NEW.company_id AND s.project_id = NEW.project_id)
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'HSE photo record not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hse_photos_guard BEFORE INSERT OR UPDATE OR DELETE ON hse_photos FOR EACH ROW EXECUTE FUNCTION hse_photos_guard();

-- ── client approvals of variations ───────────────────────────────────
-- The snapshot and its hash are immutable; a PENDING row is decided once
-- (APPROVED | REJECTED | WITHDRAWN) and is final afterwards. The variation
-- must belong to the same company and project.
CREATE OR REPLACE FUNCTION variation_client_approvals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  decision_cols text[] := ARRAY['decision', 'channel', 'decided_at', 'decided_by', 'decision_note', 'decision_ip'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'client approvals cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.decision <> 'PENDING' THEN
      RAISE EXCEPTION 'client approvals start as PENDING' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM variations v WHERE v.id = NEW.variation_id AND v.company_id = NEW.company_id AND v.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'variation not found in this project' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - decision_cols) <> (to_jsonb(OLD) - decision_cols) THEN
    RAISE EXCEPTION 'the client approval snapshot is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.decision <> 'PENDING' AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'a client decision is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER variation_client_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON variation_client_approvals FOR EACH ROW EXECUTE FUNCTION variation_client_approvals_guard();

-- ── e-mail sign-in tokens ────────────────────────────────────────────
-- A token is consumed once; nothing else about it changes.
CREATE OR REPLACE FUNCTION email_sign_in_tokens_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL
     OR (to_jsonb(NEW) - 'consumed_at') <> (to_jsonb(OLD) - 'consumed_at') THEN
    RAISE EXCEPTION 'a sign-in token can only be consumed once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER email_sign_in_tokens_guard BEFORE UPDATE ON email_sign_in_tokens FOR EACH ROW EXECUTE FUNCTION email_sign_in_tokens_guard();
