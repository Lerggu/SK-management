# CLAUDE.md — SK Management

This file is the standing brief for Claude Code in this repository. Read it at the start of every session.

## Source documents (authoritative)
- `docs/specs/SK_MANAGEMENT_CLAUDE_MASTER.md` — Build Master: HOW to build (rules, stack, releases V1–V8).
- `docs/specs/SK_management_master.md` — Functional master (Finnish): WHAT the system does.

Read both fully before any architectural change. If this file and the Build Master conflict, the Build Master wins, except where the owner-approved decisions below are more specific.

## Current release: V8 — AI & Optimization (APPROVED by owner 2026-10-05; stop report delivered)
V1–V7 are complete (`docs/V1_REPORT.md` … `docs/V7_REPORT.md`). V8 scope and owner decisions: `docs/V8_PLAN.md` (RLS first; AI Project Controller on the Claude API; 10 €/month/company cap; no personal data; `ai.use`); report: `docs/V8_REPORT.md`.
HR extension (owner request 2026-10-06): personnel card, competence matrix, assessments, cards with e-mail reminders, orientations, permits, clothing and company items — `docs/adr/0025-hr-competence.md`, user guide `docs/HR_GUIDE.md`.
Production control (owner approval 2026-11-17, starts the AI Logistics Controller §27 in four phases): takt and logistics under one menu item "Tuotannonohjaus"; all four phases done (task types and rule-based staffing, production calendar, phone deviations, AI staffing suggestions and §27 risks) — `docs/adr/0026-production-control.md`. Resource optimization beyond that (automatic rescheduling, cross-company pooling) still needs explicit owner approval.
Workforce rotation (owner request 2026-11-18): rotation calendar with sites and statuses (work/site, off, vacation, sick, training, other), work/off rhythm, sick leave visible only with `rotation.manage` — `docs/adr/0027-workforce-rotation.md`.
Personal identity code (owner request 2026-11-18): encrypted at the application layer (`SK_FIELD_KEY` from Key Vault `field-key`), only `employee.pid.manage`, every view audited, never in lists/exports/AI — `docs/adr/0028-personal-identity-code.md`.
Teams (owner request 2026-11-18): `teams` with leader, one team per person (`employees.team_id`, `employees.team` is the cached name), rotation can place a whole team — `docs/adr/0029-teams.md`.
Member access (owner request 2026-11-18): personal extra permissions per member (externals never sensitive/company-wide), registration form on first sign-in — `docs/adr/0030-member-access-and-registration.md`.
Assistant (owner approval 2026-11-18): voice/text assistant proposes actions, a person confirms, executed through the normal services; names may go to the AI for the assistant only (never identity codes or rates); speech via Azure AI Speech — `docs/adr/0031-assistant.md`. WhatsApp is a later phase needing its own approval. Never put API keys in files or commits; `SK_ANTHROPIC_API_KEY`/`ANTHROPIC_API_KEY` come from the environment only.

Marketing automation (owner request and decisions 2026-11-17): discovery agent (TED API, AI web search, TSOs, Hilma) fills the marketing register; letter agent drafts targeted letters and call scripts; a person approves before sending (`auto_send` off by default); Reply-To goes to the chosen salespeople; unsubscribe link and do-not-contact list; no AI robocalls (call list instead); separate monthly marketing AI budget; access only for the CEO and Project Manager roles (owner 2026-11-18; never other roles or personal extras) — `docs/adr/0032-marketing-automation.md`, user guide `docs/MARKETING_GUIDE.md`.

Order confirmations and invoices (owner request and decisions 2026-11-24): order confirmations, invoices and credit notes in the SK Infra layout (the owner's model confirmation) with the logo, sent as a PDF attachment to any e-mail; SK Management numbers the invoices (accounting gets copies); only companies with billing set up (SK Infra) can issue; rental or sales terms attached per document (starting texts to be reviewed by a lawyer); an issued document is immutable and corrected with a credit note; `invoice.manage` to use, `company.manage` for the settings — `docs/adr/0033-sales-documents.md`.
Site map (owner request 2026-11-24): tab "Aluekartta" in production control — an overview image per site (image or PDF converted in the browser), objects (gates with codes become logistics locations, cranes, storage, danger zones …), logistics tasks dragged onto the map and objects, deviations reported on an object; objects with an open deviation (own or a pinned task's) blink red; `logistics.view` to see and report, `logistics.approve` to change — `docs/adr/0034-site-map.md`. The demo seeds a fictional data centre site plan (`prisma/seed-assets/ndc-site-plan.png`).
AI budget holds (V8 §5 fix, 2026-11-25): every AI run (controller, assistant, staffing, §27 risks, marketing) first reserves part of its monthly cap in `ai_budget_holds` under a per-company advisory lock, so concurrent runs cannot all pass the cap check; holds are released when the cost is recorded and expire after 15 minutes — `docs/adr/0035-ai-budget-holds.md`.
Purent: the owner reported on 2026-11-24 that Purent is no longer in the program. It remains only as the second demo/test company used to verify tenant isolation, and in the install examples (`infra/`), until the owner decides otherwise.

## Owner requirements (binding)
1. Finnish is the default UI language; English is available from V1 (i18n from day one, no hard-coded UI strings).
2. SK Infra and Purent are separate companies on the same platform. The multi-company architecture exists from day one.
3. Resources may later be shared between companies, but ownership, costs, billing and permissions always remain company-specific. Never model a resource, rate or cost without an owning company.
4. Takt control (V3) and logistics/resource scheduling (V4–V5) are core future capabilities. V1 must not create limitations for them. In particular:
   - the project hierarchy must extend to Site → Building/Area → Takt Area → Work Package → Activity without breaking changes;
   - employees and equipment must be representable as bookable resources later (stable IDs, owning company, status, availability-ready);
   - cross-company use of a resource must be expressible later as a booking by another company, not by changing ownership.
5. Mobile usability for site personnel is a priority: large touch targets, minimal typing, mobile navigation tested at phone viewport sizes.
6. Run and verify tests continuously while building. Never report a test as passing that has not been run.

## Approved V1 architecture
- Modular monolith: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui. No microservices.
- Layers: `app/` (UI, server actions, `/api/v1` route handlers) → `modules/*/service` → repositories → Prisma → PostgreSQL 16.
- Every service method takes a `RequestContext` (user, active company, resolved permissions). Authorization, Zod validation and audit writing happen in services, never in UI only.
- Layer boundaries are enforced by lint (dependency-cruiser): `app/` must not import Prisma, and domain modules must not import vendor SDKs.
- AI and integrations: interfaces only in V1, with no implementations and no fabricated integrations.

### Tenant isolation (non-negotiable)
1. The company is explicit in the URL (`/c/[companySlug]/…`) and validated against the user's membership on every request.
2. Company-scoped repositories inject `company_id` into every query. Cross-company access returns 404, not 403.
3. Composite foreign keys (e.g. `sites(company_id, project_id) → projects(company_id, id)`) prevent cross-company references at the database level.
4. Postgres row-level security is planned as additional hardening before V7. Do not implement it in V1 unless trivial, and record the decision in an ADR.

### Repository structure
```
src/app/            (auth)/sign-in, c/[companySlug]/{dashboard,projects,workforce,equipment,documents,settings}, api/v1
src/modules/        identity, companies, projects, workforce, equipment, documents  (service, repo, policy, schemas, tests)
src/platform/       auth, authz, audit, db, storage, errors, config, i18n, ai (interface), integrations (interfaces)
src/ui/             app shell, responsive nav, shared components
prisma/             schema.prisma, migrations/, seed.ts
tests/              integration/, isolation/, e2e/
docker/             docker-compose.yml (postgres, minio)
docs/               README, adr/, specs/
.github/workflows/  ci.yml
```

### Data conventions
- UUIDv7 IDs; `timestamptz` stored in UTC and displayed in Europe/Helsinki time.
- `created_at/by` and `updated_at/by` on records; archive with `archived_at` rather than hard-deleting.
- Money is `numeric(14,2)` plus a currency code (default EUR), never a float.
- All schema changes go through Prisma migrations. Never change schemas, permissions or calculations silently.

### V1 tables
- Identity: organizations, companies, users, user_identities, accounts, sessions, organization_memberships, company_memberships, membership_roles, roles (company-scoped, from system templates, with `project_access` = ALL | ASSIGNED), permissions, role_permissions, project_memberships.
- Projects: projects (customer name as text until CRM arrives in V6), sites. Buildings/areas/takt areas are deferred to V3, but the design must allow them.
- Workforce: employees, employee_rates (separate table with separate permission; cost and billing rates with validity periods).
- Equipment: equipment_types, equipment (owner company, current project/site, meter hours, next inspection date), equipment_rates (separate and permissioned).
- Documents: documents, document_versions (never overwritten; CURRENT/SUPERSEDED; SHA-256; approval state), document_links (polymorphic). Storage goes through an S3 adapter, with MinIO locally.
- System: audit_events (append-only; a database trigger blocks UPDATE/DELETE; written in the same transaction as the change; sensitive fields masked in deltas).

### Authentication and RBAC
- Auth.js v5 with a Microsoft Entra ID provider, plus a dev-only credentials login that is hard-disabled in production by an environment guard.
- Database sessions. Invitation-based access (no open sign-up). Rate limits on sign-in and uploads.
- Capability permissions (e.g. `project.view`, `project.manage`, `employee.manage`, `employee.rates.view`, `equipment.manage`, `equipment.rates.view`, `documents.manage`, `company.members.manage`, `audit.view`). Code checks permissions, never role names.
- Seed the 10 roles from the Build Master as templates. CEO and Project Director get `project_access = ALL`; all other roles get `ASSIGNED`.
- Effective permissions = union of company roles and project role. Sensitive fields are stripped in output mappers without explicit permission. The Client and Subcontractor templates never receive cost or rate data.
- Present the proposed role × permission matrix in the V1 report.

### Audit coverage in V1
Company changes, memberships, role/permission changes, sign-ins, create/update/archive of projects, sites, employees and equipment, rate changes, and document versions and status changes.

## Work order
1. Repository skeleton, tooling (lint, typecheck, dependency-cruiser), docker-compose, env config, CI.
2. Prisma schema and migrations for all V1 tables, including the audit trigger and composite foreign keys.
3. Auth (Entra provider + dev login), RequestContext, permission resolution, scoped repositories, audit service.
4. Then work through the V1 acceptance criteria in Build Master §35 one by one, writing tests alongside each.
5. Seed data: fictional only (SK Infra Demo, Purent Demo, Nordic Data Center Demo, sample sites, employees, equipment and documents). Never use real personal data.
6. README: local setup, migrations, seeding, testing.

## Testing rules
- Unit tests (Vitest): permission resolution, validation, document versioning, audit masking.
- Integration tests against real Postgres in Docker, not mocks.
- Tenant isolation suite: every service method registers an isolation case (company A user → company B data → 404). CI fails if a service has no case.
- Authorization matrix: table-driven role × permission × action tests, including "Client cannot see rates".
- Migration test: apply to an empty DB, check for no schema drift, and verify the seed runs.
- Playwright E2E at mobile and desktop viewports: sign-in, company switching, project and site creation, employee CRUD, equipment CRUD, document with two versions.

## Definition of done
Build Master §45 applies to every feature.

## Stop report after V1
When V1 is complete, stop and report:
1. What was implemented, mapped to the §35 acceptance criteria.
2. Database schema summary.
3. Test results (actual run output counts).
4. Security and tenant-isolation verification.
5. Known limitations.
6. How to run the system.
7. Screenshots (Playwright) or descriptions of the main V1 views.
8. Proposed V2 plan.

Then wait. Do not begin V2 without explicit owner approval.
