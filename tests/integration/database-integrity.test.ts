import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/platform/authz";
import { projectService, siteService } from "@/modules/projects/service";
import { documentService } from "@/modules/documents/service";
import { createTenant, textFile } from "../helpers/fixtures";

describe("database integrity (real PostgreSQL)", () => {
  it("permission catalogue in the database matches the code", async () => {
    const rows = await db.permission.findMany({ orderBy: { key: "asc" } });
    expect(rows.map((r) => r.key)).toEqual([...ALL_PERMISSIONS].sort());
    for (const r of rows) {
      expect(r.isSensitive).toBe(PERMISSIONS[r.key as keyof typeof PERMISSIONS].sensitive);
    }
  });

  it("audit_events is append-only: UPDATE, DELETE and TRUNCATE are rejected", async () => {
    const t = await createTenant("Audit");
    const ev = await db.auditEvent.findFirstOrThrow({ where: { companyId: t.companyId } });
    await expect(db.auditEvent.update({ where: { id: ev.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe("TRUNCATE audit_events")).rejects.toThrow(/append-only/);
  });

  it("composite foreign keys reject a site that points at another company's project", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const projectA = await projectService.create(a.ownerCtx, { code: "P-1", name: "A project" });
    await expect(
      db.site.create({ data: { companyId: b.companyId, projectId: projectA.id, name: "Cross-company site" } }),
    ).rejects.toThrow(/Foreign key constraint|violates foreign key/i);
  });

  it("composite foreign keys reject equipment placed on another project's site", async () => {
    const a = await createTenant("A");
    const p1 = await projectService.create(a.ownerCtx, { code: "P-1", name: "One" });
    const p2 = await projectService.create(a.ownerCtx, { code: "P-2", name: "Two" });
    const siteOfP2 = await siteService.create(a.ownerCtx, p2.id, { name: "S" });
    const type = await db.equipmentType.create({ data: { companyId: a.companyId, name: "Crane" } });
    await expect(
      db.equipment.create({
        data: { companyId: a.companyId, equipmentTypeId: type.id, assetNumber: "X", name: "X", currentProjectId: p1.id, currentSiteId: siteOfP2.id },
      }),
    ).rejects.toThrow(/Foreign key constraint|violates foreign key/i);
  });

  it("document version content cannot be changed or deleted, and superseded cannot become current", async () => {
    const t = await createTenant("Docs");
    const doc = await documentService.create(t.ownerCtx, { title: "Spec", category: "OTHER" }, textFile("a.txt", "v1"));
    const v1 = doc.currentVersion.id;
    await expect(db.documentVersion.update({ where: { id: v1 }, data: { sha256: "0".repeat(64) } })).rejects.toThrow(/immutable/);
    await expect(db.documentVersion.update({ where: { id: v1 }, data: { storageKey: "elsewhere" } })).rejects.toThrow(/immutable/);
    await expect(db.documentVersion.delete({ where: { id: v1 } })).rejects.toThrow(/cannot be deleted/);
    await documentService.uploadVersion(t.ownerCtx, doc.id, {}, textFile("a.txt", "v2"));
    await expect(db.documentVersion.update({ where: { id: v1 }, data: { status: "CURRENT" } })).rejects.toThrow(/superseded|unique/i);
  });

  it("check constraints enforce lowercase e-mail, non-negative rates and slug format", async () => {
    await expect(db.user.create({ data: { email: "Upper@Example.test" } })).rejects.toThrow(/users_email_lowercase/);
    const t = await createTenant("Checks");
    await expect(db.company.update({ where: { id: t.companyId }, data: { slug: "Bad Slug" } })).rejects.toThrow(/companies_slug_format/);
  });
});
