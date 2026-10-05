-- V5: LIFT logistics requests are gated by an approved lift plan (ADR 0016).
-- ── V4 LIFT requests need an approved lift plan ──────────────────────
-- A LIFT logistics request can be scheduled, started or completed only
-- when a non-cancelled lift plan for it has an APPROVED version.
CREATE OR REPLACE FUNCTION logistics_requests_lift_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service_type = 'LIFT' AND NEW.status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETE') AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (
       SELECT 1 FROM lift_plans p JOIN lift_plan_versions v ON v.plan_id = p.id
       WHERE p.request_id = NEW.id AND p.company_id = NEW.company_id AND p.status <> 'CANCELLED' AND v.status = 'APPROVED'
     ) THEN
    RAISE EXCEPTION 'a lift cannot be carried out without an approved lift plan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logistics_requests_lift_gate
  BEFORE UPDATE ON logistics_requests
  FOR EACH ROW EXECUTE FUNCTION logistics_requests_lift_gate();
