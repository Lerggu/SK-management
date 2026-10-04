import { randomBytes } from "node:crypto";
import { readClient, runInTransaction } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import type { Locale, RequestMeta, UserContext } from "@/platform/authz";
import { z } from "zod";

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Invitation-based access: a person may sign in only if an ACTIVE user with
 * that e-mail exists and has an INVITED or ACTIVE membership in a
 * non-archived company. There is no open sign-up.
 */
export async function findSignInEligibleUser(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return readClient().user.findFirst({
    where: {
      email: normalized,
      status: "ACTIVE",
      archivedAt: null,
      companyMemberships: { some: { status: { in: ["INVITED", "ACTIVE"] }, company: { archivedAt: null } } },
    },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Records a successful sign-in: identity upsert, last sign-in time,
 * activation of pending invitations, and audit events — in one transaction.
 */
export async function recordSignIn(params: {
  userId: string;
  provider: string;
  subject: string;
  tenantId?: string | null;
  email?: string | null;
  meta: RequestMeta;
}) {
  await runInTransaction(async (tx) => {
    const now = new Date();
    await tx.userIdentity.upsert({
      where: { provider_subject: { provider: params.provider, subject: params.subject } },
      create: {
        userId: params.userId,
        provider: params.provider,
        subject: params.subject,
        tenantId: params.tenantId ?? null,
        email: params.email ?? null,
        lastSignInAt: now,
      },
      update: { lastSignInAt: now, email: params.email ?? undefined },
    });
    const user = await tx.user.update({ where: { id: params.userId }, data: { lastSignInAt: now }, select: { id: true, email: true, name: true } });
    const actor: UserContext = { kind: "user", user, meta: params.meta, locale: "fi" };

    const invited = await tx.companyMembership.findMany({
      where: { userId: params.userId, status: "INVITED", company: { archivedAt: null } },
      select: { id: true, companyId: true, company: { select: { organizationId: true } } },
    });
    for (const m of invited) {
      await tx.companyMembership.update({ where: { id: m.id }, data: { status: "ACTIVE", acceptedAt: now, updatedById: params.userId } });
      await writeAudit(tx, actor, {
        action: "membership.accept",
        entityType: "company_membership",
        entityId: m.id,
        companyId: m.companyId,
        organizationId: m.company.organizationId,
        before: { status: "INVITED" },
        after: { status: "ACTIVE" },
      });
    }

    // One sign-in event per company the user belongs to, so each company's
    // audit log shows its own members' sign-ins.
    const memberships = await tx.companyMembership.findMany({
      where: { userId: params.userId, status: "ACTIVE" },
      select: { companyId: true, company: { select: { organizationId: true } } },
    });
    const targets = memberships.length ? memberships : [{ companyId: null, company: { organizationId: null } }];
    for (const m of targets) {
      await writeAudit(tx, actor, {
        action: "auth.sign_in",
        entityType: "user",
        entityId: params.userId,
        companyId: m.companyId,
        organizationId: m.company.organizationId,
        metadata: { provider: params.provider },
      });
    }
  });
}

/** Creates a database session (used by the dev login; Entra uses Auth.js). */
export async function createDatabaseSession(userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await readClient().session.create({ data: { sessionToken, userId, expires } });
  return { sessionToken, expires };
}

/** Users offered on the dev login screen (development only). */
export async function listDevLoginUsers() {
  return readClient().user.findMany({
    where: { status: "ACTIVE", archivedAt: null, companyMemberships: { some: { status: { in: ["ACTIVE", "INVITED"] } } } },
    select: {
      id: true,
      email: true,
      name: true,
      companyMemberships: {
        where: { status: { in: ["ACTIVE", "INVITED"] } },
        select: { company: { select: { name: true } }, roles: { select: { role: { select: { name: true } } } } },
      },
    },
    orderBy: { email: "asc" },
  });
}

const localeSchema = z.object({ locale: z.enum(["fi", "en"]) });

export const profileService = {
  async getProfile(uctx: UserContext) {
    return readClient().user.findUniqueOrThrow({
      where: { id: uctx.user.id },
      select: { id: true, email: true, name: true, locale: true, lastCompanyId: true },
    });
  },

  async setLocale(uctx: UserContext, input: { locale: Locale }) {
    const { locale } = parseInput(localeSchema, input);
    await readClient().user.update({ where: { id: uctx.user.id }, data: { locale } });
    return locale;
  },
};
