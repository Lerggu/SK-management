# ADR 0022 — PostgreSQL row-level security

- Status: Accepted (V8, owner decision 1). Resolves CLAUDE.md tenant isolation rule 4.

## Context
Tenant isolation has been enforced since V1 by:
- company-scoped repositories;
- composite foreign keys;
- the isolation suite.

With external users (V7) and AI reading data (V8), the database itself should refuse cross-company rows even if a repository forgets its company condition.

## Decision
- **Role.** Migration `v8_rls` creates the NOLOGIN role `sk_app` and grants it DML on all tables, with default privileges for future tables. A non-superuser application login is made a member of it; a superuser needs no grant. `sk_app` is not a table owner, so the policies apply to it. Policies are not FORCEd: the owner role keeps unrestricted access for migrations, identity paths and fixtures.
- **Scope.** `withTenantScope({ companyId, organizationId })` uses AsyncLocalStorage.
  - Inside a scope, `runInTransaction` starts with `SET LOCAL ROLE sk_app` and `set_config('app.company_id' / 'app.organization_id', …, true)`.
  - `readClient()` returns a Prisma client extension that runs each query in a short batch transaction with the same statements.
  - Settings and role are transaction-local, so pooled connections never leak a scope.
- **Where the scope comes from.**
  - `src/modules/registry.ts` wraps every method of every registered service once at load. A call whose first argument is a company `RequestContext` runs in that company's scope.
  - The app, the test setup and the seed import the registry.
  - The meta-test in `tests/integration/rls.test.ts` fails if a method is not wrapped.
- **Unscoped paths.** UserContext calls (company selection, profile), sign-in, e-mail links and `resolveRequestContext` stay unscoped. They read by user id or slug before a company is known.
- **Policies.**
  - **Every table with `company_id`:** `tenant_isolation` — `company_id = app_company_id()` for USING and WITH CHECK.
  - **Group exceptions (permissive SELECT), as decided in V4–V6:**
    - employees and equipment `shareable_in_group`, and equipment types of the organization;
    - resource bookings within the organization (conflict checks). The resource owner may UPDATE (decide) bookings of its resources;
    - projects, sites, takt activities, takt areas and resource requirements referenced by a booking of the reader's resource (the owner sees the booking's context);
    - invoice candidates billed to the reader (internal invoicing).
  - **Audit events:** read own company; insert own, another group company, or company-less.
  - **Audit write mechanics:** `writeAudit` uses `createMany`, an INSERT without RETURNING, so cross-company audit rows pass without becoming readable.
- **No change for tables without `company_id`** (organizations, companies, users, sessions, permissions, tokens).

## Consequences
- **Defence in depth.** A missing company condition in a repository now returns nothing from other companies, and a write is rejected (`42501`). This is verified by `rls.test.ts`.
- **Test coverage.** All V1–V7 integration tests (2037) pass with RLS active.
- **Cost.** Each scoped read is a three-statement transaction; this is acceptable at current volumes and should be measured before scaling out.
- **Production requirement.** The database login must be able to `SET ROLE sk_app`. The migration grants it when it runs as a non-superuser that has CREATEROLE or admin rights on the role; otherwise a DBA must run `GRANT sk_app TO <app user>`.
- **New tables** with `company_id` need a `tenant_isolation` policy in their migration. The pattern is in `v8_rls`.
