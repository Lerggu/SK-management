# SK Management

A multi-company construction and industrial project control platform for SK Infra, Purent and other group companies. Releases in this repository:
- **V1 — Foundation:** companies, users, roles and permissions, projects and sites, workforce, equipment, documents, the audit trail and a responsive mobile/desktop UI ([report](docs/V1_REPORT.md)).
- **V2 — Site execution & project finance foundation:** time tracking with weekly approval, payroll CSV export, the site diary with signing, budget versions, project costs and budget vs actual ([plan](docs/V2_PLAN.md), [report](docs/V2_REPORT.md)).
- **V3 — Takt & look-ahead:** takt structure (buildings, takt areas, work packages), versioned takt plans with a locked baseline, the takt board, dependencies and constraints with readiness states, progress, MS Project XML / P6 XER import and the 2/6/12-week resource look-ahead ([plan](docs/V3_PLAN.md), [report](docs/V3_REPORT.md)).
- **V7 — HSE & portals:** safety observations, near misses and incidents with photos from the phone, triage → investigation → approved corrective actions, immediate serious-incident alerts, permits to work, risk assessments, MVR/TR inspections, LTIF and other key figures; client and subcontractor portals with e-mail link sign-in, external document sharing and electronic client approval of variations; a dedicated external-boundary security suite ([plan](docs/V7_PLAN.md), [report](docs/V7_REPORT.md)).
- **V6 — Commercial:** CRM and sales pipeline, quotes with versions and Project Director approval, contracts and milestones, variations (§21), invoice candidates from approved data with immutable CSV/JSON export, internal group invoicing at the owner's billing rate, and forecast/EAC ([plan](docs/V6_PLAN.md), [report](docs/V6_REPORT.md)).
- **V5 — Lifting & material flow:** lift plans with checks and versioning, approved by the person responsible for lifting (new Lifting Supervisor role), lifting accessory register, rigging crew via bookings, material batches, cable drums with pulls in metres, QR label PDFs and mobile scanning ([plan](docs/V5_PLAN.md), [report](docs/V5_REPORT.md)).
- **V4 — Logistics:** resource bookings with conflict detection (including cross-company bookings within the group), logistics requests with approval, gates, unloading and storage, deliveries in 30-minute gate slots with a mobile gate view, and takt linkage ([plan](docs/V4_PLAN.md), [report](docs/V4_REPORT.md)).

- Build specification: [`docs/specs/SK_MANAGEMENT_CLAUDE_MASTER.md`](docs/specs/SK_MANAGEMENT_CLAUDE_MASTER.md)
- Functional specification (Finnish): [`docs/specs/SK_management_master.md`](docs/specs/SK_management_master.md)
- Architecture decisions: [`docs/adr/`](docs/adr)
- Release reports: [`docs/V1_REPORT.md`](docs/V1_REPORT.md), [`docs/V2_REPORT.md`](docs/V2_REPORT.md), [`docs/V3_REPORT.md`](docs/V3_REPORT.md), [`docs/V4_REPORT.md`](docs/V4_REPORT.md), [`docs/V5_REPORT.md`](docs/V5_REPORT.md), [`docs/V6_REPORT.md`](docs/V6_REPORT.md), [`docs/V7_REPORT.md`](docs/V7_REPORT.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma 6 · PostgreSQL 16 · Auth.js v5 (Microsoft Entra ID) · next-intl (fi/en) · S3-compatible storage (MinIO locally) · Vitest · Playwright · dependency-cruiser.

## Local setup

Requirements: Node.js ≥ 20.9 (22 recommended), pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env                 # then set AUTH_SECRET: openssl rand -base64 32
docker compose -f docker/docker-compose.yml up -d   # PostgreSQL 16 + MinIO
pnpm db:deploy                       # apply migrations
pnpm db:seed                         # fictional demo data
pnpm dev                             # http://localhost:3000
```

Sign in on `/sign-in` with **Kehityskirjautuminen** (dev login) and pick a demo user. The dev login is available only when `DEV_LOGIN_ENABLED=true` and is **always disabled when `NODE_ENV=production`**.

| Demo user | Company / role |
|---|---|
| `group.admin@example.com` | Group owner; CEO in both SK Infra Demo and Purent Demo (company switching) |
| `ceo@skinfra.example.com` | SK Infra Demo — CEO |
| `pd@skinfra.example.com` | SK Infra Demo — Project Director |
| `pm@skinfra.example.com` | SK Infra Demo — Project Manager (assigned projects) |
| `site.manager@…`, `supervisor@…`, `logistics@…`, `hse@…`, `employee@skinfra.example.com` | Other SK Infra Demo roles |
| `subcontractor@example.com`, `client@example.com` | External roles (no cost/rate data). V7: they use the portal; `client@` is the Client approver of NDC-001 |
| `ceo@purent.example.com`, `pm@purent.example.com` | Purent Demo |

V2 demo data: `employee@`, `supervisor@` and `site.manager@skinfra.example.com` have linked employee records. Last week's crew hours are approved, the employee has submitted hours this week, there is a signed diary (last Friday) and a draft one (today), and NDC-001 has an active budget with recorded costs. Try **Tunnit** as the employee, **Tunnit → Hyväksyntä** as the site manager, and **Projektit → NDC-001 → Talous** as the project manager or CEO.

V3 demo data: Data Hall A (NDC-001) has a takt plan "Data Hall A – sähkötahti" with six takt areas and five work packages. Version 1 is the approved baseline, with progress up to today, constraints and one blocked activity. Version 2 is an open draft where cabling is shifted by two days. Try **Tahti** as `pm@` (board, compare, look-ahead, import) and as `supervisor@` (one-tap progress on a phone). The sample schedule files `tests/fixtures/schedules/data-hall-b.xml` and `.xer` can be imported.

V4 demo data: Data Hall A has two gates, an unloading point and two storage locations. Today's deliveries are one stored, one confirmed and linked to an approved request and a takt activity, and one planned. There is also a pending lift request. The bookings are an approved crane booking, an overlapping crane request (conflict), an electrician crew for tomorrow, and a request for Purent's shared forklift. Try **Logistiikka** as `logistics@skinfra.example.com` (board, requests, gates), the gate view as `supervisor@` on a phone, **Resurssivaraukset** as `pm@`, and the incoming request as `ceo@purent.example.com`.

V5 demo data (Data Hall A):
- **Lift plans:** an approved lift plan for the pending LIFT request, with a crane operator booked, and a transformer lift awaiting approval with warnings.
- **Lifting accessories:** five accessories, one of them with an overdue inspection.
- **Cable drums:** four drums, two with pulls traced to takt activities.
- **Material batches:** three batches at different stages.

Try:
- **Nostot** as `lifting@skinfra.example.com` (Lifting Supervisor) to approve.
- **Materiaalit** and **Skannaa QR** as `supervisor@` on a phone. Type a code such as `KK-0001`.
- **QR-tarrat (PDF)** to print labels.

V6 demo data (SK Infra Demo):
- **Customers:** three customers with contacts.
- **Opportunities:** a pipeline of three.
- **Quotes:** a won quote that became the NDC-001 contract, with milestones, and a phase-2 quote awaiting approval.
- **Variations:** three, at different stages.
- **Forecast:** estimates to complete.
- **Billing:** generated invoice candidates.

Try:
- **Myynti** as `pm@skinfra.example.com`.
- Approve the phase-2 quote as `pd@skinfra.example.com` (Project Director).
- **Sopimus ja ennuste** on project NDC-001.
- **Laskutus** to export a CSV.

V7 demo data (NDC-001):
- **HSE:** observations and a near miss (by the subcontractor), a closed first-aid incident, an open lost-time incident under investigation with fictional injured-person data and a corrective action awaiting the PM's approval.
- **Planning and records:** two toolbox talks, three MVR inspections (index 88 → 94), an approved risk assessment linked to the transformer lift, and permits requested by the subcontractor.
- **Portal content:** the 110 kV drawing shared with the client and subcontractors (only approved revision A is visible to them), and the variation "UPS-tilan lisäpistorasiat" waiting for the client in the portal.

Try:
- **Työturvallisuus** as `employee@` on a phone (report with a photo) and as `hse@skinfra.example.com`.
- The portal as `client@example.com` (approve the variation) and `subcontractor@example.com` (report, request a permit).
- The e-mail link: enter `subcontractor@example.com` under "Asiakkaat ja aliurakoitsijat" on the sign-in page and open the link from `/dev/mailbox` (development only).

E-mail: set `SMTP_URL` (e.g. `smtp://user:pass@smtp.example.com:587`) and `MAIL_FROM` for real delivery. Without SMTP, development uses the dev mailbox and production hides the e-mail sign-in.

All seed data is fictional. Never put real personal data in seed files.

### Microsoft Entra ID

Register an app in Entra ID with redirect URI `<AUTH_URL>/api/auth/callback/microsoft-entra-id`, then set `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` and `AUTH_MICROSOFT_ENTRA_ID_ISSUER` (`https://login.microsoftonline.com/<tenant-id>/v2.0`). Only invited users can sign in. Invite people under **Asetukset → Käyttäjät** (Settings → Users).

## Database and migrations

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Create and apply a new migration in development (`prisma migrate dev`) |
| `pnpm db:deploy` | Apply pending migrations (CI and production) |
| `pnpm db:seed` | Seed fictional demo data (idempotent: skips if it already exists) |
| `pnpm db:reset` | Drop, re-migrate and re-seed the development database |
| `pnpm db:generate` | Regenerate the Prisma client |

All schema changes go through Prisma migrations. Triggers, check constraints and partial indexes are hand-written SQL in migrations ([ADR 0004](docs/adr/0004-database-integrity.md)). Permission changes need a new migration.

## Testing

| Command | Scope |
|---|---|
| `pnpm test:unit` | Vitest unit tests: permission resolution, guards, validation, audit masking, document versioning, rate periods, i18n catalogues, dev-login guard |
| `pnpm test:integration` | Vitest against **real PostgreSQL** (`TEST_DATABASE_URL`, recreated each run): module services, DB integrity, tenant isolation suite, role × action authorization matrix |
| `pnpm test` | Both of the above |
| `pnpm test:migrations` | Empty DB → migrate → schema drift check → seed |
| `pnpm test:e2e` | Playwright at desktop and mobile (Pixel 7) viewports on a fresh E2E database; also writes `docs/screenshots/` |
| `pnpm lint` / `pnpm typecheck` / `pnpm depcruise` | ESLint, TypeScript, architecture layer rules |
| `pnpm check` | lint + typecheck + depcruise + unit + integration |

Integration and E2E tests need the docker-compose services running. `RATE_LIMIT_SIGN_IN` raises the sign-in rate limit; it is meant only for automated test environments (Playwright sets it). E2E starts `next dev` on port 3100, because the dev login is disabled in production builds. If Playwright's bundled browser is not installed, set `PW_CHROMIUM=/path/to/chromium`.

**Tenant isolation rule:** every service method listed in `src/modules/registry.ts` must have a case in `tests/isolation/isolation.test.ts`. CI fails otherwise.

## Project structure

```
src/app/            UI routes, server actions, /api/v1 route handlers
  (auth)/sign-in    sign-in (Entra + dev login)
  c/[companySlug]/  dashboard, projects (+finance, +takt structure), time (+approvals, export), diary, takt (+board, activities,
                    compare, import, lookahead), logistics (+gate, requests, deliveries, bookings, setup),
                    lifting (+plans, accessories), materials (+drums, batches, labels PDF), scan,
                    sales (+customers, opportunities, quotes), billing (+exports), projects/[id]/commercial,
                    workforce, equipment, documents, settings (+calendar)
src/modules/        domain modules: identity, companies, projects, workforce, equipment, documents,
                    timesheets, diary, finance (finance/calculations.ts = all cost formulas),
                    takt (calendar.ts, engine.ts = scheduling rules; import/ = MSPDI and XER parsers),
                    logistics (rules.ts = slots, workflows, booking conflicts),
                    lifting (rules.ts = lift plan checks, material flow, cable pulls),
                    commercial (rules.ts = quote/variation pricing, forecast/EAC, CSV export)
                    (schemas.ts = Zod validation, repo.ts = company-scoped repository, service.ts)
src/platform/       auth, authz, audit, db, storage, errors, config, i18n, ratelimit, labels (QR label PDF), ai (interface), integrations (interfaces)
src/ui/             app shell, responsive navigation, shadcn/ui components
prisma/             schema.prisma, migrations/, seed.ts
tests/              integration/, isolation/, e2e/, helpers/
docker/             docker-compose.yml (postgres, minio)
docs/               adr/, specs/, screenshots/, release plans and reports
```

## Security notes

- Company scoping is server-side on every request: the URL company is checked against your membership, repositories inject `company_id`, and composite foreign keys prevent cross-company references. Cross-company access returns 404.
- Capability-based permissions. Cost and rate data need separate permissions and are never available to Client or Subcontractor roles.
- Audit log is append-only (DB triggers). Sensitive values are masked.
- Uploaded files are served only as attachments with `nosniff`. Active content types are refused.
- Secrets come from the environment only. `.env` is git-ignored.
