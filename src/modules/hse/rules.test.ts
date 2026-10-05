import { describe, expect, it } from "vitest";
import { ACTION_FLOW, INCIDENT_FLOW, OBSERVATION_FLOW, PERMIT_FLOW, hseMetrics, inspectionIndex, isLostTimeInjury, isOverdue, ltif, reportRate, requiresInvestigation, riskLevel, riskScore } from "./rules";

describe("HSE formulas", () => {
  it("LTIF = LTI × 1 000 000 / hours", () => {
    expect(ltif(1, 50_000)).toBe(20);
    expect(ltif(2, 123_456)).toBe(16.2);
    expect(ltif(0, 10_000)).toBe(0);
    expect(ltif(1, 0)).toBeNull();
  });

  it("report rate = reports × 1 000 / hours", () => {
    expect(reportRate(12, 4000)).toBe(3);
    expect(reportRate(1, 3)).toBe(333.33);
    expect(reportRate(5, 0)).toBeNull();
  });

  it("MVR index = 100 × correct / total", () => {
    expect(inspectionIndex(92, 8)).toBe(92);
    expect(inspectionIndex(2, 1)).toBe(66.7);
    expect(inspectionIndex(0, 0)).toBeNull();
    expect(inspectionIndex(-1, 3)).toBeNull();
  });

  it("risk score and level", () => {
    expect(riskScore(1, 1)).toBe(1);
    expect(riskScore(5, 5)).toBe(25);
    expect(riskLevel(4)).toBe("LOW");
    expect(riskLevel(9)).toBe("MEDIUM");
    expect(riskLevel(16)).toBe("HIGH");
    expect(riskLevel(20)).toBe("CRITICAL");
    expect(() => riskScore(0, 3)).toThrow(RangeError);
    expect(() => riskScore(2.5, 3)).toThrow(RangeError);
  });

  it("lost-time injuries and investigation duty", () => {
    expect(isLostTimeInjury({ type: "INJURY", severity: "LOST_TIME" })).toBe(true);
    expect(isLostTimeInjury({ type: "INJURY", severity: "SERIOUS" })).toBe(true);
    expect(isLostTimeInjury({ type: "INJURY", severity: "MEDICAL_TREATMENT" })).toBe(false);
    expect(isLostTimeInjury({ type: "PROPERTY_DAMAGE", severity: "SERIOUS" })).toBe(false);
    expect(requiresInvestigation("SERIOUS")).toBe(true);
    expect(requiresInvestigation("FIRST_AID")).toBe(false);
  });

  it("overdue actions", () => {
    expect(isOverdue({ status: "OPEN", dueDate: "2026-10-01" }, "2026-10-05")).toBe(true);
    expect(isOverdue({ status: "OPEN", dueDate: "2026-10-05" }, "2026-10-05")).toBe(false);
    expect(isOverdue({ status: "DONE", dueDate: "2026-10-01" }, "2026-10-05")).toBe(false);
    expect(isOverdue({ status: "OPEN", dueDate: null }, "2026-10-05")).toBe(false);
  });
});

describe("HSE state machines", () => {
  it("closed and final states have no exits", () => {
    expect(OBSERVATION_FLOW.CLOSED).toEqual([]);
    expect(INCIDENT_FLOW.CLOSED).toEqual([]);
    expect(ACTION_FLOW.VERIFIED).toEqual([]);
    expect(PERMIT_FLOW.REJECTED).toEqual([]);
    expect(PERMIT_FLOW.CLOSED).toEqual([]);
  });
  it("incidents cannot skip triage", () => {
    expect(INCIDENT_FLOW.REPORTED).toEqual(["TRIAGED"]);
    expect(INCIDENT_FLOW.TRIAGED).toContain("INVESTIGATING");
  });
});

describe("hseMetrics", () => {
  it("aggregates key figures", () => {
    const m = hseMetrics({
      hours: 40_000,
      observations: [{ kind: "SAFETY_OBSERVATION" }, { kind: "SAFETY_OBSERVATION" }, { kind: "NEAR_MISS" }],
      incidents: [
        { type: "INJURY", severity: "LOST_TIME", status: "INVESTIGATING" },
        { type: "INJURY", severity: "FIRST_AID", status: "CLOSED" },
        { type: "PROPERTY_DAMAGE", severity: "SERIOUS", status: "CLOSED" },
      ],
      actions: [
        { status: "OPEN", dueDate: "2026-09-30" },
        { status: "DONE", dueDate: "2026-09-30" },
        { status: "VERIFIED", dueDate: null },
      ],
      toolboxTalks: [{ attendeeCount: 12 }, { attendeeCount: 8 }],
      inspections: [
        { kind: "MVR", inspectedOn: "2026-09-21", correctCount: 90, incorrectCount: 10 },
        { kind: "MVR", inspectedOn: "2026-09-28", correctCount: 95, incorrectCount: 5 },
        { kind: "GENERAL", inspectedOn: "2026-10-01", correctCount: 1, incorrectCount: 1 },
      ],
      today: "2026-10-05",
    });
    expect(m).toMatchObject({
      safetyObservations: 2,
      nearMisses: 1,
      incidents: 3,
      openIncidents: 1,
      lostTimeInjuries: 1,
      ltif: 25,
      reportRate: 0.08,
      openActions: 2,
      overdueActions: 1,
      toolboxTalks: 2,
      toolboxAttendees: 20,
      latestInspectionIndex: 95,
    });
    expect(m.incidentsBySeverity).toEqual({ FIRST_AID: 1, MEDICAL_TREATMENT: 0, LOST_TIME: 1, SERIOUS: 1 });
    expect(m.inspectionTrend.map((t) => t.index)).toEqual([90, 95]);
  });

  it("no hours → no rates", () => {
    const m = hseMetrics({ hours: 0, observations: [], incidents: [], actions: [], toolboxTalks: [], inspections: [], today: "2026-10-05" });
    expect(m.ltif).toBeNull();
    expect(m.reportRate).toBeNull();
    expect(m.latestInspectionIndex).toBeNull();
  });
});
