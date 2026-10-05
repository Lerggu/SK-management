/**
 * Pure V5 rules: lift plan checks and material status flow. No I/O.
 *
 * The checks support the person responsible for lifting; they never replace
 * the lift plan's engineering judgement. Blocking issues prevent submitting
 * and approving a plan; warnings are shown and must be read.
 */

export type LiftIssueCode =
  | "INCOMPLETE"
  | "CAPACITY_EXCEEDED"
  | "HIGH_UTILIZATION"
  | "CRANE_UNAVAILABLE"
  | "CRANE_INSPECTION_DUE"
  | "ACCESSORY_INACTIVE"
  | "ACCESSORY_INSPECTION_DUE"
  | "ACCESSORY_WLL_EXCEEDED"
  | "RISK_ASSESSMENT_MISSING";

export interface LiftIssue {
  code: LiftIssueCode;
  severity: "block" | "warn";
  /** Human-readable subject (accessory code, crane asset number, missing field). */
  subject?: string;
  /** Numbers for the message, e.g. utilisation percent. */
  value?: number;
}

export interface LiftCheckInput {
  /** Planned lift date (Europe/Helsinki, YYYY-MM-DD). */
  liftDate: string;
  loadDescription: string | null;
  loadWeightKg: number | null;
  riggingWeightKg: number | null;
  radiusM: number | null;
  craneCapacityKg: number | null;
  riskDocumentId: string | null;
  crane: { label: string; status: string; nextInspectionDate: string | null; archived: boolean } | null;
  accessories: { code: string; wllKg: number; count: number; status: string; archived: boolean; nextInspectionDate: string | null }[];
}

export const HIGH_UTILIZATION_PCT = 90;

/** Total hook load: the load plus rigging (accessories, spreader beams). */
export function totalLoadKg(v: Pick<LiftCheckInput, "loadWeightKg" | "riggingWeightKg">): number {
  return (v.loadWeightKg ?? 0) + (v.riggingWeightKg ?? 0);
}

export function utilizationPct(v: Pick<LiftCheckInput, "loadWeightKg" | "riggingWeightKg" | "craneCapacityKg">): number | null {
  if (!v.craneCapacityKg || !v.loadWeightKg) return null;
  return Math.round((totalLoadKg(v) / v.craneCapacityKg) * 1000) / 10;
}

/** An inspection is due when it is missing or falls on/before the lift date. */
export function inspectionDue(nextInspectionDate: string | null, liftDate: string): boolean {
  return nextInspectionDate === null || nextInspectionDate <= liftDate;
}

export function liftPlanChecks(v: LiftCheckInput): LiftIssue[] {
  const issues: LiftIssue[] = [];
  const missing: [string, unknown][] = [
    ["loadDescription", v.loadDescription],
    ["loadWeightKg", v.loadWeightKg],
    ["crane", v.crane],
    ["radiusM", v.radiusM],
    ["craneCapacityKg", v.craneCapacityKg],
  ];
  for (const [field, value] of missing) if (value === null || value === "") issues.push({ code: "INCOMPLETE", severity: "block", subject: field });

  const pct = utilizationPct(v);
  if (pct !== null) {
    if (pct > 100) issues.push({ code: "CAPACITY_EXCEEDED", severity: "block", value: pct });
    else if (pct >= HIGH_UTILIZATION_PCT) issues.push({ code: "HIGH_UTILIZATION", severity: "warn", value: pct });
  }

  if (v.crane) {
    if (v.crane.archived || !["AVAILABLE", "IN_USE"].includes(v.crane.status)) issues.push({ code: "CRANE_UNAVAILABLE", severity: "block", subject: v.crane.label });
    if (v.crane.nextInspectionDate !== null && v.crane.nextInspectionDate <= v.liftDate) issues.push({ code: "CRANE_INSPECTION_DUE", severity: "block", subject: v.crane.label });
  }

  const load = totalLoadKg(v);
  for (const a of v.accessories) {
    if (a.archived || a.status !== "ACTIVE") issues.push({ code: "ACCESSORY_INACTIVE", severity: "block", subject: a.code });
    if (inspectionDue(a.nextInspectionDate, v.liftDate)) issues.push({ code: "ACCESSORY_INSPECTION_DUE", severity: "block", subject: a.code });
    // Conservative simplification (ADR 0016): the line's combined WLL must
    // carry the whole hook load; angle factors are the planner's job.
    if (v.loadWeightKg !== null && a.wllKg * a.count < load) issues.push({ code: "ACCESSORY_WLL_EXCEEDED", severity: "block", subject: a.code, value: a.wllKg * a.count });
  }

  if (!v.riskDocumentId) issues.push({ code: "RISK_ASSESSMENT_MISSING", severity: "warn" });
  return issues;
}

export const hasBlocking = (issues: LiftIssue[]) => issues.some((i) => i.severity === "block");

// ── material flow ────────────────────────────────────────────────────
export type MaterialStatus = "RECEIVED" | "STORED" | "AT_WORKFACE" | "INSTALLED" | "RETURNED";

/** delivery → storage → workface → installed; a batch may go back to storage or be returned. */
export const MATERIAL_FLOW: Record<MaterialStatus, MaterialStatus[]> = {
  RECEIVED: ["STORED", "AT_WORKFACE", "RETURNED"],
  STORED: ["AT_WORKFACE", "RETURNED"],
  AT_WORKFACE: ["INSTALLED", "STORED", "RETURNED"],
  INSTALLED: [],
  RETURNED: [],
};

export function canMoveMaterial(from: MaterialStatus, to: MaterialStatus): boolean {
  return MATERIAL_FLOW[from].includes(to);
}

// ── cable drums ──────────────────────────────────────────────────────
/** Metres with one decimal, compared in tenths to avoid float drift. */
export function canPull(remainingM: number, lengthM: number): boolean {
  return lengthM > 0 && Math.round(lengthM * 10) <= Math.round(remainingM * 10);
}

export function usedPct(originalM: number, remainingM: number): number {
  if (originalM <= 0) return 0;
  return Math.round(((originalM - remainingM) / originalM) * 100);
}
