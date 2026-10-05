import { utcToZoned, zonedToUtc } from "@/platform/i18n/time";

/**
 * Logistics rules (pure, unit tested): 30-minute delivery slots (owner
 * decision), request and delivery workflows, booking conflict detection.
 * See docs/adr/0014 and 0015.
 */

export const SLOT_MINUTES = 30;

export interface Slot {
  start: Date;
  end: Date;
  minute: number;
}

/** The gate's 30-minute slots on a local date. */
export function gateSlots(dateIso: string, opensMinute: number, closesMinute: number): Slot[] {
  const out: Slot[] = [];
  for (let m = opensMinute; m + SLOT_MINUTES <= closesMinute; m += SLOT_MINUTES) {
    out.push({ start: zonedToUtc(dateIso, m), end: zonedToUtc(dateIso, m + SLOT_MINUTES), minute: m });
  }
  return out;
}

/** Validates a delivery slot request against the gate's opening hours. */
export function deliveryWindow(dateIso: string, startMinute: number, slots: number, gate: { opensMinute: number; closesMinute: number }) {
  if (startMinute % SLOT_MINUTES !== 0) return { ok: false as const, error: "validation.slotAlignment" };
  const endMinute = startMinute + slots * SLOT_MINUTES;
  if (startMinute < gate.opensMinute || endMinute > gate.closesMinute) return { ok: false as const, error: "validation.gateClosed" };
  return { ok: true as const, start: zonedToUtc(dateIso, startMinute), end: zonedToUtc(dateIso, endMinute) };
}

// ── logistics requests ───────────────────────────────────────────────
export type RequestStatus = "DRAFT" | "REQUESTED" | "REVIEW" | "APPROVED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED";
export type RequestActor = "requester" | "approver" | "operator";

/** Allowed request transitions and who may make them (decision 1: Logistics Coordinator and Site Manager approve). */
export const REQUEST_TRANSITIONS: Record<RequestStatus, Partial<Record<RequestStatus, RequestActor[]>>> = {
  DRAFT: { REQUESTED: ["requester"], CANCELLED: ["requester", "approver"] },
  REQUESTED: { REVIEW: ["approver"], APPROVED: ["approver"], DRAFT: ["approver"], CANCELLED: ["requester", "approver"] },
  REVIEW: { APPROVED: ["approver"], DRAFT: ["approver"], CANCELLED: ["requester", "approver"] },
  APPROVED: { SCHEDULED: ["approver", "operator"], CANCELLED: ["approver"] },
  SCHEDULED: { IN_PROGRESS: ["approver", "operator"], CANCELLED: ["approver"] },
  IN_PROGRESS: { COMPLETE: ["approver", "operator"], CANCELLED: ["approver"] },
  COMPLETE: {},
  CANCELLED: {},
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus, actors: RequestActor[]): boolean {
  const allowed = REQUEST_TRANSITIONS[from][to];
  return !!allowed && allowed.some((a) => actors.includes(a));
}

// ── deliveries ───────────────────────────────────────────────────────
export const DELIVERY_FLOW = ["PLANNED", "CONFIRMED", "ARRIVED_GATE", "CHECKED_IN", "UNLOADING", "STORED", "MOVED_TO_WORKFACE", "INSTALLED"] as const;
export type DeliveryStatus = (typeof DELIVERY_FLOW)[number] | "CANCELLED";

/** Statuses at which the material is on site (clears the activity's material constraint). */
export const MATERIAL_ON_SITE: readonly DeliveryStatus[] = ["STORED", "MOVED_TO_WORKFACE", "INSTALLED"];

export function nextDeliveryStatuses(status: DeliveryStatus): DeliveryStatus[] {
  if (status === "CANCELLED" || status === "INSTALLED") return [];
  const i = DELIVERY_FLOW.indexOf(status);
  const next: DeliveryStatus[] = [...DELIVERY_FLOW.slice(i + 1)];
  if (i < 2) next.push("CANCELLED");
  return next;
}

export function canAdvanceDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return nextDeliveryStatuses(from).includes(to);
}

// ── booking conflicts ────────────────────────────────────────────────
export type ConflictCode = "OVERLAP" | "RESOURCE_INACTIVE" | "INSPECTION_DUE" | "TRADE_MISMATCH" | "TYPE_MISMATCH";

export interface Conflict {
  code: ConflictCode;
  from?: Date;
  to?: Date;
}

export interface ConflictInput {
  period: { startsAt: Date; endsAt: Date };
  /** Other active (REQUESTED/APPROVED) bookings of the same resource. */
  others: { id: string; startsAt: Date; endsAt: Date }[];
  resource:
    | { kind: "EMPLOYEE"; active: boolean; trade: string | null }
    | { kind: "EQUIPMENT"; active: boolean; equipmentTypeId: string; nextInspectionDate: Date | null };
  requirement?: { kind: "TRADE"; trade: string } | { kind: "EQUIPMENT_TYPE"; equipmentTypeId: string } | null;
}

/** Conflicts are reported for a person to decide; they are never resolved automatically. */
export function detectConflicts(i: ConflictInput): Conflict[] {
  const out: Conflict[] = [];
  for (const o of i.others) {
    if (o.startsAt < i.period.endsAt && i.period.startsAt < o.endsAt) out.push({ code: "OVERLAP", from: o.startsAt > i.period.startsAt ? o.startsAt : i.period.startsAt, to: o.endsAt < i.period.endsAt ? o.endsAt : i.period.endsAt });
  }
  if (!i.resource.active) out.push({ code: "RESOURCE_INACTIVE" });
  if (i.resource.kind === "EQUIPMENT" && i.resource.nextInspectionDate) {
    // Inspection overdue or due before the booking ends.
    const inspection = utcToZoned(i.resource.nextInspectionDate, "UTC").date;
    const lastDay = utcToZoned(new Date(i.period.endsAt.getTime() - 1)).date;
    if (inspection <= lastDay) out.push({ code: "INSPECTION_DUE", from: i.resource.nextInspectionDate });
  }
  if (i.requirement?.kind === "TRADE" && i.resource.kind === "EMPLOYEE" && (i.resource.trade ?? "").toLowerCase() !== i.requirement.trade.toLowerCase()) out.push({ code: "TRADE_MISMATCH" });
  if (i.requirement?.kind === "EQUIPMENT_TYPE" && (i.resource.kind !== "EQUIPMENT" || i.resource.equipmentTypeId !== i.requirement.equipmentTypeId)) out.push({ code: "TYPE_MISMATCH" });
  if (i.requirement?.kind === "TRADE" && i.resource.kind === "EQUIPMENT") out.push({ code: "TYPE_MISMATCH" });
  return out;
}
