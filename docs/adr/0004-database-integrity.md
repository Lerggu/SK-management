# ADR 0004 — Database integrity objects outside the Prisma schema

- Status: Accepted (V1)

Prisma does not model triggers, check constraints or partial indexes. They live in `prisma/migrations/20261004172900_v1_integrity/migration.sql`, and `pnpm test:migrations` confirms they cause no schema drift.

| Object | Purpose |
|---|---|
| `audit_events_block_update_delete`, `audit_events_block_truncate` triggers | Audit log is append-only |
| `document_versions_guard` trigger | Version content (file, hash, storage key, number, revision, creator) is immutable; versions cannot be deleted; SUPERSEDED cannot become CURRENT again |
| `document_versions_one_current` partial unique index | At most one CURRENT version per document |
| `companies_slug_format`, `organizations_slug_format` | URL-safe slugs |
| `users_email_lowercase` | E-mail identity is case-insensitive |
| `*_dates_order`, `*_validity_order` | End ≥ start for projects, employees and rates |
| `*_amount_nonnegative`, `*_currency_format` | Money integrity (`numeric(14,2)` + ISO currency) |
| `equipment_site_requires_project`, `documents_site_requires_project` | A site is only meaningful within its project |
| `document_versions_sha256_format`, size/number checks | Well-formed file metadata |

The permission catalogue is reference data, inserted by migration `20261004173000_v1_permissions`. Permission changes always need a new migration.

Conventions: UUIDv7 ids (`@default(uuid(7))`), `timestamptz` in UTC (displayed in Europe/Helsinki), `created_at/by`, `updated_at/by`, archive via `archived_at`. `created_by` and `updated_by` intentionally have no FK, because the audit trail is authoritative for "who".
