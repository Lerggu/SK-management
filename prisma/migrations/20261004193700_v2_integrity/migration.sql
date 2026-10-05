-- V2 integrity objects that Prisma does not model.
-- Documented in docs/adr/0010-time-and-cost-calculation.md and 0011-site-diary-locking.md.

-- ── time_entries ─────────────────────────────────────────────────────
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_hours_range CHECK (
    (correction_of_id IS NULL AND hours > 0 AND hours <= 24)
    OR (correction_of_id IS NOT NULL AND hours <> 0 AND hours BETWEEN -24 AND 24)
  ),
  ADD CONSTRAINT time_entries_minutes_range CHECK (
    (start_minute IS NULL AND end_minute IS NULL)
    OR (start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute)
  );

-- Approved/exported entries are locked: the only allowed change is
-- APPROVED → EXPORTED (export stamp). Entries are never deleted.
CREATE OR REPLACE FUNCTION time_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'time_entries cannot be deleted (archive instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('APPROVED', 'EXPORTED') THEN
    IF OLD.status = 'APPROVED' AND NEW.status = 'EXPORTED'
       AND NEW.employee_id = OLD.employee_id AND NEW.project_id = OLD.project_id
       AND NEW.site_id IS NOT DISTINCT FROM OLD.site_id AND NEW.work_date = OLD.work_date
       AND NEW.hours = OLD.hours AND NEW.work_class = OLD.work_class
       AND NEW.start_minute IS NOT DISTINCT FROM OLD.start_minute
       AND NEW.end_minute IS NOT DISTINCT FROM OLD.end_minute
       AND NEW.correction_of_id IS NOT DISTINCT FROM OLD.correction_of_id
       AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
       AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by
       AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'approved time entries are locked; create a correction entry' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER time_entries_guard
  BEFORE UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entries_guard();

-- ── daily_reports: signing locks the diary ───────────────────────────
CREATE OR REPLACE FUNCTION daily_reports_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'daily_reports cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'SIGNED' THEN
    RAISE EXCEPTION 'a signed daily report is locked; add an addendum instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_reports_guard
  BEFORE UPDATE OR DELETE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION daily_reports_guard();

-- Entries/attachments of a signed report: no update or delete; inserts must
-- be addenda.
CREATE OR REPLACE FUNCTION daily_report_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM daily_reports
   WHERE id = COALESCE(NEW.daily_report_id, OLD.daily_report_id);
  IF parent_status = 'SIGNED' THEN
    IF TG_OP = 'INSERT' AND NEW.is_addendum THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the daily report is signed; only addenda can be added' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_report_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON daily_report_entries
  FOR EACH ROW EXECUTE FUNCTION daily_report_children_guard();

CREATE TRIGGER daily_report_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON daily_report_attachments
  FOR EACH ROW EXECUTE FUNCTION daily_report_children_guard();

ALTER TABLE daily_report_entries
  ADD CONSTRAINT daily_report_entries_equipment_hours CHECK (
    kind <> 'EQUIPMENT' OR (equipment_id IS NOT NULL AND hours IS NOT NULL AND hours > 0 AND hours <= 24)
  );

ALTER TABLE daily_report_attachments
  ADD CONSTRAINT daily_report_attachments_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- ── budgets ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX budgets_one_active_per_project ON budgets (project_id) WHERE status = 'ACTIVE';

ALTER TABLE budgets
  ADD CONSTRAINT budgets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT budgets_version_positive CHECK (version_number >= 1);

-- Active/superseded budgets are frozen except ACTIVE → SUPERSEDED.
CREATE OR REPLACE FUNCTION budgets_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft budgets can be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'SUPERSEDED' OR (OLD.status = 'ACTIVE' AND NEW.status <> 'SUPERSEDED') THEN
    RAISE EXCEPTION 'activated budgets are frozen; create a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budgets_guard
  BEFORE UPDATE OR DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION budgets_guard();

CREATE OR REPLACE FUNCTION budget_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  IF parent_status IS DISTINCT FROM 'DRAFT' AND parent_status IS NOT NULL THEN
    RAISE EXCEPTION 'budget lines can only change while the budget is a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION budget_lines_guard();

ALTER TABLE budget_lines
  ADD CONSTRAINT budget_lines_amount_nonnegative CHECK (amount >= 0);

-- ── cost_entries ─────────────────────────────────────────────────────
ALTER TABLE cost_entries
  ADD CONSTRAINT cost_entries_amount_nonzero CHECK (amount <> 0),
  ADD CONSTRAINT cost_entries_currency_format CHECK (currency ~ '^[A-Z]{3}$');
