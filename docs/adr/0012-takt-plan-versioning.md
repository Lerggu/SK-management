# ADR 0012 — Takt plans: hierarchy, versioning, baseline and readiness

- Status: Accepted (V3)

## Hierarchy
`sites → buildings (BUILDING | AREA) → takt_areas`. Work packages are project-level trades ("wagons") that are reused across the project's sites. An activity (`takt_activities`) is one work package in one takt area of a site plan, and the pair is unique per plan. The tables are joined by composite foreign keys, so cross-company and cross-site references are impossible at the database level. For example:
- `takt_activities(company_id, site_id, takt_area_id) → takt_areas(company_id, site_id, id)`;
- `(company_id, project_id, site_id, plan_id) → takt_plans`.

None of V1–V2 changed.

## Calendar and cycles
- Each plan references a company work calendar (`work_calendars` with ISO working weekdays, plus `calendar_holidays`). The default calendar is Mon–Fri. It is created on first use with Finnish public holidays for three years, including Midsummer Eve and Christmas Eve, and the moving feasts are computed from Easter.
- The default cycle is **one working day** (owner decision). `cycle_length_days` is stored per plan.
- Cycle *n* starts *n × L* working days after the version start date. The arithmetic lives in `src/modules/takt/calendar.ts` and `engine.ts` and is unit tested.

## Versions and baseline
- Planned positions live in `takt_assignments (version, activity, start_cycle, duration_cycles)`.
- A version moves `DRAFT → PROPOSED → BASELINE → SUPERSEDED`. A proposed version can go back to DRAFT with a note.
- Partial unique indexes allow at most one BASELINE and one open (DRAFT/PROPOSED) version per plan.
- The `takt_plan_versions_guard` trigger freezes BASELINE and SUPERSEDED rows. The only exception is the transition BASELINE → SUPERSEDED. Versions start as drafts, and only drafts can be deleted.
- The `takt_assignments_guard` trigger allows changes only while the parent version is a DRAFT.
- So the baseline **cannot be silently overwritten**, even with direct SQL. A change is a new draft, copied from the baseline, with a reason. Approving it supersedes the old baseline, which is kept and can be compared.
- Approval needs `takt.baseline.approve`, granted to the Project Manager in assigned projects and to PD and CEO in all projects (owner decision). Every transition is audited.

## Facts are not versioned
Execution state, progress %, actual dates, blocked flag, delay reason, recovery action and constraints are facts about the activity. They are shared by all versions. Progress history (`activity_progress`) is append-only, enforced by a trigger. Activities are archived, never deleted.

## Readiness (status)
`engine.deriveStatus` sets the status in this order:
1. **COMPLETE**: the activity is complete.
2. **BLOCKED**: the activity is flagged blocked, with a delay reason recorded.
3. **IN_PROGRESS**: the activity has started.
4. **READY**: every predecessor condition holds and no constraint is open.
   - FS requires the predecessor to be complete.
   - SS requires the predecessor to have started.
   - FF and SF do not gate the start.
5. **NOT_READY**: the activity is not ready, but its planned start has not been reached.
6. **BLOCKED**: the activity is not ready and its planned start has been reached.

Lateness is judged against the baseline, or against the open version if no baseline exists.

Constraint types cover the Build Master list: drawings, material, workforce, equipment, permit and area. The "predecessor complete" check is derived from dependencies. Dependency cycles are rejected.

## Resource requirements
When a version becomes the baseline, `resource_requirements` rows are generated for every assignment:
- TRADE × crew size;
- EQUIPMENT_TYPE × count.

Each row covers the planned date span. The rows are immutable (trigger) and are the basis for V4–V5 bookings. The look-ahead (2/6/12 weeks) aggregates weekly peak demand and unit-days from the requirements of activities not yet complete. It compares them with the company's own capacity: active employees by trade, and equipment by type with status AVAILABLE or IN_USE. Shortages are highlighted. No bookings are made.
