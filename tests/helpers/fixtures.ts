import { randomUUID } from "node:crypto";
import { db } from "@/platform/db";
import { resetRateLimits } from "@/platform/ratelimit";
import type { RequestContext, RequestMeta, RoleTemplateKey, UserContext } from "@/platform/authz";
import { resolveRequestContext } from "@/modules/companies/context";
import { companyDirectoryService } from "@/modules/companies/service";

export const meta: RequestMeta = { requestId: "test", ip: "127.0.0.1", userAgent: "vitest" };

export function uniq(prefix = "t"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export interface Tenant {
  organizationId: string;
  companyId: string;
  slug: string;
  owner: UserContext;
  ownerCtx: RequestContext;
  roleId(key: RoleTemplateKey): Promise<string>;
}

/** Creates an organization, its OWNER and a company through the real service. */
export async function createTenant(name = "Tenant"): Promise<Tenant> {
  resetRateLimits();
  const suffix = uniq("x");
  const user = await db.user.create({ data: { email: `owner.${suffix}@example.test`, name: `${name} Owner` } });
  const org = await db.organization.create({ data: { slug: `org-${suffix}`, name: `${name} Org` } });
  await db.organizationMembership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const owner: UserContext = { kind: "user", user: { id: user.id, email: user.email, name: user.name }, meta, locale: "fi" };
  const slug = `co-${suffix}`;
  const company = await companyDirectoryService.createCompany(owner, { organizationId: org.id, name: `${name} Oy`, slug });
  const ownerCtx = await resolveRequestContext({ userId: user.id, companySlug: slug, meta, locale: "fi" });
  return {
    organizationId: org.id,
    companyId: company.id,
    slug,
    owner,
    ownerCtx,
    async roleId(key) {
      const role = await db.role.findFirstOrThrow({ where: { companyId: company.id, key } });
      return role.id;
    },
  };
}

/**
 * Adds an ACTIVE member with the given company role, optionally assigned to
 * projects (project role defaults to the same template).
 */
export async function createMember(
  tenant: Tenant,
  role: RoleTemplateKey,
  projects: { projectId: string; role?: RoleTemplateKey }[] = [],
): Promise<RequestContext> {
  const suffix = uniq("m");
  const user = await db.user.create({ data: { email: `${role.toLowerCase()}.${suffix}@example.test`, name: `${role} ${suffix}` } });
  const membership = await db.companyMembership.create({
    data: { companyId: tenant.companyId, userId: user.id, status: "ACTIVE", acceptedAt: new Date() },
  });
  await db.membershipRole.create({ data: { companyId: tenant.companyId, membershipId: membership.id, roleId: await tenant.roleId(role) } });
  for (const p of projects) {
    await db.projectMembership.create({
      data: { companyId: tenant.companyId, projectId: p.projectId, userId: user.id, roleId: await tenant.roleId(p.role ?? role) },
    });
  }
  return contextFor(tenant, user.id);
}

export function contextFor(tenant: Tenant, userId: string): Promise<RequestContext> {
  return resolveRequestContext({ userId, companySlug: tenant.slug, meta, locale: "fi" });
}

export function textFile(name = "file.txt", body = "hello") {
  return { fileName: name, bytes: new TextEncoder().encode(body) };
}

export async function auditFor(companyId: string, entityId: string) {
  return db.auditEvent.findMany({ where: { companyId, entityId }, orderBy: { occurredAt: "asc" } });
}
