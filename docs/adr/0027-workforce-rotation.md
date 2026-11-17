# ADR 0027 — Workforce rotation plan

- Status: Accepted (owner, 2026-11-18).
- The owner asked for staff rotation plans in a calendar view. People are listed at the side and placed into the calendar. Each day is marked as one of:
  - at work, on a site;
  - off;
  - on vacation;
  - sick;
  - another reason.
- The owner left the further features to us.

## Decision

### Data (`rotation_entries`, migration `20261118090000_workforce_rotation`)
- **One entry per employee per day:** `(company_id, employee_id, day)` is unique.
- **Statuses:**
  - `WORK`: optionally on a site;
  - `OFF`;
  - `VACATION`;
  - `SICK`;
  - `TRAINING`: added because it is common in practice;
  - `OTHER`: with an optional note (at most 200 characters).
- **CHECK constraints:**
  - only `WORK` names a site;
  - a site always comes with its project.
- **Isolation:** composite foreign keys to employees and sites, plus row-level security.
- **No history kept in the table:** clearing a day deletes the entry. Every change is audited as `rotation.set`, `rotation.clear` or `rotation.pattern`.
- **Company scope:** the plan is company-wide, because employees belong to the company and not to a project. Sites come from the company's active projects.

### Permissions and privacy
- **New capabilities:**
  - `rotation.view` (company-wide);
  - `rotation.manage` (company-wide, sensitive).
- **Who gets them:**

  | Role | Permissions |
  |---|---|
  | CEO, project director, project manager, site manager, HR administrator | view and manage |
  | Supervisor, logistics coordinator | view |
  | External roles and plain employees | none |

  The migration grants these to existing roles and audits the grant.
- **Health data:** sick leave is health data, and "other" may reveal private matters.
  - Without `rotation.manage`, both are shown only as **Away (`ABSENT`)**, and notes are never shown.
  - The masking is done in the service (`visibleEntry`), never only in the UI.

### Calendar (`/workforce/rotation`, tab "Rotaatio")
- **Period:** 1, 2, 4 or 6 weeks, starting on Monday. Weekends and Finnish public holidays are shaded, and holidays are named.
- **Trade filter:** limits the calendar to one trade.
- **Sites view:**
  - one row per site, with the head count per day;
  - a row for "at work, no site";
  - one row per status.
  - Managers drag a person from the side panel into a cell (desktop), or tap the person and then the cell (phone).
  - A dialog sets the status, the site, the period (from–until) and a note.
  - Clicking a name in a cell edits or clears that person's entry.
- **People view:** one row per person. Cells are coloured by status and always carry a letter and a tooltip, never colour alone. The row also shows the number of work days in the period.
- **Rotation rhythm:** applies a repeating "N days at work, M days off" rhythm to several people from one date to another, optionally on a site.
  - Vacations, sick leave, training and other absences are never overwritten.
  - Existing work and off days are replaced only on request.

### Link to production control (ADR 0026)
- Logistics staffing candidates who are away in the rotation plan on a day of the task (off, vacation, sick, training or other) get the warning **"Poissa rotaation mukaan"** (`ABSENT`).
  - The warning is not blocking, because plans change.
  - Such candidates are ranked after busy ones.
  - The AI staffing suggestion sees the warning code only.

## Consequences
- The plan is a plan, not time tracking. Timesheets stay the record of hours worked.
- A range is at most 366 days per call.
- Group-shared people (V4) are not planned here; each company plans its own employees.
