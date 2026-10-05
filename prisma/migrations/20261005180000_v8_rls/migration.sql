-- V8: PostgreSQL row-level security (owner decision 1; CLAUDE.md tenant
-- isolation rule 4). docs/adr/0022-row-level-security.md.
--
-- Company-scoped service calls run as the NOLOGIN role `sk_app` (SET LOCAL
-- ROLE inside each transaction) with `app.company_id` / `app.organization_id`
-- set. sk_app is neither a superuser nor a table owner, so the policies below
-- apply to it. Identity paths (sign-in, membership resolution), migrations and
-- the seed's fixtures run as the owner role and are not affected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sk_app') THEN
    CREATE ROLE sk_app NOLOGIN;
  END IF;
END
$$;

-- The application's login role must be able to SET ROLE sk_app. Superusers
-- can always; otherwise grant membership (needs CREATEROLE or a DBA).
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT sk_app TO %I', current_user);
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sk_app;

-- Scope helpers. NULL when unset → no company row matches.
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_org_company_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT c.id FROM companies c WHERE c.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
$$;

-- Every table with company_id: rows of the scoped company only (read and write).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name <> 'audit_events'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END
$$;

-- ── documented cross-company access within the group (V4–V6) ─────────
-- Resources shared with the group are readable by the other companies of
-- the organization (V4 cross-company bookings); writes stay with the owner.
CREATE POLICY group_shared_read ON employees FOR SELECT USING (shareable_in_group AND company_id IN (SELECT app_org_company_ids()));
CREATE POLICY group_shared_read ON equipment FOR SELECT USING (shareable_in_group AND company_id IN (SELECT app_org_company_ids()));
CREATE POLICY group_read ON equipment_types FOR SELECT USING (company_id IN (SELECT app_org_company_ids()));

-- Bookings: readable within the group (conflict checks on shared resources);
-- the resource owner decides (updates) bookings made by other companies.
CREATE POLICY group_read ON resource_bookings FOR SELECT USING (company_id IN (SELECT app_org_company_ids()));
CREATE POLICY owner_decides ON resource_bookings FOR UPDATE USING (owner_company_id = app_company_id()) WITH CHECK (owner_company_id = app_company_id());

-- The owner sees the context of bookings made of its resources.
CREATE POLICY booking_owner_read ON projects FOR SELECT USING (EXISTS (SELECT 1 FROM resource_bookings b WHERE b.project_id = projects.id AND b.owner_company_id = app_company_id()));
CREATE POLICY booking_owner_read ON sites FOR SELECT USING (EXISTS (SELECT 1 FROM resource_bookings b WHERE b.site_id = sites.id AND b.owner_company_id = app_company_id()));
CREATE POLICY booking_owner_read ON takt_activities FOR SELECT USING (EXISTS (SELECT 1 FROM resource_bookings b WHERE b.activity_id = takt_activities.id AND b.owner_company_id = app_company_id()));
CREATE POLICY booking_owner_read ON takt_areas FOR SELECT USING (EXISTS (SELECT 1 FROM resource_bookings b JOIN takt_activities a ON a.id = b.activity_id WHERE a.takt_area_id = takt_areas.id AND b.owner_company_id = app_company_id()));
CREATE POLICY booking_owner_read ON resource_requirements FOR SELECT USING (EXISTS (SELECT 1 FROM resource_bookings b WHERE b.requirement_id = resource_requirements.id AND b.owner_company_id = app_company_id()));

-- Internal invoicing (V6): the billed company reads candidates billed to it.
CREATE POLICY bill_to_read ON invoice_candidates FOR SELECT USING (bill_to_company_id = app_company_id());

-- Audit: read own company; write own company, another company of the group
-- (cross-company booking events) or company-less events.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT USING (company_id = app_company_id());
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (company_id IS NULL OR company_id = app_company_id() OR company_id IN (SELECT app_org_company_ids()));
