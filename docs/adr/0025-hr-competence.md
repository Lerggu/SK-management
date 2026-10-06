# ADR 0025 — Personnel card, competence matrix and expiry reminders

- Status: Accepted (owner request, 2026-10-06). The owner specified the scope in full: personnel card, competence matrix, supervisor assessments, languages, cards with e-mail reminders, orientations and permits to operate, attachments, work clothing, company items, summary and search.
- User guide (Finnish): [`docs/HR_GUIDE.md`](../HR_GUIDE.md).

## Context
- **Existing data is reused.** The workforce register (`employees`) already holds the name, contact details, job title, dates, status and the link to a user account. Nothing is stored twice:
  - the card extends `employees` with organisation fields (supervisor, team, location, job profile);
  - personal fields: emergency contact, preferred language, sizes, driving licence classes and the profile photo.
- **Different readers need different data:**
  - HR administration manages everything;
  - supervisors need work-related data of their own area of responsibility;
  - the employee sees their own card;
  - project and site management need the competence matrix for crew planning.
- **Separate facts.** The owner requires these to be kept as separate facts:
  - competence assessment;
  - training;
  - card validity;
  - an employer-granted permit to operate.

## Decision

### Data model
Migration `20261006120000_hr_competence` creates 15 company-scoped tables. All of them have:
- composite foreign keys `(company_id, …)`;
- UUIDv7 ids;
- `created/updated_by`;
- archiving instead of deletion;
- row-level security with the standard `tenant_isolation` policy (ADR 0022).

The tables:

| Group | Tables |
|---|---|
| Catalogues (admin) | `competence_areas` (category, key area flag, archivable), `qualification_types`, `job_profiles` + `job_requirements` (competence ≥ level, valid card type, orientation scope + topic), `hr_settings` (maintenance e-mail) |
| Competence | `competence_assessments`: one row per area per assessment; kind SUPERVISOR or SELF; level 1–4 or null = "not assessed"; DRAFT → PUBLISHED |
| Qualifications | `trainings` (planned / completed, optional expiry), `employee_qualifications` (expiry date or explicit "no expiry", `renews_id`/`replaced_at`), `equipment_authorizations`, `orientations` |
| Other | `employee_languages` (four skills × level, source SELF or SUPERVISOR), `clothing_issues`, `company_items`, `employee_files`, `expiry_reminders` |

### Database integrity rules
- **Published assessments are final.** A trigger rejects any change to a published assessment except the employee's comment and the completion of the agreed action. Assessments are never deleted. A later change is a new assessment, so the history is complete.
- **Clothing hand-outs can only be cancelled once** (trigger).
- **CHECK constraints** keep these consistent:
  - level range;
  - publication state;
  - expiry vs. "no expiry";
  - date order;
  - requirement shape;
  - sent state.

### Access policy (`src/modules/hr/access.ts`)
- **Permissions:**
  - `hr.manage` = HR admin. Granted to CEO and to the new HR_ADMIN template "Henkilöstöhallinto", which has no project, finance or rate access.
  - `hr.view` = work-related HR data of everyone. Granted to CEO, Project Director, Project Manager, Site Manager and HSE.
- **Data relations, not permissions:**
  - the **supervisor chain** (an employee's supervisor, that supervisor's supervisor, and so on);
  - **the employee themselves**, through `employees.user_id`.

| Section | Admin | hr.view | Supervisor chain | Self |
|---|---|---|---|---|
| Work data: competence, cards, trainings, orientations, permits, languages | ✓ | ✓ | ✓ | ✓ |
| Assessment drafts | ✓ | – | ✓ | own self-assessments |
| Emergency contact | ✓ | – | ✓ | ✓ |
| Clothing and items, unlinked documents | ✓ | – | – | ✓ |
| Assess / verify / grant permits / orientations | ✓ | – | ✓ | – |
| Edit phone, emergency contact, sizes, language; self-assessment; comment; acknowledge; add own cards and attachments | ✓ (except self-assessment) | – | – | ✓ |

- **Visibility errors.** Invisible employees are 404. A visible card without the capability is 403.
- **Employee-added entries.** Cards and trainings added by the employee are "awaiting check". The employee can edit them only until a supervisor or HR verifies them.
- **External parties.** External members (client, subcontractor) never get HR access. This is verified for every HR service in the external-boundary suite.

### Attachments
- **Allowed types.** JPG, PNG, WEBP and PDF only, and the file content must match the extension (magic bytes). Maximum 20 MB, or the general upload limit if lower.
- **Storage.** Files go through the existing object storage port: Azure Blob in production, with keys under `companies/<id>/employees/<id>/files/`.
- **Visibility.** A file inherits the visibility of the section it is attached to.
- **Download.** The download route serves files `inline` (preview) or as `attachment` with `nosniff` and a sandboxing CSP.
- **Removal.** Removal archives the file.

### Expiry reminders (`src/modules/hr/reminders.ts`)
- **When.** The due date is one calendar month before the last valid day. A day missing in that month becomes the month's last day (31.3. → 28./29.2.). The reminder is sent in the first run on or after the due date while the card is still valid, so a card added after the due date is reminded in the next run.
- **Recipients.** The card owner (the employee's e-mail, else the linked user's e-mail) and the maintenance address from the HR settings.
- **Deduplication.** One `expiry_reminders` row per record + expiry date + recipient (unique key). A run first claims a row (`PENDING/FAILED/NO_ADDRESS → SENDING`, stale SENDING after 30 min) and sends it only if the claim succeeded, so reruns and parallel instances never double-send.
- **Recording success.** `SENT` is written only after the mail server accepted the message. Failures are stored per recipient and retried, up to 8 attempts.
- **New cycles.** Renewing a card (a new record) or changing its expiry date starts a new cycle automatically, because the expiry date is part of the key.
- **Mail not enabled.** Nothing is marked sent and the UI says so.
- **Schedule.**
  - `src/instrumentation.ts` starts an hourly scheduler in the Node.js server process (App Service runs with Always On).
  - It is on by default in production; `HR_REMINDERS=on|off` and `HR_REMINDER_INTERVAL_MINUTES` override it.
  - `pnpm hr:reminders` runs the job once.
  - HR admins can run it from the settings page.

### UI
- Everything stays within *Henkilöstö*:
  - tabs for people, competence matrix, cards and qualifications, summary and settings;
  - the personnel card has tabs for basics, competence, qualifications, languages, equipment and documents.
- Users with a linked card get *Oma kortti* in the navigation.
- Validity and levels are shown with text and colour. "Not assessed" is drawn as a dashed dash, never like a low level.

## Consequences
- **Single-instance scheduler.** The scheduler lives in the app process. If the app scales out, every instance runs it, but the claim makes this safe. An external scheduler can call `pnpm hr:reminders` instead.
- **Personal data kept to a minimum.**
  - There are no health fields.
  - The emergency contact is optional and narrowly visible.
  - Assessment free texts are masked in audit deltas. The change itself, the actor and the time are still recorded.
- **Not implemented:**
  - automatic sending of other HR notifications, such as upcoming assessments; these are listed in the summary instead;
  - payroll integration of clothing.
