-- Per-member extra permissions and the registration form on first sign-in
-- (docs/adr/0030-member-access-and-registration.md). Generated from
-- prisma/schema.prisma; row-level security and the back-fill are hand-written.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "organization" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "privacy_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "registered_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "membership_permissions" (
    "company_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "membership_permissions_pkey" PRIMARY KEY ("membership_id","permission_key")
);

-- CreateIndex
CREATE INDEX "membership_permissions_company_id_idx" ON "membership_permissions"("company_id");

-- AddForeignKey
ALTER TABLE "membership_permissions" ADD CONSTRAINT "membership_permissions_company_id_membership_id_fkey" FOREIGN KEY ("company_id", "membership_id") REFERENCES "company_memberships"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_permissions" ADD CONSTRAINT "membership_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules ──────────────────────────────────────────────────
ALTER TABLE users
  ADD CONSTRAINT users_phone_length CHECK (phone IS NULL OR char_length(phone) <= 40),
  ADD CONSTRAINT users_organization_length CHECK (organization IS NULL OR char_length(organization) <= 120),
  ADD CONSTRAINT users_job_title_length CHECK (job_title IS NULL OR char_length(job_title) <= 120);

-- ── Row-level security (ADR 0022) ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON membership_permissions TO sk_app;
ALTER TABLE membership_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_permissions
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ── Back-fill ────────────────────────────────────────────────────────
-- People who already use the system are not sent to the registration form;
-- only invited people who have never signed in fill it in.
UPDATE users u
SET registered_at = COALESCE(u.last_sign_in_at, u.created_at)
WHERE u.last_sign_in_at IS NOT NULL
   OR EXISTS (SELECT 1 FROM company_memberships m WHERE m.user_id = u.id AND m.status = 'ACTIVE');
