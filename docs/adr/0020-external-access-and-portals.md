# ADR 0020 — External access: e-mail link sign-in, portals and client approval

- Status: Accepted (V7, owner decisions 1 and 2)

## Context
V7 opens the system to external parties: the client and subcontractors. Build Master §41 requires a client portal, a subcontractor portal, external permission boundaries and dedicated security testing. The owner decided:
1. external users sign in with an e-mail link;
2. the client can approve variations electronically in the portal.

## Decision

### External members
- **No new identity model.** External people are company members holding external role templates:
  - Client (`CLIENT`);
  - Client approver (`CLIENT_APPROVER`, new);
  - Subcontractor (`SUBCONTRACTOR`).
- **Which party a member represents.** `RequestContext.externalParties` is derived from these templates and is either `CLIENT` or `SUBCONTRACTOR`.
- **External-only permissions** (`portal.client`, `portal.subcontractor`, `variation.client_approve`):
  - never granted to internal roles: the CEO template excludes them, and role editing rejects them with `validation.externalOnly`;
  - dropped by permission resolution for members without an external company role. An internal user therefore never approves on the client's behalf, even if given the Client approver project role.
- **Sensitive permissions** (costs, rates, `hse.personal.view`) remain stripped from external members, as in V1.

### E-mail link sign-in (decision 1)
- **Only eligible users get a link.** Eligible means invited and active, with every active membership consisting of external roles only. Anyone with an internal role must use Entra ID.
- **The token:**
  - 32 random bytes (base64url); only the SHA-256 is stored (`email_sign_in_tokens`);
  - valid for 15 minutes;
  - consumed by a single conditional `UPDATE`; a DB trigger allows `consumed_at` to be set once and nothing else to change.
- **Consumption needs a POST.** The link opens a confirmation page and the token is consumed by a POST, so mail scanners that prefetch links cannot use it up. The page sets `referrer: no-referrer`.
- **No user enumeration.** Unknown, internal, disabled and rate-limited addresses all get the same response. The per-address limit (5 per 15 minutes) is silent; the per-IP limit (20 per 15 minutes) returns the usual rate-limit error.
- **Eligibility is checked again** when the link is consumed, so a membership disabled after sending makes the link useless.
- **Session and audit:** an external session lasts 8 hours (internal sessions 12 hours). Sign-ins are audited with provider `email`.
- **Mail adapter** (`platform/mail`):
  - SMTP via nodemailer when `SMTP_URL` is set;
  - otherwise, in development and test, a dev outbox table shown at `/dev/mailbox`, which is hard-disabled in production like the dev login;
  - with no mailer, the e-mail form is not shown.
- **Entra B2B** can be added later as an additional provider without schema changes.

### Portals and boundaries
- **Navigation.** External members' navigation contains only the portal. The company layout redirects them from internal pages to the portal; allowed areas are `portal`, `hse` (own records) and `documents` (shared).
  - This is defence in depth: every service still enforces its own permissions, which the security suite verifies.
- **Documents.**
  - Project documents carry `shared_with_client` and `shared_with_subcontractors`, both off by default.
  - External members see a document only when it is shared with their party, and then only its APPROVED versions. They get no links and never manage documents.
  - Sharing requires `documents.approve` and is audited. A CHECK constraint forbids sharing company-level documents.
  - **This tightens V1–V6**, where external members saw every document of an assigned project. The migration leaves existing documents internal.
- **Client portal:**
  - schedule summary (`scheduleSummaryService`): baseline dates and progress only, with no crews, resources or delay reasons;
  - aggregated HSE figures (`hseOverviewService.portalFigures`): counts and rates only;
  - shared documents;
  - variation approvals (approvers only).
- **Subcontractor portal:**
  - HSE reporting and permit requests;
  - the member's own records only; internal lift plans and staff names or e-mails are hidden;
  - documents shared with subcontractors.

### Client approval of variations (decision 2)
- **Snapshot.** The Project Director's internal approval (V6) now also creates a `variation_client_approvals` row:
  - a frozen snapshot: number, title, description, cause, client reference, sales price and currency — never costs, markup or margin;
  - its SHA-256 over canonical JSON (sorted keys).
- **The decision.** The approver posts the hash they saw. The service checks it against the stored hash, the recomputed hash of the snapshot, and the hash of the variation's current content.
  - The decision, channel `PORTAL`, user, time and IP are stored, and the variation moves to APPROVED or REJECTED in the same transaction.
  - A rejection needs a note.
- **DB rules:**
  - the trigger keeps snapshot and hash immutable and allows the decision to be set once;
  - a partial unique index allows one PENDING row per variation.
- **Decisions received outside the portal** (V6 "record client decision") close the pending row with channel `RECORDED`.
  - `publishToClient` (Project Director) re-publishes a snapshot when none is pending, for example for variations sent before V7.
- **Not a signature.** This is not an advanced electronic signature; a signed document can still be attached as evidence.

## Consequences
- **Security tests.** The dedicated suite `tests/integration/external-boundary.test.ts`:
  - calls every registered service as Client, Client approver and Subcontractor;
  - fails on any "SECRET" text or any non-null cost, rate, price or personal field in a result;
  - fails if a write that is not explicitly allowed succeeds;
  - fails if a registered service is not exercised.
  - It found, and V7 fixes, internal lift plan titles that were visible in the subcontractor's HSE register.
- **Rate limits** stay in memory per instance (V1 limitation); a shared store is needed before scaling out.
