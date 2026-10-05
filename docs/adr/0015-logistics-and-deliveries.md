# ADR 0015 — Logistics requests, gates and deliveries

- Status: Accepted (V4, owner decisions 1 and 3)

## Locations
`logistics_locations` per site: GATE, UNLOADING or STORAGE. A gate has opening hours on 30-minute boundaries (check constraint).

## Delivery slots (decision 3: 30 minutes)
- A delivery occupies one or more consecutive 30-minute slots at one gate (`slot_start`, `slot_end`).
- A check constraint keeps both ends on 30-minute boundaries. Helsinki has whole-hour offsets, so UTC alignment equals local alignment.
- The exclusion constraint `deliveries_no_gate_overlap` uses btree_gist on `(gate_id, tstzrange)`, excluding cancelled deliveries. So a gate slot can never hold two deliveries, even under concurrent writes; the service maps the violation to "slot taken".
- The service checks opening hours in Europe/Helsinki time. The conversion lives in `platform/i18n/time.ts` and is DST-safe and tested.

## Delivery lifecycle
- PLANNED → CONFIRMED → ARRIVED_GATE → CHECKED_IN → UNLOADING → STORED → MOVED_TO_WORKFACE → INSTALLED.
- Status moves forward only. Steps can be skipped, for example straight to STORED.
- Cancelling is possible before arrival. INSTALLED and CANCELLED are final.
- The trigger `deliveries_guard` enforces these rules, freezes the slot after arrival and blocks deletes.
- The mobile gate view offers the next two steps as large buttons.

## Link to takt (traceability)
- A delivery for a takt activity, or for a request that is linked to one, opens a MATERIAL constraint on the activity.
- The constraint clears when the delivery reaches STORED, MOVED_TO_WORKFACE or INSTALLED.
- A late material delivery therefore holds the activity in NOT_READY or BLOCKED through the V3 readiness rules.
- The activity page lists its requests, deliveries and bookings.

## Logistics requests (decision 1)
- Workflow: DRAFT → REQUESTED → REVIEW → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETE, with CANCELLED from any open state. A trigger enforces it.
- **Who does what:**
  - Requester (`logistics.request`): submits a request and cancels their own.
  - Approver (`logistics.approve`, held by the Logistics Coordinator and Site Manager, plus PD and CEO): reviews, approves or returns.
  - Operator (`delivery.manage`): advances scheduled work.
  - Either approver role is enough; there is no two-step approval.
- Scheduling a delivery for an approved request sets it to SCHEDULED. Gate arrival sets it to IN_PROGRESS, and material on site completes it.

## Look-ahead
The V3 look-ahead shows **booked** capacity per week next to demand and capacity: the peak of the company's approved bookings, by employee trade or equipment type.
