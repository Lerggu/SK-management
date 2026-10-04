import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { documentService } from "@/modules/documents/service";
import { projectService } from "@/modules/projects/service";
import { employeeService } from "@/modules/workforce/service";
import { sha256Hex } from "@/modules/documents/versioning";
import { auditFor, createMember, createTenant, textFile } from "../helpers/fixtures";

describe("documents", () => {
  it("two versions: v1 SUPERSEDED, v2 CURRENT, SHA-256 and content preserved", async () => {
    const t = await createTenant("Docs");
    const p = await projectService.create(t.ownerCtx, { code: "D", name: "D" });
    const doc = await documentService.create(t.ownerCtx, { title: "Drawing", category: "DRAWING", projectId: p.id, revisionLabel: "A" }, textFile("plan.txt", "rev A"));
    const v2 = await documentService.uploadVersion(t.ownerCtx, doc.id, { revisionLabel: "B", changeNote: "Route changed" }, textFile("plan.txt", "rev B"));
    const detail = await documentService.get(t.ownerCtx, doc.id);
    expect(detail.versions.map((v) => [v.versionNumber, v.status, v.revisionLabel])).toEqual([
      [2, "CURRENT", "B"],
      [1, "SUPERSEDED", "A"],
    ]);
    expect(detail.versions[0].sha256).toBe(sha256Hex(new TextEncoder().encode("rev B")));
    const v1File = await documentService.downloadVersion(t.ownerCtx, detail.versions[1].id);
    expect(new TextDecoder().decode(v1File.body)).toBe("rev A");
    expect(v2.versionNumber).toBe(2);
    const actions = (await db.auditEvent.findMany({ where: { companyId: t.companyId, entityType: { in: ["document", "document_version"] } } })).map((a) => a.action);
    expect(actions.sort()).toEqual(["document.create", "document_version.create", "document_version.create"]);
  });

  it("approval workflow: approved versions are final; only the current version can change state", async () => {
    const t = await createTenant("Approve");
    const doc = await documentService.create(t.ownerCtx, { title: "RAMS", category: "RAMS" }, textFile("rams.pdf", "%PDF"));
    const v1 = doc.currentVersion.id;
    await documentService.setVersionApproval(t.ownerCtx, v1, { state: "PENDING_APPROVAL" });
    const approved = await documentService.setVersionApproval(t.ownerCtx, v1, { state: "APPROVED" });
    expect(approved.approvedById).toBe(t.ownerCtx.user.id);
    await expect(documentService.setVersionApproval(t.ownerCtx, v1, { state: "DRAFT" })).rejects.toMatchObject({ fieldErrors: { state: ["validation.invalidTransition"] } });
    await documentService.uploadVersion(t.ownerCtx, doc.id, {}, textFile("rams.pdf", "%PDF v2"));
    await expect(documentService.setVersionApproval(t.ownerCtx, v1, { state: "REJECTED" })).rejects.toMatchObject({ fieldErrors: { _form: ["validation.versionNotCurrent"] } });
    expect((await auditFor(t.companyId, v1)).map((e) => e.action)).toEqual([
      "document_version.create",
      "document_version.approval_update",
      "document_version.approval_update",
    ]);
  });

  it("supervisors can submit but not approve", async () => {
    const t = await createTenant("Sub");
    const p = await projectService.create(t.ownerCtx, { code: "P", name: "P" });
    const sup = await createMember(t, "SUPERVISOR", [{ projectId: p.id }]);
    const doc = await documentService.create(sup, { title: "Daily plan", projectId: p.id }, textFile("plan.txt"));
    await documentService.setVersionApproval(sup, doc.currentVersion.id, { state: "PENDING_APPROVAL" });
    await expect(documentService.setVersionApproval(sup, doc.currentVersion.id, { state: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses unsafe file types and empty files", async () => {
    const t = await createTenant("Files");
    await expect(documentService.create(t.ownerCtx, { title: "x" }, textFile("x.html", "<script>"))).rejects.toMatchObject({ fieldErrors: { file: ["validation.fileType"] } });
    await expect(documentService.create(t.ownerCtx, { title: "x" }, textFile("x.txt", ""))).rejects.toMatchObject({ fieldErrors: { file: ["validation.fileEmpty"] } });
  });

  it("external members never see company-level documents; see assigned project documents read-only", async () => {
    const t = await createTenant("Ext");
    const p = await projectService.create(t.ownerCtx, { code: "P", name: "P" });
    const other = await projectService.create(t.ownerCtx, { code: "O", name: "O" });
    const internal = await documentService.create(t.ownerCtx, { title: "Company contract" }, textFile("c.pdf"));
    const projectDoc = await documentService.create(t.ownerCtx, { title: "Project drawing", projectId: p.id }, textFile("d.pdf"));
    const otherDoc = await documentService.create(t.ownerCtx, { title: "Other project", projectId: other.id }, textFile("o.pdf"));
    const client = await createMember(t, "CLIENT", [{ projectId: p.id }]);
    expect((await documentService.list(client)).map((d) => d.id)).toEqual([projectDoc.id]);
    await expect(documentService.get(client, internal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentService.get(client, otherDoc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentService.downloadVersion(client, internal.currentVersion.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentService.uploadVersion(client, projectDoc.id, {}, textFile("x.pdf"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(documentService.create(client, { title: "x" }, textFile("x.pdf"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("links documents to entities of the same company", async () => {
    const t = await createTenant("Links");
    const emp = await employeeService.create(t.ownerCtx, { employeeNumber: "1", firstName: "A", lastName: "B" });
    const doc = await documentService.create(t.ownerCtx, { title: "Certificate", category: "CERTIFICATE" }, textFile("c.pdf"));
    const link = await documentService.addLink(t.ownerCtx, doc.id, { entityType: "EMPLOYEE", entityId: emp.id });
    expect((await documentService.listLinkedTo(t.ownerCtx, { entityType: "EMPLOYEE", entityId: emp.id })).map((d) => d.id)).toEqual([doc.id]);
    await documentService.removeLink(t.ownerCtx, link.id);
    expect(await documentService.listLinkedTo(t.ownerCtx, { entityType: "EMPLOYEE", entityId: emp.id })).toEqual([]);
    await expect(documentService.addLink(t.ownerCtx, doc.id, { entityType: "EQUIPMENT", entityId: emp.id })).rejects.toBeInstanceOf(ValidationError);
  });
});
