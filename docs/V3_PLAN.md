# V3 — Takt & Look-ahead: plan (DRAFT, awaiting owner approval)

- Scope: Build Master §8 (Takt engine), §9 (Look-ahead engine), §37 (V3).
- Out of scope: resource bookings and conflict detection (V4–V5), logistics requests (V4), AI suggestions.

## Acceptance criteria (§37)
1. A baseline cannot be silently overwritten.
2. Schedule changes are versioned.
3. Blocked and readiness states work.
4. The look-ahead produces resource requirements.

## Owner decisions (2026-10-05)
| # | Decision |
|---|---|
| 1 | The default takt cycle is **one working day**. The cycle length is stored per plan, so longer cycles remain possible later. |
| 2 | The **Project Manager** approves the baseline in assigned projects. Project Director and CEO hold the same right in all projects, following the same pattern as hour approval. |
| 3 | **MS Project and Primavera P6 import is required in V3.** |

## Proposed details (recommendations)
- **Working calendar:** a company calendar with Mon–Fri working days and a configurable list of public holidays. The seed loads Finnish public holidays for 2026–2027 as data. Day-takt cycles skip non-working days.
- **Import formats:** file import only, with no API connection and no fabricated integration.
  - MS Project XML (MSPDI, `.xml`, "Save as XML" in MS Project).
  - Primavera P6 XER (`.xer`).
  - The native binary `.mpp` format is not supported; users export it to XML.
  - An import always creates a new DRAFT plan version and never touches the baseline.
  - The import shows a preview: the WBS is mapped to takt area, work package and activity; tasks with no mapping are reported; dependencies (FS/SS/FF/SF with lag) are carried over.
  - The original file is stored as a document version (SHA-256), and the import is audited.

## Deliverables
- **Hierarchy:** `buildings` (building/area), `takt_areas`, `work_packages` and `activities`. They hang off `sites(company_id, project_id, id)` through composite foreign keys, so the change is non-breaking.
- **Plans and versions:**
  - Tables: `takt_plans`, `takt_plan_versions` (DRAFT → PROPOSED → BASELINE / SUPERSEDED) and `takt_cycles`.
  - A DB trigger locks baseline versions.
  - Every change is a new version or an approved adjustment, with a reason and an audit event.
- **Takt board:** a grid of takt areas × cycle days, colour-coded by trade.
  - Desktop: plan editing, moving activities, version comparison against the baseline.
  - Mobile: a read view, plus status and progress updates with large touch targets.
- **Dependencies and constraints:**
  - Dependencies: FS/SS/FF/SF with lag.
  - Configurable constraint types: predecessor complete, drawings approved, material available, workforce available, equipment available, permit available, area available.
  - Status NOT_READY / READY / IN_PROGRESS / BLOCKED / COMPLETE, derived from the constraints.
  - Each activity records a delay reason and a recovery action.
- **Progress:**
  - Progress %, actual start and actual end per activity.
  - A progress update can be linked to a V2 site diary work entry.
- **Look-ahead (2/6/12 weeks):**
  - Requirements for workforce by competence/trade, equipment by type, and lifting.
  - Requirements are compared with the company's own active employees and equipment, and shortages are highlighted.
  - Requirements are stored as `resource_requirements`, the basis for bookings in V4–V5.
  - No bookings are made in V3.
- **Permissions (migration):** `takt.view`, `takt.manage`, `takt.progress.update` and `takt.baseline.approve`. The role matrix is presented in the release report.

## Migration impact
- New tables only. V1–V2 tables have no breaking changes.
- New permissions are added to existing companies' template roles in a migration, with an audit event.
