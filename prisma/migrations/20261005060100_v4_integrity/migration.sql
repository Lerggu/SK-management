-- V4 integrity objects that Prisma does not model.
-- Documented in docs/adr/0014-resource-bookings.md and 0015-logistics-and-deliveries.md.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── resource bookings ────────────────────────────────────────────────
ALTER TABLE resource_bookings
  ADD CONSTRAINT resource_bookings_resource CHECK (
    (resource_kind = 'EMPLOYEE' AND employee_id IS NOT NULL AND equipment_id IS NULL)
    OR (resource_kind = 'EQUIPMENT' AND equipment_id IS NOT NULL AND employee_id IS NULL)
  ),
  ADD CONSTRAINT resource_bookings_period CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '370 days');

-- A booking may cross companies only within one organization, and only for
-- a resource its owner has marked shareable. The resource, owner and booking
-- company never change after creation; status moves REQUESTED → APPROVED |
-- REJECTED | CANCELLED and APPROVED → CANCELLED. Bookings are never deleted.
CREATE OR REPLACE FUNCTION resource_bookings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  shareable boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'resource bookings cannot be deleted (cancel instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_id <> NEW.owner_company_id THEN
      IF (SELECT organization_id FROM companies WHERE id = NEW.company_id)
         IS DISTINCT FROM (SELECT organization_id FROM companies WHERE id = NEW.owner_company_id) THEN
        RAISE EXCEPTION 'cross-company bookings are allowed only within one organization' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.resource_kind = 'EMPLOYEE' THEN
        SELECT shareable_in_group INTO shareable FROM employees WHERE id = NEW.employee_id;
      ELSE
        SELECT shareable_in_group INTO shareable FROM equipment WHERE id = NEW.equipment_id;
      END IF;
      IF shareable IS NOT TRUE THEN
        RAISE EXCEPTION 'the resource is not shared with the group' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.status NOT IN ('REQUESTED', 'APPROVED') THEN
      RAISE EXCEPTION 'bookings start as requested or approved' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.company_id <> OLD.company_id OR NEW.owner_company_id <> OLD.owner_company_id
     OR NEW.resource_kind <> OLD.resource_kind
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
    RAISE EXCEPTION 'the booked resource cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'rejected or cancelled bookings are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'invalid booking transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'APPROVED' AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at) THEN
    RAISE EXCEPTION 'an approved booking cannot be moved; cancel and rebook' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resource_bookings_guard
  BEFORE INSERT OR UPDATE OR DELETE ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION resource_bookings_guard();

-- ── locations ────────────────────────────────────────────────────────
ALTER TABLE logistics_locations
  ADD CONSTRAINT logistics_locations_gate_hours CHECK (
    (kind <> 'GATE' AND opens_minute IS NULL AND closes_minute IS NULL)
    OR (kind = 'GATE' AND opens_minute BETWEEN 0 AND 1410 AND closes_minute BETWEEN 30 AND 1440
        AND closes_minute > opens_minute AND opens_minute % 30 = 0 AND closes_minute % 30 = 0)
  );

-- ── logistics requests ───────────────────────────────────────────────
ALTER TABLE logistics_requests
  ADD CONSTRAINT logistics_requests_period CHECK (requested_end > requested_start),
  ADD CONSTRAINT logistics_requests_weight CHECK (weight_kg IS NULL OR weight_kg >= 0);

CREATE OR REPLACE FUNCTION logistics_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics requests cannot be deleted (cancel instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('COMPLETE', 'CANCELLED') THEN
    RAISE EXCEPTION 'completed or cancelled requests are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR NEW.status = 'CANCELLED'
    OR (OLD.status = 'DRAFT' AND NEW.status = 'REQUESTED')
    OR (OLD.status = 'REQUESTED' AND NEW.status IN ('REVIEW', 'APPROVED', 'DRAFT'))
    OR (OLD.status = 'REVIEW' AND NEW.status IN ('APPROVED', 'DRAFT'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'SCHEDULED')
    OR (OLD.status = 'SCHEDULED' AND NEW.status = 'IN_PROGRESS')
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETE')
  ) THEN
    RAISE EXCEPTION 'invalid logistics request transition % → %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logistics_requests_guard
  BEFORE UPDATE OR DELETE ON logistics_requests
  FOR EACH ROW EXECUTE FUNCTION logistics_requests_guard();

-- ── deliveries: 30-minute gate slots, one delivery per slot ──────────
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_slots CHECK (
    slot_end > slot_start
    AND slot_end - slot_start <= interval '12 hours'
    AND extract(epoch FROM slot_start)::bigint % 1800 = 0
    AND extract(epoch FROM slot_end)::bigint % 1800 = 0
  ),
  ADD CONSTRAINT deliveries_weight CHECK (weight_kg IS NULL OR weight_kg >= 0),
  ADD CONSTRAINT deliveries_no_gate_overlap EXCLUDE USING gist (
    gate_id WITH =, tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status <> 'CANCELLED');

-- Status moves forward only (or to CANCELLED before arrival); INSTALLED and
-- CANCELLED are final. Deliveries are never deleted.
CREATE OR REPLACE FUNCTION delivery_status_rank(s "DeliveryStatus") RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'PLANNED' THEN 0 WHEN 'CONFIRMED' THEN 1 WHEN 'ARRIVED_GATE' THEN 2 WHEN 'CHECKED_IN' THEN 3
    WHEN 'UNLOADING' THEN 4 WHEN 'STORED' THEN 5 WHEN 'MOVED_TO_WORKFACE' THEN 6 WHEN 'INSTALLED' THEN 7
    ELSE 99 END
$$;

CREATE OR REPLACE FUNCTION deliveries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deliveries cannot be deleted (cancel instead)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('INSTALLED', 'CANCELLED') THEN
    RAISE EXCEPTION 'installed or cancelled deliveries are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'CANCELLED' THEN
    IF delivery_status_rank(OLD.status) >= 2 THEN
      RAISE EXCEPTION 'a delivery that has arrived cannot be cancelled' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF delivery_status_rank(NEW.status) < delivery_status_rank(OLD.status) THEN
    RAISE EXCEPTION 'delivery status cannot move backwards (% → %)', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF delivery_status_rank(OLD.status) >= 2 AND (NEW.slot_start <> OLD.slot_start OR NEW.slot_end <> OLD.slot_end OR NEW.gate_id <> OLD.gate_id) THEN
    RAISE EXCEPTION 'the slot of an arrived delivery cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliveries_guard
  BEFORE UPDATE OR DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION deliveries_guard();
