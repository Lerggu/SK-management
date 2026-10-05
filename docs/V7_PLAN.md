# V7 — HSE & Portals: plan

- Approved by the owner: 2026-10-05 ("hyväksyn suositukset, saa aloittaa V7")
- Scope: Build Master §23 (HSE), §41 (V7), §5/§6 (permissions, audit); functional master items 21 (HSE), 27 (Client Portal) and the subcontractor portal ("V7: HSE + asiakas- ja alihankkijaportaalit").
- Out of scope:
  - AI suggestions (V8);
  - offline sync (mobile forms stay server-rendered; photos upload from the phone camera);
  - legally binding e-signatures;
  - Entra B2B (can be added later as an extra provider, ADR 0020).

## Build (§41)
Full HSE workflows, a client portal, a subcontractor portal and external permission boundaries, followed by dedicated security testing.

## Owner decisions (2026-10-05, recommendations accepted)

| # | Decision |
|---|---|
| 1 | External users sign in with an **e-mail link** (magic link). Internal users keep Entra ID. Entra B2B can be added later. |
| 2 | The client can **approve variations electronically in the portal**, on a frozen version, after the Project Director's internal approval. |
| 3 | HSE metrics and incident handling as recommended (below). |

## 1. E-mail link sign-in (decision 1)
- **Who can use it:** only invited, active users whose every active membership consists of external roles (Client, Client approver, Subcontractor). An internal user asking for a link silently gets nothing, so the response never reveals whether an address exists.
- **The link:**
  - a 32-byte random token; only its SHA-256 is stored (`email_sign_in_tokens`);
  - valid for 15 minutes and single use (consumed by one atomic UPDATE);
  - opening the link shows a confirmation button and the token is consumed by a POST, so mail scanners that prefetch links cannot use it up.
- **Rate limits:** per e-mail address and per IP.
- **Session:** an external session lasts 8 hours (internal sessions 12 hours). Every sign-in is audited with provider `email`.
- **Mail:** a `Mailer` interface in `platform/mail`:
  - SMTP (nodemailer) when `SMTP_URL` is configured;
  - in development and test, a dev outbox table (`dev_mail_outbox`) shown at `/dev/mailbox`, hard-disabled in production like the dev login;
  - with no mailer, the e-mail sign-in is not offered.

## 2. Client approval of variations (decision 2)
- **Snapshot on internal approval:** when the Project Director's internal approval moves a variation to `SUBMITTED_TO_CLIENT`, a `variation_client_approvals` row is created with:
  - a frozen snapshot: number, title, description, client reference, sales price and currency (never costs or margin);
  - its SHA-256.
- **Who decides:** only a person holding `variation.client_approve` on that project, through the new **Client approver** project role, which is external.
  - They approve or reject the snapshot they saw: the hash is posted back and must match.
  - The decision, person, time and IP are audited; the variation moves to APPROVED/REJECTED in the same transaction.
- **Locked in the database:** a DB trigger keeps the snapshot and hash immutable, and the decision can be set only once.
- **Paper approvals:** internal users can still record a decision received outside the portal (channel `RECORDED`, as in V6).
- **Not a signature:** this is not an advanced electronic signature. A signed document can still be attached as evidence (V6).

## 3. HSE (§23, decision 3)
Records: safety observation and near miss (`hse_observations`), incident (`incidents` + `incident_persons`), corrective action (`hse_actions`), toolbox talk, risk assessment (+ items), permit to work, inspection (MVR/TR/general), photos (`hse_photos`), and links to V5 lift plans.

**Incident handling**
1. **Report:** anyone with `hse.create`, including employees and subcontractors, reports from the phone with an optional photo.
2. **Triage:** the Site Manager (`hse.manage`) confirms type and severity, records immediate actions and assigns corrective actions.
3. **Investigation:** lost-time and serious incidents must be investigated. The HSE role (`hse.investigate`) records the root cause and closes them; minor incidents can be closed by `hse.manage`.
4. **Approval of corrective actions:** incident corrective actions are approved by the Project Manager (`hse.action.approve`). An incident cannot be closed while any of its actions is unapproved.
5. **Notification:** a serious or lost-time report immediately notifies holders of `hse.serious.notify` on the project (Project Director, HSE, CEO). The notification goes in-app (HSE dashboard "urgent" list) and by e-mail, with no personal data.

**Personal data:** injured-person details (`incident_persons`) need `hse.personal.view` (HSE, CEO). It is a sensitive permission, so it is never granted to external roles, and the fields are masked in audit deltas.

**Permits to work:** requested with `hse.create` (subcontractors too) and approved by `permit.approve` (Site Manager, HSE, Project Director). The requester cannot approve their own permit. A lifting permit can link to a V5 lift plan.

**Risk assessments:**
- DRAFT → APPROVED, approved by another person holding `hse.manage`;
- frozen after approval by a DB trigger;
- risk score = likelihood × consequence (1–5 × 1–5).

**Metrics** (centralized and unit tested in `modules/hse/rules.ts`):
- **LTIF:** lost-time injuries × 1,000,000 / hours. Hours are approved V2 hours of the company's own people. Subcontractor hours are not in the system, which is a stated limitation.
- **Report rate:** (observations + near misses) × 1,000 / hours.
- **Incidents** by severity.
- **Corrective actions:** open and overdue.
- **Toolbox talks:** count and attendees.
- **MVR/TR index:** 100 × correct / (correct + incorrect), latest and trend.

## 4. Portals and external boundaries
- **Client portal** (`portal.client`), per assigned project:
  - schedule progress from the takt plans: baseline start, planned finish, % complete;
  - HSE key figures, aggregated only (no names, no free-text descriptions);
  - shared documents;
  - variations waiting for approval and decided variations (approvers only).
- **Subcontractor portal** (`portal.subcontractor`):
  - report safety observations, near misses and incidents, and follow **their own** reports;
  - request permits to work and follow their own;
  - shared documents.
- **Documents:** project documents get `shared_with_client` and `shared_with_subcontractors` flags (default off). External members see only shared documents and only their APPROVED versions. Changing the flags needs `documents.approve` and is audited.
  - This **tightens V1–V6**, where external members saw every document of an assigned project.
- **Navigation:** external members land in the portal. Internal pages (projects, takt, logistics, …) redirect them to the portal, and the services still enforce permissions underneath.
- **Security tests:** a dedicated external-boundary suite:
  - client and subcontractor contexts call every registered service method;
  - only an explicit allow-list may succeed, and its outputs are scanned for cost, rate, price and personal fields;
  - plus tests for the e-mail link (expiry, reuse, enumeration, internal users), snapshot tampering, approver-only decisions and own-reports-only.

## Permissions (migration)

| Key | Sensitive | Granted to |
|---|---|---|
| `hse.view` | no | CEO, PD, PM, SM, SUP, LOG, HSE, EMP, LIFT |
| `hse.create` | no | everyone above + SUB |
| `hse.manage` | no | CEO, PD, PM, SM, HSE |
| `hse.investigate` | no | CEO, HSE |
| `hse.action.approve` | no | CEO, PD, PM |
| `hse.serious.notify` | no | CEO, PD, HSE |
| `hse.personal.view` | **yes** | CEO, HSE |
| `permit.approve` | no | CEO, PD, SM, HSE |
| `portal.client` | no | Client, Client approver |
| `portal.subcontractor` | no | Subcontractor |
| `variation.client_approve` | no | Client approver (project role) |

- New external role template **Client approver** (`CLIENT_APPROVER`): project.view, documents.view, portal.client, variation.client_approve. It is assigned as a project role to the named client person.
- Existing companies get the new permissions and the new role by migration, with an audit event per company.

## Migration impact
- New tables: `hse_observations`, `incidents`, `incident_persons`, `hse_actions`, `toolbox_talks`, `risk_assessments`, `risk_assessment_items`, `work_permits`, `hse_inspections`, `hse_photos`, `variation_client_approvals`, `email_sign_in_tokens`, `dev_mail_outbox`.
- `documents` gets two boolean columns (default false), which is non-breaking for the schema but changes external visibility (see above).
- No V1–V6 table changes otherwise.

## Acceptance criteria (proposed)
1. **Reporting:** an employee or subcontractor can report an observation, near miss or incident from the phone with a photo in under a minute.
2. **Incident workflow:** serious incidents follow triage → investigation → approved actions → close. Closing with unapproved actions is blocked, and PD and HSE are notified immediately.
3. **Personal data:** injured-person data is visible only with `hse.personal.view` and masked in audit.
4. **Permits and risk assessments:** neither can be approved by its own author, and an approved risk assessment is frozen.
5. **Metrics:** LTIF, report rate and MVR index come from centralized, tested formulas.
6. **Client portal:** the client sees progress, aggregated HSE, shared documents and pending variations, and nothing internal.
7. **Client approval:** only the named approver can approve, only the frozen version, and only once.
8. **Subcontractor portal:** a subcontractor sees only their own reports and permits and the documents shared with subcontractors.
9. **E-mail link:** single use, expires in 15 minutes, rate limited, no user enumeration, external users only.
10. **Security:** the external-boundary security suite passes, and every new service method has an isolation case.
