# ADR 0005 — PostgreSQL row-level security deferred to before V7

- Status: Accepted (V1)

## Context
CLAUDE.md asks for RLS as additional hardening before V7 (external portals), and to implement it in V1 only if trivial.

## Decision
RLS is **not** implemented in V1. In V1, isolation relies on:
1. the URL company validated against membership on every request;
2. company-scoped repositories injecting `company_id`;
3. composite foreign keys that make cross-company references impossible;
4. the isolation test suite covering every service method.

RLS is not trivial here. It needs a per-transaction `SET LOCAL app.company_id`, a non-owner application database role, and policies on ~20 tables. It must also be compatible with the seed, migrations and the audit trigger. Doing it properly is a V6/V7 hardening task, scheduled before external users (clients and subcontractors) get portals.

## Consequences
A bug that bypasses the repository layer could read across tenants. This risk is mitigated by the dependency-cruiser rule that stops `app/` importing Prisma directly, by code review, and by the isolation suite.
