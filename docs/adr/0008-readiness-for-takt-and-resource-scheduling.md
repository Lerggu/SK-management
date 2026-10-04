# ADR 0008 — V1 design choices that keep Takt (V3) and logistics/resources (V4–V5) open

- Status: Accepted (V1)

| Future need | V1 provision |
|---|---|
| Site → Building/Area → Takt Area → Work Package → Activity | `sites` exposes `UNIQUE (company_id, project_id, id)`, so `buildings(company_id, project_id, site_id)` can reference it with a composite FK. Each further level repeats the pattern. No existing table changes. |
| Employees and equipment as bookable resources | Stable UUIDv7 ids, a mandatory owning `company_id`, a `status` (ACTIVE/INACTIVE, AVAILABLE/IN_USE/MAINTENANCE/OUT_OF_SERVICE), and archive instead of delete. Rates have validity periods, ready for cost calculation per booking date. |
| Cross-company resource use | Equipment `current_project_id` and `current_site_id` are constrained to the **owner's** projects. Use by another company will be a `resource_bookings` row (booking company, resource owner company, period, status, approver). Ownership, costs and billing stay with the owner. |
| Equipment inspections and maintenance | `next_inspection_date` and `meter_hours` exist and appear on the dashboard. Dedicated tables come in V4/V5. |
| Competences | Employee documents can already be linked (`document_links`). Structured competences arrive with V3/V4. |
| Audit of bookings and baselines | The generic audit writer handles any entity type. |
