import { describe, expect, it } from "vitest";
import { MAX_CANDIDATES_PER_NEED, pseudonymiseStaffing, resolvePicks, ruleBasedAnswer, staffingResultSchema, type StaffingNeedInput } from "./ai";

const role = (id: string, kind: "PERSON" | "EQUIPMENT" = "PERSON", quantity = 2) => ({ id, label: `Rooli ${id.toUpperCase()}`, kind, quantity, minLevel: null, trade: null });
const cand = (value: string, label: string, blocking = false, detail: string | null = "Asentaja") => ({ value, label, detail, issues: blocking ? (["QUALIFICATION_MISSING"] as const).slice() : [], blocking });
const task = { serviceType: "LIFT", taskType: "Nosto", start: new Date("2027-01-11T06:00:00Z"), end: new Date("2027-01-11T10:30:00Z"), weightKg: 3000 };

const needs: StaffingNeedInput[] = [
  { role: role("r1"), requires: { card: "Kortti", competence: null, equipmentType: null }, missing: 2, candidates: [cand("EMPLOYEE:a", "Aalto Anna"), cand("EMPLOYEE:b", "Berg Bo", true), cand("EMPLOYEE:c", "Car Cid")] },
  { role: role("r2", "PERSON", 1), requires: { card: null, competence: null, equipmentType: null }, missing: 1, candidates: [cand("EMPLOYEE:a", "Aalto Anna"), cand("EMPLOYEE:d", "Dee Dan")] },
  { role: role("r3", "EQUIPMENT", 1), requires: { card: null, competence: null, equipmentType: "Nosturi" }, missing: 0, candidates: [cand("EQUIPMENT:q", "N1 Nosturi", false, null)] },
];

describe("pseudonymiseStaffing", () => {
  const p = pseudonymiseStaffing(task, needs);

  it("never includes names, ids or blocked candidates; reuses one reference per resource", () => {
    const json = JSON.stringify(p.payload);
    for (const leak of ["Aalto", "Berg", "Car", "Dee", "EMPLOYEE:", "N1 Nosturi", "\"r1\""]) expect(json).not.toContain(leak);
    expect(p.payload.needs.map((n) => n.need)).toEqual(["N1", "N2"]); // filled needs are left out
    expect(p.payload.needs[0].candidates.map((c) => c.candidate)).toEqual(["C1", "C2"]);
    expect(p.payload.needs[1].candidates.map((c) => c.candidate)).toEqual(["C1", "C3"]);
    expect(p.candidates.get("C1")).toEqual({ resource: "EMPLOYEE:a", label: "Aalto Anna" });
    expect(p.payload.task.durationHours).toBe(4.5);
  });

  it("offers at most the configured number of candidates per need", () => {
    const many = Array.from({ length: 30 }, (_, i) => cand(`EMPLOYEE:${i}`, `P${i}`));
    const q = pseudonymiseStaffing(task, [{ ...needs[0], candidates: many }]);
    expect(q.payload.needs[0].candidates).toHaveLength(MAX_CANDIDATES_PER_NEED);
  });

  it("resolves only offered, unique picks within the open quantity", () => {
    const { picks, rejected } = resolvePicks(p, [
      { need: "N1", candidate: "C1", reason: "best" },
      { need: "N2", candidate: "C1", reason: "same person twice" },
      { need: "N2", candidate: "C3", reason: "ok" },
      { need: "N1", candidate: "C3", reason: "not offered for N1" },
      { need: "N1", candidate: "C2", reason: "ok" },
      { need: "N1", candidate: "C9", reason: "unknown" },
    ]);
    expect(picks.map((x) => [x.roleId, x.resource])).toEqual([
      ["r1", "EMPLOYEE:a"],
      ["r2", "EMPLOYEE:d"],
      ["r1", "EMPLOYEE:c"],
    ]);
    expect(rejected).toBe(3);
  });

  it("the rule-based answer is valid and resolves completely", () => {
    const answer = staffingResultSchema.parse(ruleBasedAnswer(p.payload));
    const { picks, rejected } = resolvePicks(p, answer.picks);
    expect(rejected).toBe(0);
    expect(picks).toHaveLength(3);
  });

  it("rejects malformed model output", () => {
    expect(staffingResultSchema.safeParse({ summary: "", picks: [] }).success).toBe(false);
    expect(staffingResultSchema.safeParse({ summary: "x", picks: [{ need: "N1" }] }).success).toBe(false);
  });
});
