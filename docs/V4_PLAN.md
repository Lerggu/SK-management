# V4 — Logistics: plan

- Approved by the owner: 2026-10-05 ("saa aloittaa V4"; decisions below, recommendations accepted)

- Scope: Build Master §10 (resource scheduling), §11 (logistics control), §12 (delivery management), §38 (V4).
- Out of scope: lift plans, rigging, material and cable drum tracking, QR workflows (V5); internal invoicing between companies (V6); AI suggestions (V8).

## Acceptance criteria (§38)
1. Conflicting bookings are detected.
2. Logistics can be traced to a takt activity.
3. The delivery schedule works on mobile and desktop.

## Owner decisions (2026-10-05)
| # | Decision |
|---|---|
| 1 | Logistics requests are approved by the **Logistics Coordinator and the Site Manager**. |
| 2 | **Cross-company bookings are allowed in V4** (for example, Purent equipment on an SK Infra site). |
| 3 | Delivery slots are **30 minutes**. |

## Proposed details (recommendations)
- **Approval (decision 1):** either role can approve on its own; no two-step approval is required. In assigned projects, the approvers are the Logistics Coordinator and the Site Manager; the PD and CEO can approve in all projects.
- **Cross-company bookings (decision 2):**
  - Only between companies of the same organization (group).
  - The owning company marks a resource as *shareable in the group*.
  - The requesting company creates a booking request. The **owning company approves** it, and ownership never changes (owner requirement 3).
  - The requesting company sees only the name, type, availability and booking status. It never sees rates or costs.
  - Internal charging between companies is deferred to V6. V4 records the booking hours only.
- **Delivery slots (decision 3):** 30-minute slots per gate. One delivery can take several consecutive slots. Each gate has opening hours.

## Deliverables
- **Resource pools and bookings:**
  - `resource_bookings` records the resource (employee, crew or equipment), the owning company, the booking company, the project, site and takt activity or resource requirement, the time, the status (REQUESTED → APPROVED / REJECTED → CANCELLED), the requester and the approver.
  - Bookings can be created directly from the look-ahead's resource requirements.
- **Conflict detection (shown, never resolved automatically):**
  - overlapping bookings;
  - the resource is unavailable or inactive;
  - a trade or competence mismatch;
  - the equipment's inspection or maintenance date falls in the booking;
  - a delivery slot is double-booked.
- **Logistics requests:**
  - Fields per §11: service type, requested time, load, weight, dimensions, pickup, destination, required equipment, attachments and priority.
  - Status flow: DRAFT → REQUESTED → REVIEW → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETE / CANCELLED.
  - Every request is linked to a takt area and an activity.
- **Deliveries:**
  - Gates, unloading points and storage locations.
  - Delivery lifecycle per §12: PLANNED → CONFIRMED → ARRIVED_GATE → CHECKED_IN → UNLOADING → STORED → MOVED_TO_WORKFACE → INSTALLED.
  - A target takt activity per delivery.
- **Logistics board (desktop):** a timeline of gates, slots and bookings.
- **Mobile gate view:** today's arrivals with large check-in and status buttons.
- **Look-ahead update:** booked versus free capacity. A late material delivery can become a constraint on the activity.
- **New permissions (migration):** `logistics.request`, `logistics.approve`, `booking.manage` and `delivery.manage`. The role matrix is presented in the release report.

## Migration impact
- Mostly new tables.
- Equipment and employees get a `shareable_in_group` flag, a non-breaking column with default false.
- Takt requirements are referenced, not changed.
