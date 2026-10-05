import { z } from "zod";
import { db, runInTransaction } from "@/platform/db";
import { writeAudit } from "@/platform/audit";
import type { RequestMeta, UserContext } from "@/platform/authz";
import { companyDirectoryService } from "../companies/service";

/**
 * One-time production bootstrap (ADR 0024): the group organization, its first
 * owner and the first companies, so the owner can sign in with Microsoft and
 * invite everyone else from the UI. Idempotent: nothing happens when the
 * organization already exists. Never seeds demo data.
 */
const bootstrapSchema = z.object({
  orgName: z.string().trim().min(1).max(120),
  orgSlug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  ownerEmail: z.email().transform((s) => s.trim().toLowerCase()),
  ownerName: z.string().trim().min(1).max(120),
  companies: z
    .array(z.object({ name: z.string().trim().min(1).max(120), slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60), businessId: z.string().trim().max(20).optional() }))
    .min(1)
    .max(10),
});
export type BootstrapInput = z.input<typeof bootstrapSchema>;

/** "SK Infra Oy|sk-infra|1234567-8;Purent Oy|purent" → companies. */
export function parseCompanies(value: string): BootstrapInput["companies"] {
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, slug, businessId] = part.split("|").map((x) => x.trim());
      return { name, slug, businessId: businessId || undefined };
    });
}

export async function bootstrapProduction(input: BootstrapInput): Promise<{ created: boolean; companies: string[] }> {
  const data = bootstrapSchema.parse(input);
  if (await db.organization.findUnique({ where: { slug: data.orgSlug } })) return { created: false, companies: [] };

  const meta: RequestMeta = { requestId: "bootstrap", ip: null, userAgent: "bootstrap" };
  const { org, owner } = await runInTransaction(async (tx) => {
    const owner =
      (await tx.user.findUnique({ where: { email: data.ownerEmail } })) ?? (await tx.user.create({ data: { email: data.ownerEmail, name: data.ownerName } }));
    const org = await tx.organization.create({ data: { slug: data.orgSlug, name: data.orgName } });
    await tx.organizationMembership.create({ data: { organizationId: org.id, userId: owner.id, role: "OWNER" } });
    await writeAudit(tx, { kind: "system", meta, organizationId: org.id }, { action: "organization.create", entityType: "organization", entityId: org.id, after: org });
    return { org, owner };
  });

  const uctx: UserContext = { kind: "user", user: { id: owner.id, email: owner.email, name: owner.name }, meta, locale: "fi" };
  const created: string[] = [];
  for (const c of data.companies) {
    await companyDirectoryService.createCompany(uctx, { organizationId: org.id, name: c.name, slug: c.slug, businessId: c.businessId ?? "" });
    created.push(c.slug);
  }
  return { created: true, companies: created };
}
