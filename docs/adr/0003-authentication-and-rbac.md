# ADR 0003 — Authentication and capability-based RBAC

- Status: Accepted (V1)

## Authentication
- **Auth.js v5** (`next-auth@5 beta`) with the **Microsoft Entra ID** provider and the Prisma adapter. Sessions are **database sessions** (`sessions` table, 12 h, sliding 1 h).
- **Invitation-only**: an admin invites an e-mail, which creates the user and an `INVITED` membership. The Auth.js `signIn` callback allows only active users who have an INVITED or ACTIVE membership in a non-archived company. The first sign-in activates the invitation. There is no open sign-up.
- An invited user is linked to their Entra account by e-mail (`allowDangerousEmailAccountLinking`). This is acceptable because the issuer is pinned to our tenant and only invited addresses are accepted. Entra e-mails are lower-cased (enforced by a check constraint).
- **Dev login** (`src/platform/auth/dev-login.ts`) creates a normal database session for a seeded user. It is **hard-disabled when `NODE_ENV=production`**, whatever `DEV_LOGIN_ENABLED` says (`isDevLoginEnabled`, unit tested).
- Every sign-in writes `user_identities`, `users.last_sign_in_at` and an `auth.sign_in` audit event per company.
- Rate limits: sign-in (10 per 5 min per IP / e-mail) and uploads (30 per 10 min per user). They are in-memory, which is a known limitation.

## Authorization
- **Capabilities, not role names.** The catalogue is in `src/platform/authz/permissions.ts` and mirrored in the `permissions` table by migration (a test keeps them in sync).
- **Roles are company records** created from 10 templates (Build Master §5) when a company is created. Companies can edit role permissions.
- `project_access`: CEO and Project Director have **ALL**; every other role has **ASSIGNED** (it sees only projects it is a member of).
- **Effective permissions** = union of company roles ∪ the project role (for project-scoped actions). Project roles cannot grant company-only capabilities such as workforce, equipment or administration.
- **External roles (Client, Subcontractor)** never receive sensitive (cost/rate) permissions. This is enforced three ways: the service rejects such role edits, the resolver strips them even if the database is misconfigured, and external members never get ALL project access or company-internal documents.
- Not visible → 404; visible but not permitted → 403.
- Sensitive output fields (rates) are attached by output mappers only with `*.rates.view`. Without it the key is absent from the response.

## Role × permission matrix (V1)
See the stop report / README. Verified by `tests/integration/authz-matrix.test.ts`.
