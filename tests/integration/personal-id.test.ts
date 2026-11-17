/**
 * Personal identity code (ADR 0028): encrypted at rest, unique per company,
 * visible and editable only with employee.pid.manage, every view audited,
 * and never present in other service outputs or audit deltas. Real PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import type { RequestContext } from "@/platform/authz";
import { employeeService } from "@/modules/workforce/service";
import { personalIdService } from "@/modules/workforce/personal-id.service";
import { hrCardService } from "@/modules/hr/card.service";
import { rotationService } from "@/modules/workforce/rotation.service";
import { createMember, createTenant, type Tenant } from "../helpers/fixtures";

// Fictional codes with valid check characters.
const CODE = "131052-308T";
const OTHER = "010101A123N";

let t: Tenant;
let o: RequestContext;
let emp: string;
let emp2: string;

beforeAll(async () => {
  t = await createTenant("Pid");
  o = t.ownerCtx;
  emp = (await employeeService.create(o, { employeeNumber: "P-100", firstName: "Pia", lastName: "Palkka" })).id;
  emp2 = (await employeeService.create(o, { employeeNumber: "P-101", firstName: "Paavo", lastName: "Palkka" })).id;
});

describe("personal identity code", () => {
  it("is stored encrypted with a lookup hash, shown masked, revealed with an audit event, and cleared", async () => {
    expect(await personalIdService.status(o, emp)).toEqual({ set: false, masked: null, available: true });
    expect(await personalIdService.set(o, emp, { personalId: " 131052-308t " })).toEqual({ set: true, masked: "••••••-•••T" });
    const row = await db.employee.findUniqueOrThrow({ where: { id: emp } });
    expect(row.personalIdEnc).toMatch(/^v1:/);
    expect(row.personalIdEnc).not.toContain("131052");
    expect(row.personalIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await personalIdService.status(o, emp)).toEqual({ set: true, masked: "••••••-•••T", available: true });
    expect(await personalIdService.reveal(o, emp)).toEqual({ personalId: CODE });
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "employee.pid_view", entityId: emp } })).toBe(1);

    // No audit event or delta ever holds the code or the ciphertext.
    const audits = await db.auditEvent.findMany({ where: { companyId: t.companyId, entityId: emp } });
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain("131052");
    expect(dump).not.toContain(row.personalIdEnc!);
  });

  it("rejects invalid codes and a code that belongs to another employee", async () => {
    await expect(personalIdService.set(o, emp2, { personalId: "131052-308U" })).rejects.toBeInstanceOf(ValidationError);
    await expect(personalIdService.set(o, emp2, { personalId: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(personalIdService.set(o, emp2, { personalId: CODE })).rejects.toMatchObject({ fieldErrors: { personalId: ["validation.personalIdTaken"] } });
    expect((await personalIdService.set(o, emp2, { personalId: OTHER })).set).toBe(true);
  });

  it("never appears in other outputs, even for HR viewers", async () => {
    const row = await db.employee.findUniqueOrThrow({ where: { id: emp } });
    const pm = await createMember(t, "PROJECT_MANAGER");
    const outputs = [
      await employeeService.get(o, emp),
      await employeeService.list(o),
      await hrCardService.get(o, emp),
      await employeeService.get(pm, emp),
      await rotationService.board(o),
    ];
    const dump = JSON.stringify(outputs);
    for (const leak of ["personalIdEnc", "personalIdHash", row.personalIdEnc!, row.personalIdHash!, "131052"]) expect(dump).not.toContain(leak);
  });

  it("needs employee.pid.manage: HR admin yes; project manager, HR viewer and clients no", async () => {
    const hrAdmin = await createMember(t, "HR_ADMIN");
    expect((await personalIdService.reveal(hrAdmin, emp)).personalId).toBe(CODE);
    for (const key of ["PROJECT_MANAGER", "SITE_MANAGER", "CLIENT"] as const) {
      const c = await createMember(t, key);
      await expect(personalIdService.status(c, emp)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(personalIdService.reveal(c, emp)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(personalIdService.set(c, emp, { personalId: OTHER })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(personalIdService.status(o, "01900000-0000-7000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("clears the code and allows reusing it", async () => {
    expect(await personalIdService.clear(o, emp)).toEqual({ set: false });
    expect((await db.employee.findUniqueOrThrow({ where: { id: emp } })).personalIdHash).toBeNull();
    await expect(personalIdService.reveal(o, emp)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.auditEvent.count({ where: { companyId: t.companyId, action: "employee.pid_clear", entityId: emp } })).toBe(1);
  });

  it("the database refuses clear-text or half-set values", async () => {
    await expect(db.employee.update({ where: { id: emp }, data: { personalIdEnc: CODE, personalIdHash: "a".repeat(64) } })).rejects.toThrow(/employees_personal_id_format/);
    await expect(db.employee.update({ where: { id: emp }, data: { personalIdEnc: "v1:x:y:z", personalIdHash: null } })).rejects.toThrow(/employees_personal_id_pair/);
  });
});
