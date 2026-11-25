# ADR 0037 — Fixes from the role journeys

- Status: Accepted (owner request 2026-11-26: "fix everything directly")

## Context
Every role template walked through a fictional steel-plant demo project in Playwright, on a desktop and on a phone (`tests/journeys/`, run by `.github/workflows/journeys.yml` on `journeys/**` branches, test environment only). One reviewer per role read the screenshots and results. The findings were blockers ("este"), awkward flows ("hankala") and cosmetic issues. This ADR records the changes that touch permissions, external access or shared behaviour. The smaller UI fixes are listed in the PR.

## Decisions

### Permissions (migration `20261128090000_role_journey_permissions`)
- **`team.manage`** (new, company-wide, not sensitive): create teams, choose the leader and change members (ADR 0029). Granted to CEO, Site Manager and HR administrator. `employee.manage` and `hr.manage` still allow it as before.
- **`assistant.use`** (new, sensitive): the voice/text assistant (ADR 0031) without the AI project controller. Granted to CEO, Employee, Supervisor, HSE and Lifting Supervisor. The assistant still only proposes actions that a person confirms. Names may go to the AI; identity codes and rates never do. Every run counts against the monthly AI cap (ADR 0035). Externals never get it, because they never get sensitive permissions.
- **HR administrator gets `timesheet.export`**: the payroll export is an HR task. The export file has no rates. When a member can only export, the Tunnit page goes straight to the export.

### Subcontractor portal
- **Document delivery**: `documentService.submitExternal`. A subcontractor with `portal.subcontractor` in the project can deliver a RAMS, a certificate or another document.
  - The delivery becomes an internal project document with the subcontractor as owner. Its version waits for approval (`PENDING_APPROVAL`), and it is not shared with any external party.
  - An internal approver approves it and decides whether to share it, as with any document.
  - `listOwnSubmissions` shows the sender their own deliveries and their approval state, and nothing else.
  - Audited as `document.external_submit`.
  - This is the only document write open to external members. The V7 rule "externals never manage documents" still holds for editing, versions, approval and sharing.
- **Schedule**: subcontractors see the same schedule summary as the client: plans, baseline dates and progress percentages. No money, crews, constraints or reasons.
- **Task list and acknowledgement of work: not done.** There is no link between a takt activity and a subcontractor party yet, so the portal cannot know which activities are "theirs". This needs an owner decision on the data model.

### Shared behaviour
- **Dashboard "Odottaa päätöstäsi"** (`dashboardService.decisions`) lists items waiting for the user's decision. Each kind is gated by its approval permission and project scope:
  - quotes submitted for approval;
  - variations in internal review;
  - takt versions proposed as baseline;
  - submitted lift plans;
  - requested permits;
  - logistics requests waiting for review.

  The user's own proposals are left out where self-approval is blocked.
- **Takt baseline**: the proposer is shown. Approving your own proposal is still allowed, because small projects may have only one planner and existing approvals rely on it. It shows a warning and asks a separate confirmation. The approval is audited under the approver's name as before.
- **Phone bottom bar by role** (`mobilePrimary`): the bar is decided by capabilities, never by role names.
  - Lifting Supervisor: lift plans first.
  - Logistics Coordinator: the logistics board first.
  - HSE specialist: HSE first.
  - Worker without crew or logistics duties: hours, HSE and their own card.
- **Remembered site**: pages that pick a site open on the member's last-used site. These are logistics, lifting, materials, gate, setup and the site map. The site is kept in a preference cookie (`sk-site-<company>`); services still check access.
- **LTIF** is shown as "–" below 10 000 hours, because a frequency per million hours is noise with fewer hours. The stored figure is unchanged.
- **External documents**: an external member sees the newest approved version as the valid one. It is no longer marked superseded while a newer revision waits for approval.

## Consequences
- The authz matrix and the external-boundary suite cover the new rules:
  - the subcontractor may see the portal schedule;
  - only the subcontractor may run `document.submitExternal`.
- Integration tests are in `tests/integration/role-journeys.test.ts`.
- Re-running the journeys on a `journeys/**` branch verifies the UI changes on both viewports.
