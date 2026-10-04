# ADR 0007 — Document storage and versioning

- Status: Accepted (V1)

- **Storage port** `ObjectStorage` (`src/platform/storage`) has an S3 adapter (AWS SDK v3, MinIO locally) and an in-memory adapter for tests. A SharePoint/OneDrive adapter can be added behind the same port later.
- Objects are keyed `companies/<companyId>/documents/<documentId>/versions/<versionId>` and written with `If-None-Match: *`, so they are never overwritten.
- **Upload flow**: the service validates the file (extension allow-list, which refuses HTML/SVG/JS; size limit; not empty) and computes **SHA-256**. It stores the object, then in one transaction locks the document row, supersedes the CURRENT version, inserts version *n+1* as CURRENT, and writes audit events.
- **Approval**: DRAFT → PENDING_APPROVAL (`documents.manage`) → APPROVED or REJECTED (`documents.approve`). **APPROVED is final.** Changing an approved document means uploading a new, visible version. Only the CURRENT version's approval state can change.
- **Downloads** go through an authorized route handler. Files are always served as `attachment` with `X-Content-Type-Options: nosniff`, so uploaded content never renders in the app origin.
- **Visibility**: company-level documents (no project) are internal and never visible to external roles. Project documents follow project access.
- **Local MinIO image**: upstream MinIO no longer publishes Docker images. `docker-compose.yml` uses `pgsty/minio` (a maintained build), overridable with `MINIO_IMAGE`.

Known limitation: if the database transaction fails after the object was stored, the object is orphaned but never referenced. A sweeper job can be added later.
