import { describe, expect, it } from "vitest";
import { applicableRoles, equipmentFit, isBlocking, personFit, rankCandidates, readiness, type RoleLike } from "./rules";

const role = (o: Partial<RoleLike> & { id: string }): RoleLike => ({
  kind: "PERSON",
  label: o.id,
  quantity: 1,
  qualificationTypeId: null,
  areaId: null,
  minLevel: null,
  trade: null,
  equipmentTypeId: null,
  minWeightKg: null,
  maxWeightKg: null,
  ...o,
});

describe("applicableRoles", () => {
  const roles = [role({ id: "always" }), role({ id: "heavy", minWeightKg: 5000 }), role({ id: "light", maxWeightKg: 1000 }), role({ id: "gone", archivedAt: new Date() })];

  it("applies weight ranges to the heaviest load", () => {
    expect(applicableRoles(roles, 8000).roles.map((r) => r.id)).toEqual(["always", "heavy"]);
    expect(applicableRoles(roles, 500).roles.map((r) => r.id)).toEqual(["always", "light"]);
    expect(applicableRoles(roles, 5000).roles.map((r) => r.id)).toEqual(["always", "heavy"]);
  });

  it("flags an unknown weight and skips needs that start from a minimum", () => {
    const r = applicableRoles(roles, null);
    expect(r.weightUnknown).toBe(true);
    expect(r.roles.map((x) => x.id)).toEqual(["always", "light"]);
    expect(applicableRoles([role({ id: "a" })], null).weightUnknown).toBe(false);
  });
});

describe("personFit", () => {
  const facts = { active: true, trade: "Sähköasentaja", validQualificationTypes: new Set(["card"]), levels: new Map<string, number | null>([["lift", 3]]) };

  it("a missing required card blocks; low or missing competence is a warning", () => {
    expect(personFit(role({ id: "r", qualificationTypeId: "card" }), facts)).toEqual([]);
    expect(personFit(role({ id: "r", qualificationTypeId: "other" }), facts)).toEqual(["QUALIFICATION_MISSING"]);
    expect(isBlocking(["QUALIFICATION_MISSING"])).toBe(true);
    expect(personFit(role({ id: "r", areaId: "lift", minLevel: 4 }), facts)).toEqual(["LEVEL_LOW"]);
    expect(personFit(role({ id: "r", areaId: "signal", minLevel: 2 }), facts)).toEqual(["NOT_ASSESSED"]);
    expect(isBlocking(["LEVEL_LOW", "NOT_ASSESSED"])).toBe(false);
  });

  it("matches the trade case-insensitively and flags inactive people", () => {
    expect(personFit(role({ id: "r", trade: "sähköasentaja" }), facts)).toEqual([]);
    expect(personFit(role({ id: "r", trade: "Putkiasentaja" }), facts)).toEqual(["TRADE_MISMATCH"]);
    expect(personFit(role({ id: "r" }), { ...facts, active: false })).toEqual(["INACTIVE"]);
  });
});

describe("equipmentFit", () => {
  const end = new Date("2027-01-10T12:00:00Z");
  it("checks type, availability and inspection", () => {
    const r = role({ id: "crane", kind: "EQUIPMENT", equipmentTypeId: "crane" });
    expect(equipmentFit(r, { equipmentTypeId: "crane", status: "AVAILABLE", nextInspectionDate: new Date("2027-06-01") }, end)).toEqual([]);
    expect(equipmentFit(r, { equipmentTypeId: "lift", status: "AVAILABLE", nextInspectionDate: null }, end)).toEqual(["TYPE_MISMATCH"]);
    expect(equipmentFit(r, { equipmentTypeId: "crane", status: "MAINTENANCE", nextInspectionDate: new Date("2027-01-01") }, end)).toEqual(["OUT_OF_SERVICE", "INSPECTION_DUE"]);
  });
});

describe("rankCandidates", () => {
  it("usable and free first, then warnings, busy, unusable", () => {
    const ranked = rankCandidates([
      { label: "Blocked", issues: ["QUALIFICATION_MISSING" as const] },
      { label: "Busy", issues: ["BUSY" as const] },
      { label: "Warn", issues: ["LEVEL_LOW" as const] },
      { label: "Bea", issues: [] },
      { label: "Aino", issues: [] },
    ]);
    expect(ranked.map((c) => c.label)).toEqual(["Aino", "Bea", "Warn", "Busy", "Blocked"]);
  });
});

describe("readiness", () => {
  it("is ready only when every need is staffed", () => {
    expect(readiness(false, [])).toBe("NO_TYPE");
    expect(readiness(true, [{ quantity: 2, assigned: 1 }])).toBe("MISSING");
    expect(readiness(true, [{ quantity: 2, assigned: 2 }, { quantity: 1, assigned: 1 }])).toBe("READY");
  });
});
