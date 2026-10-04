-- V1 integrity objects that Prisma does not model.
-- Documented in docs/adr/0004-database-integrity.md.

-- ── audit_events: append-only ────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_block_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TRIGGER audit_events_block_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();

-- ── document_versions: content is never overwritten ──────────────────
CREATE OR REPLACE FUNCTION document_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_versions cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.revision_label IS DISTINCT FROM OLD.revision_label
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'document_versions content columns are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status = 'SUPERSEDED' AND NEW.status = 'CURRENT' THEN
    RAISE EXCEPTION 'a superseded document version cannot become current again'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER document_versions_guard
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION document_versions_guard();

-- At most one CURRENT version per document.
CREATE UNIQUE INDEX document_versions_one_current
  ON document_versions (document_id) WHERE status = 'CURRENT';

-- ── Check constraints ────────────────────────────────────────────────
ALTER TABLE companies
  ADD CONSTRAINT companies_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT companies_currency_format CHECK (default_currency ~ '^[A-Z]{3}$');

ALTER TABLE organizations
  ADD CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE users
  ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

ALTER TABLE projects
  ADD CONSTRAINT projects_dates_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

ALTER TABLE employees
  ADD CONSTRAINT employees_dates_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

ALTER TABLE employee_rates
  ADD CONSTRAINT employee_rates_amount_nonnegative CHECK (amount >= 0),
  ADD CONSTRAINT employee_rates_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT employee_rates_validity_order CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE equipment_rates
  ADD CONSTRAINT equipment_rates_amount_nonnegative CHECK (amount >= 0),
  ADD CONSTRAINT equipment_rates_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT equipment_rates_validity_order CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE equipment
  ADD CONSTRAINT equipment_site_requires_project CHECK (current_site_id IS NULL OR current_project_id IS NOT NULL),
  ADD CONSTRAINT equipment_meter_hours_nonnegative CHECK (meter_hours IS NULL OR meter_hours >= 0);

ALTER TABLE documents
  ADD CONSTRAINT documents_site_requires_project CHECK (site_id IS NULL OR project_id IS NOT NULL);

ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT document_versions_size_nonnegative CHECK (size_bytes >= 0),
  ADD CONSTRAINT document_versions_number_positive CHECK (version_number >= 1);
