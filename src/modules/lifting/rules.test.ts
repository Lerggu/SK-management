import { describe, expect, it } from "vitest";
import { canMoveMaterial, canPull, hasBlocking, inspectionDue, liftPlanChecks, usedPct, utilizationPct, type LiftCheckInput } from "./rules";

const base: LiftCheckInput = {
  liftDate: "2026-10-12",
  loadDescription: "Precast beam",
  loadWeightKg: 4000,
  riggingWeightKg: 200,
  radiusM: 18,
  craneCapacityKg: 6000,
  riskDocumentId: "doc",
  crane: { label: "NK-01", status: "AVAILABLE", nextInspectionDate: "2027-01-01", archived: false },
  accessories: [{ code: "SL-1", wllKg: 2500, count: 2, status: "ACTIVE", archived: false, nextInspectionDate: "2026-12-01" }],
};
const codes = (v: LiftCheckInput) => liftPlanChecks(v).map((i) => i.code);

describe("liftPlanChecks", () => {
  it("passes a complete plan within capacity", () => {
    expect(liftPlanChecks(base)).toEqual([]);
  });

  it("reports every missing field as blocking", () => {
    const issues = liftPlanChecks({ ...base, loadDescription: null, loadWeightKg: null, crane: null, radiusM: null, craneCapacityKg: null });
    expect(issues.filter((i) => i.code === "INCOMPLETE").map((i) => i.subject)).toEqual(["loadDescription", "loadWeightKg", "crane", "radiusM", "craneCapacityKg"]);
    expect(hasBlocking(issues)).toBe(true);
  });

  it("blocks above crane capacity and warns at 90 % or more", () => {
    expect(codes({ ...base, loadWeightKg: 5900 })).toContain("CAPACITY_EXCEEDED");
    expect(codes({ ...base, loadWeightKg: 5200, accessories: [] })).toEqual(["HIGH_UTILIZATION"]);
    expect(utilizationPct({ loadWeightKg: 5200, riggingWeightKg: 200, craneCapacityKg: 6000 })).toBe(90);
    expect(hasBlocking(liftPlanChecks({ ...base, loadWeightKg: 5200, accessories: [] }))).toBe(false);
  });

  it("blocks overloaded, overdue and inactive accessories", () => {
    const acc = (o: Partial<LiftCheckInput["accessories"][number]>) => ({ ...base, accessories: [{ ...base.accessories[0], ...o }] });
    expect(codes(acc({ wllKg: 2000 }))).toEqual(["ACCESSORY_WLL_EXCEEDED"]);
    expect(codes(acc({ nextInspectionDate: "2026-10-12" }))).toEqual(["ACCESSORY_INSPECTION_DUE"]);
    expect(codes(acc({ nextInspectionDate: null }))).toEqual(["ACCESSORY_INSPECTION_DUE"]);
    expect(codes(acc({ status: "INACTIVE" }))).toEqual(["ACCESSORY_INACTIVE"]);
  });

  it("blocks an unavailable crane or one whose inspection is due", () => {
    expect(codes({ ...base, crane: { ...base.crane!, status: "MAINTENANCE" } })).toEqual(["CRANE_UNAVAILABLE"]);
    expect(codes({ ...base, crane: { ...base.crane!, nextInspectionDate: "2026-10-01" } })).toEqual(["CRANE_INSPECTION_DUE"]);
  });

  it("warns when the risk assessment is missing", () => {
    const issues = liftPlanChecks({ ...base, riskDocumentId: null });
    expect(issues).toEqual([{ code: "RISK_ASSESSMENT_MISSING", severity: "warn" }]);
  });

  it("treats a missing inspection date as due", () => {
    expect(inspectionDue(null, "2026-10-12")).toBe(true);
    expect(inspectionDue("2026-10-13", "2026-10-12")).toBe(false);
  });
});

describe("material flow and cable pulls", () => {
  it("allows delivery → storage → workface → installed only forward (plus back to storage)", () => {
    expect(canMoveMaterial("RECEIVED", "STORED")).toBe(true);
    expect(canMoveMaterial("AT_WORKFACE", "INSTALLED")).toBe(true);
    expect(canMoveMaterial("AT_WORKFACE", "STORED")).toBe(true);
    expect(canMoveMaterial("STORED", "INSTALLED")).toBe(false);
    expect(canMoveMaterial("INSTALLED", "STORED")).toBe(false);
  });

  it("never pulls more than the remaining length", () => {
    expect(canPull(120.5, 120.5)).toBe(true);
    expect(canPull(120.5, 120.6)).toBe(false);
    expect(canPull(100, 0)).toBe(false);
    expect(canPull(0.3, 0.1 + 0.2)).toBe(true);
    expect(usedPct(500, 125)).toBe(75);
  });
});
