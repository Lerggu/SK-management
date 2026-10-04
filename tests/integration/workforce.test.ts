import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { MASK } from "@/platform/audit";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import { employeeService } from "@/modules/workforce/service";
import { auditFor, createMember, createTenant } from "../helpers/fixtures";

const base = { employeeNumber: "E-1", firstName: "Antti", lastName: "Esimerkki", email: "antti@example.test", phone: "+358 40 1" };

describe("workforce", () => {
  it("employee CRUD with audit; contact data masked in the audit trail", async () => {
    const t = await createTenant("Emp");
    const e = await employeeService.create(t.ownerCtx, base);
    await employeeService.update(t.ownerCtx, e.id, { ...base, phone: "+358 40 2", trade: "Electrician" });
    await employeeService.archive(t.ownerCtx, e.id);
    const events = await auditFor(t.companyId, e.id);
    expect(events.map((x) => x.action)).toEqual(["employee.create", "employee.update", "employee.archive"]);
    expect(events[0].after).toMatchObject({ email: MASK, phone: MASK, firstName: "Antti" });
    expect(events[1].before).toEqual({ phone: MASK, trade: null });
    expect(events[1].after).toEqual({ phone: MASK, trade: "Electrician" });
    expect((await employeeService.list(t.ownerCtx)).length).toBe(0);
    expect((await employeeService.list(t.ownerCtx, { includeArchived: true })).length).toBe(1);
  });

  it("rates: separate permission, auto-closing of the previous period, overlap rejection", async () => {
    const t = await createTenant("Rates");
    const e = await employeeService.create(t.ownerCtx, base);
    await employeeService.addRate(t.ownerCtx, e.id, { rateType: "COST", amount: "40,00", validFrom: "2026-01-01" });
    await employeeService.addRate(t.ownerCtx, e.id, { rateType: "COST", amount: "42.50", validFrom: "2026-07-01" });
    const rates = await employeeService.listRates(t.ownerCtx, e.id);
    const old = rates.find((r) => r.amount.toString() === "40")!;
    expect(old.validTo?.toISOString().slice(0, 10)).toBe("2026-06-30");
    await expect(employeeService.addRate(t.ownerCtx, e.id, { rateType: "COST", amount: "1", validFrom: "2026-03-01" })).rejects.toMatchObject({
      fieldErrors: { validFrom: ["validation.rateOverlap"] },
    });

    const audit = await db.auditEvent.findMany({ where: { companyId: t.companyId, entityType: "employee_rate" } });
    expect(audit.map((a) => a.action).sort()).toEqual(["employee_rate.close", "employee_rate.create", "employee_rate.create"]);
    expect(audit.find((a) => a.action === "employee_rate.create")!.after).toMatchObject({ amount: MASK, currency: "EUR" });
  });

  it("output mapper strips rates without employee.rates.view", async () => {
    const t = await createTenant("Strip");
    const e = await employeeService.create(t.ownerCtx, base);
    await employeeService.addRate(t.ownerCtx, e.id, { rateType: "BILLING", amount: "70", validFrom: "2026-01-01" });
    const withRates = await employeeService.get(t.ownerCtx, e.id);
    expect(withRates).toHaveProperty("rates");
    const sup = await createMember(t, "SUPERVISOR");
    const stripped = await employeeService.get(sup, e.id);
    expect(stripped).not.toHaveProperty("rates");
    expect(stripped).not.toHaveProperty("currentRates");
    expect(JSON.stringify(await employeeService.list(sup))).not.toContain("70");
    await expect(employeeService.listRates(sup, e.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates employee input", async () => {
    const t = await createTenant("EVal");
    await expect(employeeService.create(t.ownerCtx, { ...base, email: "not-an-email" })).rejects.toMatchObject({ fieldErrors: { email: ["validation.email"] } });
    await employeeService.create(t.ownerCtx, base);
    await expect(employeeService.create(t.ownerCtx, base)).rejects.toMatchObject({ field: "employeeNumber" });
    await expect(employeeService.create(t.ownerCtx, { ...base, employeeNumber: "E-2", userId: "0190a000-0000-7000-8000-000000000000" })).rejects.toBeInstanceOf(ValidationError);
  });
});
