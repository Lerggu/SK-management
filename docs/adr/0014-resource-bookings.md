# ADR 0014 — Resource bookings and cross-company use

- Status: Accepted (V4, owner decision 2: cross-company bookings allowed)

## Model
`resource_bookings` carries two companies:
- `company_id` is the **booking company**. It owns the booking, its project and site, and its takt activity link.
- `owner_company_id` is the **owning company** of the resource. The resource is linked with composite foreign keys: `(owner_company_id, employee_id) → employees(company_id, id)` and the same for equipment.

So a resource never changes owner (owner requirement 3). Cross-company use is a booking, as V1 planned. Bookings link to a takt activity and, optionally, to a baseline `resource_requirement` (traceability to takt).

## Rules (DB trigger `resource_bookings_guard`)
- If the two companies differ, both must belong to the same organization, and the resource must be flagged `shareable_in_group` by its owner.
- After creation, the resource, the owner and the booking company never change.
- Status moves REQUESTED → APPROVED | REJECTED | CANCELLED, and APPROVED → CANCELLED. An approved booking cannot be moved. Bookings are never deleted.

## Decisions
- A booking of an **own** resource without conflicts is approved at once.
- A booking with conflicts, or of **another company's** resource, waits as REQUESTED.
- Only the owning company decides on a cross-company request, and it needs `booking.manage` at company level. Rejected or cancelled is final.
- Every action is audited in both companies' trails.

## Conflict detection (`logistics/rules.ts`, unit tested)
Detected conflicts:
- an overlapping active booking of the same resource, by any company;
- the resource is inactive (employee INACTIVE, or equipment in MAINTENANCE or OUT_OF_SERVICE);
- the equipment's inspection is due on or before the last booked day;
- a trade or equipment-type mismatch against the linked requirement.

Conflicts are shown and never resolved automatically. Approving despite conflicts needs an explicit acknowledgement, which is stored in `conflicts_accepted` and audited.

## Controlled cross-company reads
Two repository reads cross the company boundary, both limited to the caller's organization:
1. **Group resource directory:** only shareable resources of the other companies, with name, trade or type, and owner company name. No rates and no contact data.
2. **Bookings of one resource for conflict checks:** periods only. The booking company never sees the other party's project details.

Isolation tests check that a company in another organization can never see or book these resources. The owning company does see the booking company and its project, so it knows where its resource goes.

## Not in V4
- Internal charging between companies (V6). V4 records booked periods only.
- Working-time rules for bookings, which the Build Master lists "where rules are configured". There is no configuration yet.
