# ADR 0010 — Time tracking and project cost calculation

- Status: Accepted (V2)
- Owner decisions: `docs/V2_PLAN.md`

## Time entries
- An entry belongs to one employee, project, optional site and work date. Hours are entered either as a number or as start and end times (no overnight shifts; split them into two entries).
- Workflow: DRAFT → SUBMITTED → APPROVED | REJECTED → EXPORTED. Hours are entered daily and submitted weekly (Mon–Sun) per employee.
- Who may enter: employees enter their own hours (`timesheet.submit`, via the employee record linked to the user). Supervisors enter crew hours (`timesheet.manage`).
- Who may approve: holders of `timesheet.approve` in the project. **Nobody approves their own hours.**
- Hours not visible to a member (other people's hours without manage/approve/finance rights) are 404, following the "not visible = not found" rule.
- **Locking:** a DB trigger (`time_entries_guard`) blocks any change to APPROVED/EXPORTED rows except the APPROVED → EXPORTED export stamp, and blocks deletes. Drafts are archived, never deleted.
- **Corrections:** a new entry with `correction_of_id` and a ± hours delta, created as SUBMITTED and approved like any entry. The original stays untouched. Every step is audited.
- **Payroll export:** `timesheet.export` marks approved entries in a date range as EXPORTED under a batch id and produces a CSV (UTF-8 with BOM, `;`-separated). Entries are never exported twice. There is no payroll integration; that will come later behind `PayrollExportAdapter`.

## Cost formulas (`src/modules/finance/calculations.ts`)
- Labour = Σ round(hours × the employee's hourly COST rate valid on the work date × multiplier), over APPROVED and EXPORTED entries, corrections included.
- Multipliers: NORMAL 1.0, OVERTIME_50 1.5, OVERTIME_100 2.0, TRAVEL 1.0.
- Equipment = Σ round(diary equipment hours × the equipment's hourly COST rate on the report date), over **signed** diaries only.
- Other actuals = manual cost entries (credit notes may be negative). A cost is corrected by archiving the wrong entry and recording a new one.
- Rounding: each line is rounded to cents half-up; totals are sums of rounded lines.
- **No guessing:** day rates, billing rates, archived rates, rates in another currency and missing rates make a line *unpriced*. Unpriced lines are excluded and reported as a warning on the finance page.
- Each project uses one currency: the active budget's, defaulting to the company currency. Costs in other currencies are reported and excluded.
- Decimal arithmetic throughout (Prisma.Decimal / decimal.js); never floats.
- Every formula has deterministic unit tests (`calculations.test.ts`) and end-to-end integration tests (`tests/integration/finance.test.ts`).

## Budgets
- Versions per project; version 1 is the original. Lines are editable only in DRAFT (trigger `budget_lines_guard`).
- Activating a version supersedes the previous one. Both are frozen (trigger `budgets_guard`), and a partial unique index allows one ACTIVE version per project.
- Finance (`finance.view`, `finance.manage`) is sensitive: never available to Client or Subcontractor, even through a project role.
