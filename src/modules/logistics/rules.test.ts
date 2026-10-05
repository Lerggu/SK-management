import { describe, expect, it } from "vitest";
import { canAdvanceDelivery, canTransitionRequest, deliveryWindow, detectConflicts, gateSlots, nextDeliveryStatuses } from "./rules";

const d = (s: string) => new Date(s);

describe("delivery slots", () => {
  it("splits gate opening hours into 30-minute slots in Helsinki time", () => {
    const slots = gateSlots("2026-10-05", 6 * 60, 8 * 60);
    expect(slots).toHaveLength(4);
    expect(slots[0].start.toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(slots[3].end.toISOString()).toBe("2026-10-05T05:00:00.000Z");
  });

  it("validates alignment and opening hours", () => {
    const gate = { opensMinute: 360, closesMinute: 1080 };
    expect(deliveryWindow("2026-10-05", 375, 1, gate)).toEqual({ ok: false, error: "validation.slotAlignment" });
    expect(deliveryWindow("2026-10-05", 1050, 2, gate)).toEqual({ ok: false, error: "validation.gateClosed" });
    const ok = deliveryWindow("2026-10-05", 420, 3, gate);
    expect(ok.ok && [ok.start.toISOString(), ok.end.toISOString()]).toEqual(["2026-10-05T04:00:00.000Z", "2026-10-05T05:30:00.000Z"]);
  });
});

describe("workflows", () => {
  it("requests: requester submits, approver (Logistics Coordinator or Site Manager) approves", () => {
    expect(canTransitionRequest("DRAFT", "REQUESTED", ["requester"])).toBe(true);
    expect(canTransitionRequest("REQUESTED", "APPROVED", ["requester"])).toBe(false);
    expect(canTransitionRequest("REQUESTED", "APPROVED", ["approver"])).toBe(true);
    expect(canTransitionRequest("APPROVED", "SCHEDULED", ["operator"])).toBe(true);
    expect(canTransitionRequest("COMPLETE", "CANCELLED", ["approver"])).toBe(false);
    expect(canTransitionRequest("APPROVED", "REQUESTED", ["approver"])).toBe(false);
  });

  it("deliveries move forward only; cancellation only before arrival", () => {
    expect(nextDeliveryStatuses("PLANNED")).toContain("CANCELLED");
    expect(nextDeliveryStatuses("ARRIVED_GATE")).not.toContain("CANCELLED");
    expect(canAdvanceDelivery("CHECKED_IN", "UNLOADING")).toBe(true);
    expect(canAdvanceDelivery("STORED", "UNLOADING")).toBe(false);
    expect(nextDeliveryStatuses("INSTALLED")).toEqual([]);
  });
});

describe("booking conflicts", () => {
  const period = { startsAt: d("2026-10-06T04:00:00Z"), endsAt: d("2026-10-06T12:30:00Z") };
  const crane = { kind: "EQUIPMENT" as const, active: true, equipmentTypeId: "crane", nextInspectionDate: null };

  it("detects overlapping bookings of the same resource", () => {
    const c = detectConflicts({ period, others: [{ id: "x", startsAt: d("2026-10-06T10:00:00Z"), endsAt: d("2026-10-06T14:00:00Z") }, { id: "y", startsAt: d("2026-10-06T12:30:00Z"), endsAt: d("2026-10-06T13:00:00Z") }], resource: crane });
    expect(c).toEqual([{ code: "OVERLAP", from: d("2026-10-06T10:00:00Z"), to: d("2026-10-06T12:30:00Z") }]);
  });

  it("detects unavailable resources and inspections due", () => {
    expect(detectConflicts({ period, others: [], resource: { ...crane, active: false } }).map((x) => x.code)).toEqual(["RESOURCE_INACTIVE"]);
    expect(detectConflicts({ period, others: [], resource: { ...crane, nextInspectionDate: d("2026-10-06T00:00:00Z") } }).map((x) => x.code)).toEqual(["INSPECTION_DUE"]);
    expect(detectConflicts({ period, others: [], resource: { ...crane, nextInspectionDate: d("2026-10-07T00:00:00Z") } })).toEqual([]);
  });

  it("detects competence and type mismatches against the takt requirement", () => {
    const electrician = { kind: "EMPLOYEE" as const, active: true, trade: "Sähköasentaja" };
    expect(detectConflicts({ period, others: [], resource: electrician, requirement: { kind: "TRADE", trade: "sähköasentaja" } })).toEqual([]);
    expect(detectConflicts({ period, others: [], resource: electrician, requirement: { kind: "TRADE", trade: "Rigger" } }).map((x) => x.code)).toEqual(["TRADE_MISMATCH"]);
    expect(detectConflicts({ period, others: [], resource: crane, requirement: { kind: "EQUIPMENT_TYPE", equipmentTypeId: "forklift" } }).map((x) => x.code)).toEqual(["TYPE_MISMATCH"]);
  });
});
