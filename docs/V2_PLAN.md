# V2 — Site Execution & Project Finance Foundation: plan

- Approved by the owner: 2026-10-04 ("aloita V2", recommendations accepted)
- Scope: Build Master §36. Out of scope: Takt (V3), logistics (V4), invoicing/EAC (V6).

## Acceptance criteria (§36)
1. Approved time entries feed the project's actual labour cost.
2. The site diary can be reviewed and finalized (signed and locked).
3. Budget vs actual is visible.
4. Corrections are audited.

## Owner decisions
| # | Decision |
|---|---|
| 1 | Work-time classes and cost multipliers: NORMAL 1.0, OVERTIME_50 1.5, OVERTIME_100 2.0, TRAVEL 1.0. Labour cost = hours × the employee's hourly COST rate valid on the work date × multiplier. |
| 2 | Hours are approved by Site Manager and Project Manager in their assigned projects, and by Project Director and CEO in all projects. |
| 3 | Equipment hours are recorded in the site diary and become equipment cost (hours × the equipment's hourly COST rate) when the diary is signed. |
| 4 | Hours are entered daily and submitted weekly per employee (Mon–Sun). |

## Deliverables
- **Time tracking:** entries per employee, project, site and day, with start/end or hours, class and note. The flow is DRAFT → SUBMITTED → APPROVED/REJECTED → EXPORTED. Approved entries are locked; corrections are separate audited correction entries (± hours) that go through approval. Supervisors can enter hours for a crew in one form. Approved hours export to CSV for payroll (no payroll integration is fabricated).
- **Site diary:** one per site and day. Attendance comes from time entries, plus equipment hours, work done, delays, instructions and photos. A supervisor signs it, which locks it (DB trigger) and freezes an attendance snapshot. Later additions are audited addenda.
- **Budget and costs:** budget versions (version 1 = original). Lines are editable only while the version is a DRAFT; activating a version supersedes the previous one. Manual cost entries cover materials, subcontracting and other costs; labour and equipment actuals are computed.
- **Project finance dashboard:** budget vs actual by category, hours, unpriced hours (no applicable hourly rate), pending approvals and unsigned diaries.
- **Mobile "Today" section** on the dashboard: quick hour entry and today's diaries.

## Calculation rules (ADR 0010)
- Decimal arithmetic only (no floats). Each entry's cost is rounded to cents (half-up); totals are sums of the rounded entry costs.
- Only HOUR cost rates are applied. Entries without a valid hourly rate are reported as *unpriced* and are not silently priced.
- One currency per project (the company default). Rates in another currency are reported as unpriced.

## Migration impact
- New tables only: `time_entries`, `daily_reports`, `daily_report_entries`, `daily_report_attachments`, `budgets`, `budget_lines`, `cost_entries`.
- New permissions (migration): `timesheet.submit`, `timesheet.manage`, `timesheet.approve`, `timesheet.export`, `diary.view`, `diary.manage`, `diary.sign`, `finance.view` (sensitive), `finance.manage` (sensitive). The same migration adds them to existing companies' template roles, according to the V2 role matrix in the release report.
- No breaking changes to V1 tables.
