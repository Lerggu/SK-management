# ADR 0021 — HSE workflows, personal data and key figures

- Status: Accepted (V7, owner decision 3)

## Context
Build Master §23 lists safety observations, near misses, incidents, toolbox talks, risk assessments, permits to work, inspections and lift plan links, mobile-first with photos. The owner accepted the recommended metrics and incident handling.

## Decision

### Records
| Record | Table | Lifecycle (DB trigger) |
|---|---|---|
| Safety observation / near miss | `hse_observations` | OPEN → TRIAGED → CLOSED (OPEN → CLOSED allowed); closed is final |
| Incident | `incidents` (+ `incident_persons`) | REPORTED → TRIAGED → INVESTIGATING → CLOSED (TRIAGED → CLOSED for minor) |
| Corrective action | `hse_actions` | OPEN → DONE → VERIFIED (DONE → OPEN to reopen); the source must exist in the same project and be open |
| Toolbox talk | `toolbox_talks` | append |
| Risk assessment | `risk_assessments` + `risk_assessment_items` | DRAFT → APPROVED → ARCHIVED; content and items frozen after approval |
| Permit to work | `work_permits` | REQUESTED → APPROVED / REJECTED; APPROVED → CLOSED; frozen once decided |
| Inspection (MVR/TR/general) | `hse_inspections` | append |
| Photo | `hse_photos` | append-only; the record must exist in the same company and project |

- **No deletes.** No record type can be deleted.
- **Numbering.** Observations, incidents and permits are numbered per project, serialized by a project row lock.
- **Lift plans.** Observations, incidents, risk assessments and permits can link to a V5 lift plan (composite FK; the service checks it belongs to the same project).

### Incident handling
1. **Report:** anyone with `hse.create`, including employees and subcontractors.
2. **Triage:** the Site Manager (`hse.manage`) sets type and severity, and records immediate actions.
3. **Investigation:** lost-time and serious incidents are investigated and closed by `hse.investigate` (HSE, CEO). The trigger blocks closing them without passing INVESTIGATING and recording a root cause.
4. **Corrective actions:** incident actions are approved (VERIFIED) by `hse.action.approve` (Project Manager, PD, CEO); other actions by `hse.manage`. The trigger blocks closing an incident while any of its actions is not VERIFIED.
5. **Notification:**
   - when a serious or lost-time incident is reported — or raised to that severity at triage — every active member with `hse.serious.notify` on the project (PD, HSE, CEO) gets an e-mail;
   - the e-mail contains project, number, severity and a link, with no personal data or description;
   - an in-app urgent list shows open serious incidents;
   - `notified_at` and an `incident.notify` audit event are recorded once;
   - a mail failure never loses the report.
   - Recipients are resolved by capability, not by role name.

### Personal data
- **Separate table, separate permission.** Injured-person details live in `incident_persons` and need `hse.personal.view` (HSE, CEO). It is a sensitive permission and is therefore never granted to external roles.
- **Masked in audit.** The `incident_person` fields are masked in audit deltas.
- **Kept out of the report.** The reporting form asks not to write names in the description.
- **Own-only reporters** (subcontractors) see their own records:
  - without investigation results;
  - without internal staff names or e-mails;
  - without internal lift plans.

### Key figures (`modules/hse/rules.ts`, unit tested)
- **LTIF** = lost-time injuries × 1 000 000 / hours. A lost-time injury is an INJURY of severity LOST_TIME or SERIOUS.
- **Report rate** = (observations + near misses) × 1 000 / hours.
- **MVR/TR index** = 100 × correct / (correct + incorrect), one decimal: the latest value and the trend.
- **Also reported:** incidents by severity, open and overdue actions, toolbox talks and attendees.
- **Hours** are approved V2 hours of the company's own people. Subcontractor hours are not in the system, so rates are an upper bound — a stated limitation.

## Consequences
- **Mobile reporting.** Reporting is one short form with an optional camera photo; large touch targets on the HSE page and in the portal.
- **No offline mode.** Offline-tolerant capture is not implemented (Build Master "where feasible"); a lost connection fails the form, which the user can resubmit.
