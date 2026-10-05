# ADR 0016 — Lift plans, approval and lifting accessories

- Status: Accepted (V5, owner decision 1)

## Model
- `lift_plans`: one lift on a site. It can link to a V4 logistics request of type LIFT and to a takt activity. Status is OPEN → COMPLETED | CANCELLED.
- `lift_plan_versions`: the content of the plan. It holds the load, load and rigging weight, centre-of-gravity notes, crane, radius, crane capacity at that radius, lifting area, safety distance and a risk assessment (a V1 document). Status is DRAFT → SUBMITTED → APPROVED | REJECTED, and APPROVED → SUPERSEDED.
- `lift_plan_accessories`: accessories per version, with a count.
- `lifting_accessories`: a company-wide register. Each accessory has a unique code (printed on its QR label), a kind, a WLL, the next inspection date and a status.
- **Partial unique indexes:**
  - at most one APPROVED version per plan;
  - at most one open (DRAFT or SUBMITTED) version per plan.

## Approval (decision 1: the person responsible for lifting)
- **New permission `lift.plan.approve`:**
  - Held by the new role template **Lifting Supervisor / Nostovastaava** (ASSIGNED, assigned per project).
  - Also held by the CEO and Project Director, so approval never stalls.
  - No other template holds it.
- **Migration `v5_permissions`:** creates the role in every existing company (named in the company's locale) and writes an audit event per company.
- **The author never approves their own plan:**
  - The service refuses when the approver is the version's author or its submitter.
  - The trigger `lift_plan_versions_guard` refuses an approval whose `decided_by` is null or equals `submitted_by`.
- **Checks are re-run at approval:**
  - Blocking issues refuse approval.
  - Warnings must be acknowledged, and the acknowledgement is audited.
- Rejection requires a reason.

## Locking (an approved plan cannot change silently)
- **APPROVED versions are frozen.** The only allowed change is APPROVED → SUPERSEDED, with no other column touched. The comparison uses `to_jsonb(NEW) - status - updated_*`.
- SUPERSEDED and REJECTED versions are final, and versions are never deleted.
- A SUBMITTED version is read-only. It can be returned to DRAFT, approved or rejected.
- Accessory rows change only while their version is a DRAFT (trigger `lift_plan_accessories_guard`).
- **A change is a new version:**
  - `revise` copies the latest version and its accessories into a new DRAFT and records the reason.
  - Approving the new version supersedes the previous one in the same transaction.

## Acceptance criterion 1: no lift without an approved plan
- **The plan:** `lift_plans_guard` refuses COMPLETED unless an APPROVED version exists.
  - The service also refuses completion while a revision is open.
  - It also refuses when the checks fail on the completion day, for example when an accessory's inspection lapsed after approval.
- **The V4 LIFT request:** `logistics_requests_lift_gate` refuses SCHEDULED, IN_PROGRESS and COMPLETE unless a non-cancelled plan for the request has an APPROVED version.
  - The logistics service maps this to a form error.
  - A delivery for a LIFT request does not auto-schedule the request until the plan is approved.
- **Automatic request transitions:**
  - Approving a plan moves an APPROVED request to SCHEDULED.
  - Completing the lift moves the request to COMPLETE.

## Acceptance criterion 2: checks (`modules/lifting/rules.ts`, pure and unit tested)

| Code | Severity | Rule |
|---|---|---|
| INCOMPLETE | block | load description, load weight, crane, radius or capacity missing |
| CAPACITY_EXCEEDED | block | (load + rigging) > crane capacity at the radius |
| HIGH_UTILIZATION | warn | utilisation ≥ 90 % |
| CRANE_UNAVAILABLE | block | crane archived, in maintenance or out of service |
| CRANE_INSPECTION_DUE | block | crane inspection on or before the lift date |
| ACCESSORY_INACTIVE | block | accessory archived or out of use |
| ACCESSORY_INSPECTION_DUE | block | accessory inspection missing, or on or before the lift date |
| ACCESSORY_WLL_EXCEEDED | block | WLL × count < total hook load |
| RISK_ASSESSMENT_MISSING | warn | no risk assessment document linked |

- **The WLL rule is a conservative simplification.** Each accessory line must carry the whole hook load on its own. Sling angle and load-sharing factors remain the planner's responsibility.
- The crane's capacity at the radius is entered from the load chart. No load-chart database exists in V5.
- The checks support the person responsible for lifting. They never replace the plan's engineering judgement.

## Rigging allocation
- Riggers and crane operators are booked with V4 `resource_bookings`, which gained a nullable `lift_plan_id`.
- So V4 conflict detection (overlap, trade, inspection) applies unchanged.
- The lift plan page lists its bookings.

## Permissions

| Permission | Holders |
|---|---|
| `lift.request` | create plans and edit or submit own drafts. Held by CEO, PD, PM, SM, SUP, LOG and LIFT |
| `lift.plan.manage` | edit any draft, manage the accessory register, record completion. Held by CEO, PD, SM, LOG and LIFT |
| `lift.plan.approve` | approve or reject. Held by CEO, PD and LIFT |

Lift plans are visible with `logistics.view`.
