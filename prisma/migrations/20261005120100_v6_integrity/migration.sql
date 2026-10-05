-- V6 integrity objects that Prisma does not model.
-- Documented in docs/adr/0018-quotes-and-variations.md and 0019-invoicing-and-forecast.md.

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_probability CHECK (probability_pct IS NULL OR probability_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT opportunities_value CHECK (estimated_value IS NULL OR estimated_value >= 0);

-- ── quotes ───────────────────────────────────────────────────────────
ALTER TABLE quote_versions
  ADD CONSTRAINT quote_versions_number CHECK (version_number >= 1),
  ADD CONSTRAINT quote_versions_pcts CHECK (
    overhead_pct BETWEEN 0 AND 100 AND risk_pct BETWEEN 0 AND 100 AND margin_pct >= 0 AND margin_pct < 100
  );

-- At most one open (draft/submitted) and one live (approved/sent/won) version per quote.
CREATE UNIQUE INDEX quote_versions_one_open ON quote_versions (quote_id) WHERE status IN ('DRAFT', 'SUBMITTED');
CREATE UNIQUE INDEX quote_versions_one_live ON quote_versions (quote_id) WHERE status IN ('APPROVED', 'SENT', 'WON');

-- A quote version can be edited only as a DRAFT. After that only the status
-- and its decision columns move: DRAFT → SUBMITTED; SUBMITTED → DRAFT |
-- APPROVED | REJECTED; APPROVED → SENT | SUPERSEDED; SENT → WON | LOST |
-- SUPERSEDED. Owner decision 3: approval needs an approver who neither
-- authored nor submitted the version. Versions are never deleted.
CREATE OR REPLACE FUNCTION quote_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  frozen_cols text[] := ARRAY['status', 'updated_at', 'updated_by', 'submitted_at', 'submitted_by', 'decided_at', 'decided_by', 'decision_note', 'sent_at', 'outcome_at', 'outcome_note'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'quote versions start as drafts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' AND (to_jsonb(NEW) - frozen_cols) <> (to_jsonb(OLD) - frozen_cols) THEN
    RAISE EXCEPTION 'a submitted quote version is frozen; create a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('DRAFT', 'APPROVED', 'REJECTED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('SENT', 'SUPERSEDED'))
    OR (OLD.status = 'SENT' AND NEW.status IN ('WON', 'LOST', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'invalid quote version transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('REJECTED', 'WON', 'LOST', 'SUPERSEDED') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'quote version is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED'
     AND (NEW.decided_by IS NULL OR NEW.decided_by IS NOT DISTINCT FROM NEW.submitted_by OR NEW.decided_by IS NOT DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'a quote cannot be approved by its author or submitter' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON quote_versions
  FOR EACH ROW EXECUTE FUNCTION quote_versions_guard();

ALTER TABLE quote_lines
  ADD CONSTRAINT quote_lines_values CHECK (quantity > 0 AND unit_cost >= 0);

CREATE OR REPLACE FUNCTION quote_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM quote_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'quote lines can only change while the version is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION quote_lines_guard();

-- ── contracts ────────────────────────────────────────────────────────
ALTER TABLE contracts ADD CONSTRAINT contracts_value CHECK (value >= 0);
ALTER TABLE contract_milestones ADD CONSTRAINT contract_milestones_amount CHECK (amount > 0);

-- ── variations (Build Master §21) ────────────────────────────────────
ALTER TABLE variations
  ADD CONSTRAINT variations_number CHECK (number >= 1),
  ADD CONSTRAINT variations_costs CHECK (
    labor_cost >= 0 AND equipment_cost >= 0 AND materials_cost >= 0 AND subcontract_cost >= 0 AND other_cost >= 0
    AND markup_pct BETWEEN 0 AND 1000 AND sales_price >= 0
  );

-- Pricing is editable only in DRAFT. Internal approval (INTERNAL_REVIEW →
-- SUBMITTED_TO_CLIENT, owner decision 3) needs an approver who neither
-- created nor submitted the variation. Variations are never deleted.
CREATE OR REPLACE FUNCTION variations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  price_cols text[] := ARRAY['labor_cost', 'equipment_cost', 'materials_cost', 'subcontract_cost', 'other_cost', 'markup_pct', 'sales_price', 'currency', 'project_id', 'number'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'variations cannot be deleted (reject instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'variations start as drafts' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF (SELECT bool_or((to_jsonb(NEW) -> c) IS DISTINCT FROM (to_jsonb(OLD) -> c)) FROM unnest(price_cols) c) THEN
      RAISE EXCEPTION 'variation pricing is frozen after review starts' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF OLD.status IN ('REJECTED', 'INVOICED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'rejected or invoiced variations are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'DRAFT' AND NEW.status = 'INTERNAL_REVIEW')
    OR (OLD.status = 'INTERNAL_REVIEW' AND NEW.status IN ('DRAFT', 'SUBMITTED_TO_CLIENT'))
    OR (OLD.status = 'SUBMITTED_TO_CLIENT' AND NEW.status IN ('APPROVED', 'REJECTED'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'EXECUTED')
    OR (OLD.status = 'EXECUTED' AND NEW.status = 'READY_TO_INVOICE')
    OR (OLD.status = 'READY_TO_INVOICE' AND NEW.status = 'INVOICED')
  ) THEN
    RAISE EXCEPTION 'invalid variation transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'SUBMITTED_TO_CLIENT' AND OLD.status = 'INTERNAL_REVIEW'
     AND (NEW.internal_approved_by IS NULL OR NEW.internal_approved_by IS NOT DISTINCT FROM NEW.submitted_by OR NEW.internal_approved_by IS NOT DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'a variation cannot be approved by its author or submitter' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER variations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON variations
  FOR EACH ROW EXECUTE FUNCTION variations_guard();

-- ── invoice candidates ───────────────────────────────────────────────
-- One live (non-void) candidate per source: nothing is billed twice, and a
-- voided candidate can be regenerated (e.g. after a rate correction).
CREATE UNIQUE INDEX invoice_candidates_one_per_source ON invoice_candidates (company_id, source_type, source_id) WHERE status <> 'VOID';

ALTER TABLE invoice_candidates
  ADD CONSTRAINT invoice_candidates_amount CHECK (amount = round(quantity * unit_price, 2)),
  ADD CONSTRAINT invoice_candidates_internal CHECK (
    (source_type = 'INTERNAL_BOOKING') = (bill_to_company_id IS NOT NULL)
    AND (bill_to_company_id IS NULL OR bill_to_company_id <> company_id)
  ),
  ADD CONSTRAINT invoice_candidates_export CHECK ((status IN ('EXPORTED', 'INVOICED')) = (export_batch_id IS NOT NULL) OR status = 'VOID');

-- Billing content never changes after creation; status moves OPEN →
-- EXPORTED | VOID, EXPORTED → INVOICED (an explicit re-export may move the
-- batch). INVOICED and VOID are final. Candidates are never deleted.
CREATE OR REPLACE FUNCTION invoice_candidates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable_cols text[] := ARRAY['status', 'export_batch_id', 'invoiced_at', 'invoiced_by', 'invoice_reference', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice candidates cannot be deleted (void instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'invoice candidates start open' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - mutable_cols) <> (to_jsonb(OLD) - mutable_cols) THEN
    RAISE EXCEPTION 'invoice candidate content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('INVOICED', 'VOID') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'invoiced or void candidates are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'OPEN' AND NEW.status IN ('EXPORTED', 'VOID'))
    OR (OLD.status = 'EXPORTED' AND NEW.status = 'INVOICED')
  ) THEN
    RAISE EXCEPTION 'invalid invoice candidate transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_candidates_guard
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_candidates
  FOR EACH ROW EXECUTE FUNCTION invoice_candidates_guard();

-- ── append-only exports and forecasts ────────────────────────────────
ALTER TABLE invoice_export_batches
  ADD CONSTRAINT invoice_export_batches_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT invoice_export_batches_rows CHECK (row_count > 0);

CREATE OR REPLACE FUNCTION v6_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER invoice_export_batches_append_only
  BEFORE UPDATE OR DELETE ON invoice_export_batches
  FOR EACH ROW EXECUTE FUNCTION v6_append_only();

CREATE TRIGGER cost_forecasts_append_only
  BEFORE UPDATE OR DELETE ON cost_forecasts
  FOR EACH ROW EXECUTE FUNCTION v6_append_only();

ALTER TABLE cost_forecasts ADD CONSTRAINT cost_forecasts_etc CHECK (etc_amount >= 0);
