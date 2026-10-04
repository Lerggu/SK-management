# ADR 0002 — Multi-company tenancy and isolation

- Status: Accepted (V1)

## Context
SK Infra and Purent are separate companies on one platform. Ownership, costs, billing and permissions are always company-specific (owner requirements 2–3). Tenant isolation is non-negotiable.

## Decision
1. **Company in the URL**: `/c/[companySlug]/…`. On every request, `resolveRequestContext` (`src/modules/companies/context.ts`) validates the slug against the user's **ACTIVE** membership. Unknown company, no membership, a disabled membership or an archived company all return **404**.
2. **RequestContext**: every service method takes a `RequestContext` (user, company, membership, resolved permissions, project access and grants, request metadata). Services never accept a company id from input.
3. **Company-scoped repositories**: each repository is constructed with `ctx.company.id` and adds `company_id` to every query, including `update`/`delete`, using Prisma's extended unique `where: { id, companyId }`. Cross-company ids are simply not found → 404.
4. **Composite foreign keys**: every company-scoped table exposes `UNIQUE (company_id, id)`, and children reference `(company_id, parent_id)`. For example `sites(company_id, project_id) → projects(company_id, id)` and `equipment(company_id, current_project_id, current_site_id) → sites(company_id, project_id, id)`. A cross-company reference is impossible at the database level.
5. **Hierarchy**: Organization (group) → Company → Project → Site. Organizations group companies. Creating a company requires an OWNER or ADMIN organization membership.
6. **Isolation test suite** (`tests/isolation`): every method in `SERVICE_REGISTRY` must have a case where a company-B user with every B permission tries to reach company-A data. A meta-test fails CI when a method has no case.

## Consequences
- Resource sharing between companies (V4) is modelled as a *booking by another company*, never as a change of `company_id` (see ADR 0008).
- Users can belong to several companies; the company switcher navigates between slugs.
