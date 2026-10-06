# ADR 0024 — Production hosting on Azure

- Status: Accepted (owner, 2026-10-05): production on Azure; the group uses Microsoft 365, and IT creates the subscription.
- IT guide: [`docs/DEPLOY_AZURE.md`](../DEPLOY_AZURE.md).

## Context
- **Platform requirements.** The application is a Next.js server with long-running requests (AI review ≤ ~60 s). It needs:
  - PostgreSQL 16 with role management for row-level security (ADR 0022);
  - the `btree_gist` extension;
  - object storage for document versions and photos;
  - SMTP;
  - Microsoft Entra ID sign-in.
- **Data residency.** Data should stay in the EU, preferably in Finland.
- **Scale.** The pilot is small: tens of users.

## Decision
- **Compute: App Service for Linux running the repository's container image** (`Dockerfile`).
  - At start, the container runs `prisma migrate deploy`, then the one-time bootstrap, then `next start` on port 8080.
  - Health check: `GET /api/health` (database round-trip, no data, no auth).
  - A serverless platform was rejected because of request duration and because RLS needs a persistent database role.
- **Database: Azure Database for PostgreSQL Flexible Server 16** (Burstable B1ms for the pilot).
  - Automatic backups with 14 days of point-in-time restore.
  - TLS is required.
  - Public endpoint limited to Azure services.
  - `azure.extensions = BTREE_GIST`.
- **Database roles** are created at container start by `scripts/db-bootstrap.ts` when `DATABASE_ADMIN_URL` (a Key Vault reference) is set. The step is idempotent, and `infra/db-bootstrap.sql` remains for a manual setup:
  - `sk_owner`: the application login. It owns the database, runs migrations and the identity paths, and is not a superuser.
  - `sk_app`: the RLS role. `sk_owner` holds membership with the ADMIN option, so the V8 migration's `GRANT sk_app TO current_user` succeeds.
  - Verified locally on a fresh PostgreSQL 16 with a non-superuser `CREATEROLE`/`CREATEDB` administrator, as on Azure:
    - all migrations apply;
    - `sk_app` without a company setting sees no tenant rows;
    - restarts are idempotent.
- **Storage: Azure Blob Storage** through a new `AzureBlobObjectStorage` adapter, selected with `STORAGE_PROVIDER=azure`.
  - The App Service managed identity authenticates (`allowSharedKeyAccess=false`: there are no storage keys).
  - Writes are conditional (`If-None-Match: *`), so document versions stay immutable, as with S3.
  - Blob and container soft delete is 30 days.
  - Locally and in CI the adapter is tested against Azurite.
  - The S3 adapter stays for MinIO and development.
- **Secrets: Key Vault** with RBAC. App settings use Key Vault references, and the App Service identity has *Key Vault Secrets User*. The infrastructure template writes only `database-url`; IT sets `auth-secret`, `entra-client-secret` and the optional `smtp-url` and `anthropic-api-key`. AI and SMTP settings are added only when their flag is on, so a missing secret never becomes a literal value.
- **Images:** Azure Container Registry (Basic). The App Service pulls images with its managed identity (*AcrPull*).
- **Deployment:** the GitHub Actions workflow `deploy.yml` runs after CI passes on `main`, or manually.
  - It authenticates with OIDC as a user-assigned managed identity. The federated credential's subject is the `githubOidcSubject` parameter (the repository uses immutable-id subjects such as `repo:Lerggu@<id>/SK-management@<id>:environment:production`), so no Azure credentials are stored in GitHub.
  - The identity holds only *Contributor* scoped to the registry (the AcrPush role id was missing in the owner's subscription), *Website Contributor* on the app and *Reader* on the resource group.
  - The workflow does nothing until the repository variables exist.
- **First tenant data.** `scripts/bootstrap.ts`, driven by `BOOTSTRAP_*` settings, creates:
  - the group organization;
  - the first owner (by Microsoft e-mail);
  - the companies, through the existing `createCompany` service, so the owner becomes CEO with audit events.

  It is idempotent and never seeds demo data.
- **Infrastructure as code:** `infra/main.bicep`, installed with one command by `infra/install.sh`. E-mail (Azure Communication Services) is added by `infra/enable-email.sh`. It compiles and lints cleanly with Bicep 0.47.
- **Runtime dependencies:** `prisma`, `tsx` and `dotenv` moved to runtime dependencies, because the container runs migrations and the bootstrap.

## Consequences
- **Cost.** The pilot costs about 35–40 €/month (B1 + B1ms + Basic registry + storage + Key Vault). Scaling up is a parameter change: `appServiceSku`, `postgresSku`.
- **Single instance.** Migrations run at container start, so the app runs as one instance; this is sufficient for the pilot. Scaling out later needs a separate migration step: a deployment job or a start-time lock.
- **Hardening deferred:**
  - private networking (VNet integration and a private endpoint for PostgreSQL and Storage);
  - Application Insights;
  - a custom domain;
  - a staging slot (needs the Standard tier).

  The PostgreSQL firewall currently admits only Azure services.
- **Deployment.** Installed by the owner with `infra/install.sh` in SK-Infra's own Azure tenant; nothing is deployed from the development environment.
