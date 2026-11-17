# ADR 0030 — Personal extra permissions and the registration form

- Status: Accepted (owner request, 2026-11-18).
- The owner asked for three things:
  - extra permissions defined per user, including for external users who have registered;
  - a registration form for invited people, if one did not exist (it did not).

## Decision

### Personal extra permissions (`membership_permissions`)
- **What:** capabilities given to one member on top of their roles.
  - Managed in *Asetukset → Käyttäjät → henkilö → Lisäoikeudet*.
  - Needs `company.roles.manage`.
  - Audited as `membership.permissions_update`.
- **Resolution:** `resolvePermissions` adds the extras like a role. Every check uses them, including:
  - the request context;
  - notification recipients (deviations, serious incidents);
  - the last-admin rule.
- **External members:** never receive sensitive or company-wide capabilities. This is enforced twice: by the service when saving, and by `resolvePermissions`.
  - The page offers external members only allowed ones.
  - Portal capabilities stay with external roles, so they are never extras.
  - Extras never make a member external and never widen project access.
- **Members list:**
  - external users are marked;
  - the details they gave at registration (organisation, title, phone) are shown;
  - the number of extra permissions is shown.

### Registration form (`/welcome`)
- **When:** an invited person who has not registered is sent to the form on their first sign-in. This happens on `/`, the company picker and every company page.
- **Fields:**
  - name (prefilled);
  - phone (optional, format checked);
  - organisation (required for external users: "the company you represent");
  - job title;
  - language;
  - acceptance of a short notice on how their data is used (required).
- **Validation:** all errors are reported together.
- **Storage:** stored on the user (`phone`, `organization`, `job_title`, `registered_at`, `privacy_accepted_at`).
- **Audit:** `user.register`, with the phone masked.
- **Existing users:** people who had already signed in, or had an active membership, were marked registered by the migration, so the form is only for new invitees. Seeded demo users are registered.

## Consequences
- **The data notice is a short summary.** A full privacy notice document from the company can be linked from it later.
- **The profile cannot yet be edited afterwards.** A "my profile" page would reuse the same service.
