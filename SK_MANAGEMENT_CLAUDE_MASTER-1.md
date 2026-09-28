# SK MANAGEMENT — CLAUDE CODE BUILD MASTER
Version: 1.0
Purpose: Technical build specification for SK Management

## 0. ROLE AND OPERATING RULES

You are the lead software architect and senior full-stack engineer for SK Management.

Read the complete SK Management functional master specification before making architectural changes. This document defines HOW the product is to be built; the functional master defines WHAT it must do.

Core rules:
1. Do not attempt to build the whole ERP in one pass.
2. Implement in controlled releases V1–V8.
3. Before each release, produce a short implementation plan and migration impact summary.
4. Preserve existing working functionality unless a change is explicitly required.
5. Never silently change database schemas, permissions, financial calculations or scheduling logic.
6. Use migrations for database changes.
7. Write tests for business-critical logic.
8. Prefer maintainable, boring, well-supported technology over unnecessary complexity.
9. Design mobile-first for site operations and desktop-first for planning/management views.
10. The system must remain AI-provider-independent.
11. Financial and operational records require audit trails.
12. Human approval remains mandatory for AI-proposed operational changes.
13. Multi-company isolation and authorization are non-negotiable.
14. Do not fabricate integrations. Use adapter interfaces and mock/sandbox implementations until credentials/API contracts exist.

## 1. PRODUCT

SK Management is a multi-company construction and industrial project control platform designed especially for:
- data centers
- 110 kV / HV cable installation
- electrical and network infrastructure
- industrial construction
- lifting and rigging
- heavy handling
- site logistics
- workforce and equipment resource management.

Primary operating principle:

TAKT
→ LOGISTICS
→ RESOURCES
→ EXECUTION
→ FINANCE
→ AI ANALYSIS

Takt determines what should happen.
Logistics ensures materials and access are available.
Resources ensure people and equipment are available.
Execution records what actually happened.
Finance measures cost, revenue and margin.
AI detects deviations and proposes actions.

## 2. RECOMMENDED TECHNICAL STACK

Default stack unless the existing repository already has a suitable stack:

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- accessible component library such as shadcn/ui
- responsive PWA-ready architecture

Backend:
- Next.js server/API layer initially
- TypeScript service/domain layer
- separate services later only when scale justifies them

Database:
- PostgreSQL
- Prisma ORM or an equivalent strongly typed migration-capable ORM

Authentication:
- Microsoft Entra ID / Microsoft 365 SSO as preferred enterprise identity
- architecture must permit alternative identity providers
- local development authentication supported

Storage:
- S3-compatible object storage abstraction
- SharePoint/OneDrive adapter later

Infrastructure:
- Docker-compatible
- environment-based configuration
- staging and production separated
- CI/CD through GitHub Actions when repository is connected

AI:
- provider abstraction
- OpenAI / Anthropic or other models selectable through adapters
- no business-critical truth stored only inside model context

Do not introduce microservices in V1.

## 3. ARCHITECTURE

Use clear layers:

UI
↓
Application/API
↓
Domain services
↓
Persistence
↓
PostgreSQL

Cross-cutting:
- authentication
- authorization
- audit
- notifications
- document storage
- integration adapters
- AI services

Domain modules must not directly depend on a specific AI vendor.

## 4. MULTI-COMPANY MODEL

Hierarchy:

Organization / Group
→ Company
→ Project
→ Site
→ Building / Area
→ Takt Area
→ Work Package
→ Activity

Examples of companies may include SK Infra and Purent.

Every operational record that belongs to a company must be company-scoped.

Users may belong to multiple companies through memberships.

Never rely only on UI filtering for tenant isolation. Enforce authorization server-side.

Core entities:
- organizations
- companies
- users
- company_memberships
- roles
- permissions
- projects
- project_memberships

## 5. ROLE-BASED ACCESS CONTROL

Initial roles:
- CEO
- Project Director
- Project Manager
- Site Manager
- Supervisor
- Logistics Coordinator
- HSE
- Employee
- Subcontractor
- Client

Permissions must be capability based, not hard-coded solely by role name.

Examples:
project.view
project.manage
finance.view
finance.manage
takt.manage
logistics.request
logistics.approve
equipment.manage
timesheet.submit
timesheet.approve
variation.create
variation.approve_internal
hse.create
hse.manage
documents.manage

Client users must never see internal margin/cost data unless explicitly granted.

## 6. AUDIT TRAIL

Create immutable audit events for critical changes:
- contract values
- budgets
- approved timesheets
- variations
- invoices/export states
- resource booking changes
- takt baseline changes
- HSE records
- permissions
- document revisions.

Store:
actor
timestamp
entity type
entity ID
action
before/after or structured delta
company/project context.

## 7. CORE DATABASE DOMAINS

Identity:
organizations
companies
users
company_memberships
roles
permissions

CRM:
customers
contacts
opportunities
opportunity_activities

Commercial:
quotes
quote_versions
quote_items
contracts

Projects:
projects
sites
buildings
areas
takt_areas
work_packages
activities
milestones

Takt:
takt_plans
takt_plan_versions
takt_cycles
takt_assignments
dependencies
constraints
progress_updates

Resources:
employees
employee_assignments
competences
employee_competences
equipment
equipment_types
equipment_assignments
equipment_inspections
maintenance_records

Logistics:
resource_requirements
resource_bookings
logistics_requests
delivery_bookings
deliveries
transport_orders
gates
unloading_zones
storage_locations

Materials:
materials
material_batches
material_movements
cable_drums

Lifting:
lift_requests
lift_plans
lift_approvals
rigging_crews
lifting_accessories

Execution:
timesheets
timesheet_entries
daily_reports
daily_report_entries
progress_records

Finance:
budgets
budget_lines
cost_entries
revenue_entries
purchase_orders
invoice_candidates
invoice_exports
forecast_snapshots

Variations:
variations
variation_cost_items
variation_approvals

HSE:
hse_observations
incidents
toolbox_talks
risk_assessments
permits
inspections

Documents:
documents
document_versions
document_links

System:
notifications
audit_events
integration_connections
integration_sync_logs
ai_runs
ai_recommendations

Use UUIDs unless the existing stack has a strong reason not to.

Use timestamps and created_by/updated_by where appropriate.

Use soft deletion only where legally/operationally appropriate. Financial, HSE and audit records should generally be archived rather than destructively deleted.

## 8. TAKT ENGINE

Takt is a first-class domain, not merely calendar events.

Required concepts:
- baseline takt plan
- versioned plans
- takt areas
- work packages
- activities
- planned start/end
- actual start/end
- crew requirement
- equipment requirement
- material readiness
- prerequisite constraints
- progress %
- status
- delay reason
- recovery action.

Statuses:
NOT_READY
READY
IN_PROGRESS
BLOCKED
COMPLETE

Readiness must consider configurable constraints:
- predecessor complete
- drawings approved
- material available
- workforce available
- equipment available
- permit available
- area available.

Never automatically overwrite a baseline schedule.

Changes create a new plan/version or approved adjustment.

## 9. LOOK-AHEAD ENGINE

Generate:
- 2-week operational view
- 6-week resource view
- 12-week procurement/resource forecast.

For every future activity calculate requirements for:
- workforce by competence
- equipment
- lifting
- materials
- delivery slots
- logistics resources.

Highlight shortages and conflicts.

## 10. RESOURCE SCHEDULING ENGINE

A resource may be:
- person
- crew
- equipment
- lifting asset
- logistics asset
- temporary facility.

Booking requires:
resource
company
project
site
activity/takt assignment when applicable
start/end
status
requester
approver.

Detect:
- overlapping bookings
- unavailable resource
- competence mismatch
- inspection/maintenance conflict
- working-time conflict where rules are configured.

Do not automatically resolve conflicts without approval.

## 11. LOGISTICS CONTROL

Build a logistics control board with:
- timeline/calendar
- resource pool
- delivery schedule
- gate schedule
- unloading schedule
- internal movements
- takt-linked requirements.

Logistics Request fields:
requesting company
project
site
takt area
activity
service type
requested start/end
load description
weight
dimensions
pickup
destination
required equipment
attachments
priority
status.

Workflow:
DRAFT
→ REQUESTED
→ REVIEW
→ APPROVED
→ SCHEDULED
→ IN_PROGRESS
→ COMPLETE
→ CANCELLED

## 12. DELIVERY MANAGEMENT

Delivery lifecycle:

PLANNED
→ CONFIRMED
→ ARRIVED_GATE
→ CHECKED_IN
→ UNLOADING
→ STORED
→ MOVED_TO_WORKFACE
→ CONSUMED / INSTALLED

Track:
supplier
carrier
vehicle
driver where permitted
delivery slot
gate
unloading resource
material
quantity
weight
storage location
target takt activity.

## 13. MATERIAL FLOW

Every important material movement can be recorded.

For critical assets such as cable drums support:
- unique ID
- QR code
- manufacturer
- cable type
- length
- weight
- drum dimensions
- current location
- reserved activity
- received date
- inspection
- remaining length when relevant.

## 14. LIFTING & RIGGING

Lift request includes:
- load
- weight
- dimensions
- center-of-gravity notes
- pickup
- destination
- requested time
- site/area
- attachments
- requested crane/equipment if known.

Support:
- crane/resource allocation
- rigging crew
- lifting accessories
- lift plan
- risk assessment link
- approval chain
- completion record.

## 15. WORKFORCE

Employee profile:
company
employment/reference status
trade
competences
projects
rotations
availability
cost rate
billing rate where authorized
travel/accommodation data references
documents.

Do not expose salary/cost data to unauthorized roles.

## 16. COMPETENCE ENGINE

Competences have:
name
issuer
issued date
expiry date
document
verification status.

Warn at configurable intervals, e.g. 90/60/30/7 days.

Resource allocation may flag or block assignment if mandatory competence is missing/expired.

## 17. EQUIPMENT

Track:
owner company
equipment type
identifier
location
project
availability
hourly internal cost
billing rate
inspection status
maintenance
meter hours
documents.

Calculate:
utilization
revenue
cost
contribution
idle time.

## 18. DAILY SITE CONTROL

Mobile Today screen:
- assigned crew
- tasks
- takt activities
- deliveries
- lifts
- equipment
- HSE actions
- blockers.

Fast actions:
Start task
Complete task
Add photo
Create variation
Create safety observation
Request logistics
Report blocker.

## 19. SITE DIARY

Generate a draft daily report from structured data:
- attendance
- hours
- completed work
- equipment
- deliveries
- lifts
- HSE
- photos
- delays
- instructions
- weather integration later.

Supervisor reviews and signs before finalization.

AI may draft prose but may not finalize/sign reports.

## 20. TIME TRACKING

Time entries must support:
employee
company
project
work package
takt area
activity
date
start/end or quantity
overtime classification
notes
approval state.

Workflow:
DRAFT → SUBMITTED → APPROVED → EXPORTED

Approved entries become locked except via controlled correction.

## 21. VARIATIONS

Variation lifecycle:
DRAFT
→ INTERNAL_REVIEW
→ SUBMITTED_TO_CLIENT
→ APPROVED / REJECTED
→ EXECUTED
→ READY_TO_INVOICE
→ INVOICED

Track:
description
cause
client instruction/reference
photos/documents
labor
equipment
materials
subcontract
cost
markup
sales price
approval evidence.

Dashboard must expose approved-but-uninvoiced value.

## 22. FINANCIAL PROJECT CONTROL

Do not build statutory accounting.

Build project control:
- original budget
- current budget
- committed cost
- actual cost
- accrued/estimated cost
- earned/recognized revenue as configured
- invoiced revenue
- unbilled revenue
- forecast cost
- forecast revenue
- margin €
- margin %
- EAC.

All formulas must be centralized and tested.

Financial integrations use adapters.

## 23. HSE

Support:
Safety Observation
Near Miss
Incident
Toolbox Talk
Risk Assessment
Permit to Work
Inspection
Lift Plan links.

Mobile-first with photos and offline-tolerant design where feasible.

## 24. DOCUMENT CONTROL

Documents require:
company/project/site scope
category
revision/version
status
owner
issue date
approval state
superseded flag.

Never replace an approved revision invisibly.

Users must clearly see CURRENT vs SUPERSEDED.

## 25. AI ARCHITECTURE

AI is advisory.

Implement an AI provider interface.

AI functions:
- Project Controller
- Logistics Controller
- site diary drafting
- document summarization
- risk detection
- resource conflict explanation
- cost/margin deviation explanation
- natural-language querying of authorized project data.

Every AI run should store:
user
context scope
provider/model
timestamp
prompt template version
structured result
approval/action state where applicable.

Never give AI unrestricted database access.
Use controlled tools/query functions and enforce the requesting user's permissions.

## 26. AI PROJECT CONTROLLER

Examples:
"How is Muhos project doing?"
"Why did margin fall this week?"
"What approved variations remain uninvoiced?"
"Which takt activities are at risk?"

Return evidence-based answers from structured system data.

Clearly distinguish:
FACT
FORECAST
AI RECOMMENDATION.

## 27. AI LOGISTICS CONTROLLER

Inputs:
takt schedule
resource bookings
deliveries
workforce
equipment
material readiness
constraints.

Detect:
- delivery risk
- resource shortage
- booking conflict
- idle capacity
- downstream takt impact.

Propose actions, but never reschedule automatically without authorized human approval.

## 28. NOTIFICATIONS

Initial notification types:
- competence expiry
- resource conflict
- delayed delivery
- blocked takt activity
- pending approval
- unapproved variation
- approved uninvoiced variation
- maintenance/inspection due
- document revision update.

In-app first.
Email/Teams later through adapters.

## 29. MOBILE / OFFLINE

PWA-ready.

Critical site forms should be usable on mobile with:
- large touch targets
- minimal typing
- photo upload
- QR scanning
- cached drafts when connection is poor.

Never claim offline sync is complete until conflict resolution has been implemented and tested.

## 30. SEARCH

Global authorized search across:
projects
people
equipment
documents
deliveries
materials
variations.

Search results must respect company/project permissions.

## 31. INTEGRATION ADAPTERS

Prepare interfaces for:
- Microsoft Entra ID
- Outlook/Microsoft 365
- SharePoint/OneDrive
- accounting/ERP
- payroll
- GPS/telematics
- maps
- weather
- Power BI/export.

No integration secrets committed to source control.

## 32. SECURITY

Mandatory:
- server-side authorization
- tenant/company scoping
- secure sessions
- CSRF/XSS/SQL injection protections through framework best practices
- rate limits for sensitive endpoints
- encrypted transport
- secrets in environment/secret store
- audit logs
- dependency scanning
- backups and restore plan before production.

Use least privilege.

## 33. DATA PROTECTION

Minimize personal data.
Define retention policies.
Separate sensitive employee/financial fields.
Log access to sensitive data where appropriate.
Prepare export/deletion workflows subject to legal retention requirements.

## 34. UX PRINCIPLES

Desktop:
information-dense project control without clutter.

Mobile:
action-oriented.

Navigation:
Dashboard
Projects
Takt
Logistics
Workforce
Equipment
Materials
Lifting
Sales
Finance
HSE
Documents
AI

Use consistent statuses, filters and saved views.

## 35. V1 — FOUNDATION

Build first:
- repository/app skeleton
- authentication foundation
- organization/company model
- users/memberships/RBAC
- projects/sites
- employees
- equipment
- documents
- audit framework
- responsive navigation
- dashboard shell.

V1 must NOT attempt full Takt, logistics AI or finance.

### V1 acceptance criteria
1. User can sign in.
2. Authorized user can create/select company.
3. Company isolation is enforced server-side.
4. Authorized user can create project and site.
5. Employee CRUD works with permissions.
6. Equipment CRUD works with permissions.
7. Documents support metadata and versions at foundation level.
8. Audit events exist for critical V1 mutations.
9. Responsive mobile/desktop navigation works.
10. Automated tests cover tenant isolation and major permission rules.
11. Seed/demo data can be created for development.
12. README explains local setup, migrations and testing.

STOP after V1 and present:
- implemented features
- architecture decisions
- database schema summary
- tests
- known limitations
- recommended V2 plan.

Do not start V2 without user approval.

## 36. V2 — SITE EXECUTION & PROJECT FINANCE FOUNDATION

Build:
daily site management
site diary
time tracking
basic project budget/cost control
approval workflows
basic project dashboard.

Acceptance:
approved time entries feed project actual labor cost;
site diary can be reviewed/finalized;
budget vs actual is visible;
corrections are audited.

STOP for approval.

## 37. V3 — TAKT

Build:
takt areas
work packages
activities
baseline/versioning
visual takt board
dependencies
constraints
progress
2/6/12-week look-ahead.

Acceptance:
baseline cannot be silently overwritten;
schedule changes are versioned;
blocked/readiness states work;
look-ahead produces resource requirements.

STOP for approval.

## 38. V4 — LOGISTICS

Build:
resource pools
resource requirements
resource bookings
logistics requests
delivery slots
gates/unloading/storage
conflict detection
takt linkage.

Acceptance:
conflicting bookings are detected;
logistics can be traced to takt activity;
delivery schedule works on mobile and desktop.

STOP for approval.

## 39. V5 — LIFTING & MATERIAL FLOW

Build:
lift requests
lift plans
rigging allocation
lifting accessories
material tracking
cable drums
QR workflows.

STOP for approval.

## 40. V6 — COMMERCIAL

Build:
CRM
opportunities
quotes
quote versions
contracts
variations
invoice candidates
financial forecasting/EAC
integration export interfaces.

STOP for approval.

## 41. V7 — HSE & PORTALS

Build:
full HSE workflows
client portal
subcontractor portal
external permission boundaries.

Perform dedicated security testing before release.

STOP for approval.

## 42. V8 — AI & OPTIMIZATION

Build:
AI Project Controller
AI Logistics Controller
resource optimization suggestions
natural-language authorized analytics.

AI recommendations require human approval before operational changes.

STOP for approval.

## 43. TESTING STRATEGY

Required:
unit tests for domain calculations
authorization tests
tenant isolation tests
API integration tests
critical workflow tests
migration tests
E2E tests for major user journeys.

Critical financial and scheduling formulas require deterministic tests.

## 44. DEVELOPMENT DATA

Create safe fictional seed data.

Example:
Company: SK Infra Demo
Project: Nordic Data Center Demo
Sites/areas/takt areas
sample employees
sample equipment
sample documents.

Never place real employee personal data in repository seed files.

## 45. DEFINITION OF DONE

A feature is not done until:
- authorization is implemented
- validation exists
- errors are handled
- audit requirements are met
- responsive UI works
- tests pass
- migrations exist
- documentation is updated.

## 46. INITIAL CLAUDE CODE TASK

When this file and the SK Management functional master are first provided:

1. Read both documents fully.
2. Inspect the repository if one exists.
3. Do NOT code yet.
4. Produce:
   - proposed V1 architecture
   - repository structure
   - database/domain model for V1
   - authentication/RBAC plan
   - testing strategy
   - deployment assumptions
   - open questions only where a decision genuinely blocks implementation.
5. Avoid asking questions whose answers can safely be deferred.
6. Wait for explicit approval before implementing V1.

## 47. LONG-TERM PRODUCT PRINCIPLE

SK Management should first solve SK Infra's real operational problems extremely well.

Architecture should nevertheless permit later commercialization as a multi-tenant SaaS platform for data center, industrial and infrastructure construction.

Do not compromise SK Infra's operational usability merely to optimize for hypothetical future SaaS requirements.
