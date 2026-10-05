/**
 * Production bootstrap (ADR 0024): organization, first owner and companies;
 * idempotent; the owner can then sign in (company membership exists).
 */
import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { bootstrapProduction, parseCompanies } from "@/modules/system/bootstrap";
import { checkHealth } from "@/modules/system/health";
import { findSignInEligibleUser } from "@/modules/identity/service";
import { uniq } from "../helpers/fixtures";

describe("production bootstrap", () => {
  it("parses the companies setting", () => {
    expect(parseCompanies("SK Infra Oy|sk-infra|1234567-8; Purent Oy|purent")).toEqual([
      { name: "SK Infra Oy", slug: "sk-infra", businessId: "1234567-8" },
      { name: "Purent Oy", slug: "purent", businessId: undefined },
    ]);
  });

  it("creates the organization, owner and companies once", async () => {
    const s = uniq("b").toLowerCase().replace(/[^a-z0-9]/g, "");
    const email = `Owner.${s}@Example.test`;
    const input = { orgName: "Group", orgSlug: `org-${s}`, ownerEmail: email, ownerName: "Owner", companies: parseCompanies(`A Oy|a-${s}|1234567-8;B Oy|b-${s}`) };
    expect(await bootstrapProduction(input)).toEqual({ created: true, companies: [`a-${s}`, `b-${s}`] });
    expect(await bootstrapProduction(input)).toEqual({ created: false, companies: [] });

    const user = await findSignInEligibleUser(email);
    expect(user?.email).toBe(email.toLowerCase());
    const memberships = await db.companyMembership.findMany({ where: { userId: user!.id }, include: { roles: { include: { role: true } }, company: true } });
    expect(memberships.map((m) => [m.company.slug, m.status, m.roles[0].role.key]).sort()).toEqual([
      [`a-${s}`, "ACTIVE", "CEO"],
      [`b-${s}`, "ACTIVE", "CEO"],
    ]);
    const org = await db.organization.findUniqueOrThrow({ where: { slug: `org-${s}` } });
    expect(await db.auditEvent.count({ where: { organizationId: org.id, action: { in: ["organization.create", "company.create"] } } })).toBe(3);
  });

  it("rejects invalid input", async () => {
    await expect(bootstrapProduction({ orgName: "G", orgSlug: "Bad Slug", ownerEmail: "x@example.test", ownerName: "X", companies: [] })).rejects.toThrow();
  });

  it("health check reaches the database", async () => {
    expect(await checkHealth()).toEqual({ ok: true, database: "ok" });
  });
});
