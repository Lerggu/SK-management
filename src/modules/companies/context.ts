import { readClient } from "@/platform/db";
import { NotFoundError, UnauthenticatedError } from "@/platform/errors";
import { resolvePermissions, type Locale, type RequestContext, type RequestMeta, type UserContext } from "@/platform/authz";

/**
 * Builds the UserContext for an authenticated, active user.
 */
export async function resolveUserContext(userId: string, meta: RequestMeta, locale: Locale): Promise<UserContext> {
  const user = await readClient().user.findFirst({
    where: { id: userId, status: "ACTIVE", archivedAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new UnauthenticatedError();
  return { kind: "user", user, meta, locale };
}

/**
 * Builds the RequestContext for a company-scoped request.
 *
 * The company comes from the URL slug and is validated against the user's
 * ACTIVE membership on every request. Any mismatch — unknown slug, archived
 * company, no membership, disabled membership — is a 404 so that other
 * tenants' existence is not revealed.
 */
export async function resolveRequestContext(params: {
  userId: string;
  companySlug: string;
  meta: RequestMeta;
  locale: Locale;
}): Promise<RequestContext> {
  const client = readClient();
  const membership = await client.companyMembership.findFirst({
    where: {
      userId: params.userId,
      status: "ACTIVE",
      company: { slug: params.companySlug, archivedAt: null },
      user: { status: "ACTIVE", archivedAt: null },
    },
    select: {
      id: true,
      company: { select: { id: true, slug: true, name: true, organizationId: true, defaultCurrency: true } },
      user: { select: { id: true, email: true, name: true } },
      roles: {
        where: { role: { archivedAt: null } },
        select: {
          role: { select: { templateKey: true, projectAccess: true, permissions: { select: { permissionKey: true } } } },
        },
      },
    },
  });
  if (!membership) throw new NotFoundError();

  const projectMemberships = await client.projectMembership.findMany({
    where: { companyId: membership.company.id, userId: params.userId, archivedAt: null, role: { archivedAt: null } },
    select: {
      projectId: true,
      role: { select: { templateKey: true, projectAccess: true, permissions: { select: { permissionKey: true } } } },
    },
  });

  const toGrant = (r: { templateKey: string | null; projectAccess: "ALL" | "ASSIGNED"; permissions: { permissionKey: string }[] }) => ({
    templateKey: r.templateKey,
    projectAccess: r.projectAccess,
    permissions: r.permissions.map((p) => p.permissionKey),
  });

  const resolved = resolvePermissions(
    membership.roles.map((mr) => toGrant(mr.role)),
    projectMemberships.map((pm) => ({ projectId: pm.projectId, role: toGrant(pm.role) })),
  );

  return {
    kind: "company",
    user: membership.user,
    meta: params.meta,
    locale: params.locale,
    company: membership.company,
    membershipId: membership.id,
    permissions: resolved.permissions,
    projectAccess: resolved.projectAccess,
    external: resolved.external,
    externalParties: resolved.externalParties,
    projectGrants: resolved.projectGrants,
  };
}
