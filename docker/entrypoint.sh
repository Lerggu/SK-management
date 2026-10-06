#!/bin/sh
# Container start (ADR 0024): database roles (when DATABASE_ADMIN_URL is set),
# apply pending migrations, run the one-time
# bootstrap (no-op unless BOOTSTRAP_OWNER_EMAIL is set and the organization
# does not exist yet), then serve the app.
set -e
./node_modules/.bin/tsx scripts/db-bootstrap.ts
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/tsx scripts/bootstrap.ts
exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-8080}"
