# ADR 0006 — Audit trail

- Status: Accepted (V1)

- `writeAudit(tx, actor, event)` (`src/platform/audit`) is called **inside the same transaction** as the change, so the change and its audit event commit or roll back together.
- Stored: actor (user or system), time (UTC), organization, company, project, entity type and id, action, before and after, and metadata (request id, IP, user agent).
- Updates store a **structured delta** containing only changed fields. Bookkeeping fields (`updatedAt`, `updatedBy`) are ignored.
- **Masking**: employee e-mail and phone, rate amounts, and any token or secret are stored as `[MASKED]`. The audit log shows that a value changed without revealing it, because `audit.view` is not a rate permission.
- **Append-only**: database triggers reject UPDATE, DELETE and TRUNCATE. The production application role should additionally lack TRUNCATE privileges.
- V1 coverage: company create and update, memberships (invite, accept, role and status changes), role permission changes, sign-ins, create/update/archive of projects, sites, employees, equipment and equipment types, project membership, rates (create, auto-close, archive), and document create/update/archive, versions, approvals and links.
- A unit test checks that every audit action written by the code has a label in both languages.
