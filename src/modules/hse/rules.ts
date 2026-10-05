/**
 * HSE rules and key-figure formulas (Build Master §23, docs/V7_PLAN.md).
 * Pure functions, unit tested in rules.test.ts. The DB triggers of the
 * v7_integrity migration enforce the same state machines.
 */

export const OBSERVATION_KINDS = ["SAFETY_OBSERVATION", "NEAR_MISS"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];
export const HSE_CATEGORIES = ["PPE", "HOUSEKEEPING", "WORK_AT_HEIGHT", "LIFTING", "EXCAVATION", "ELECTRICAL", "TRAFFIC", "MACHINERY", "ENVIRONMENT", "OTHER"] as const;
export const HSE_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const INCIDENT_TYPES = ["INJURY", "PROPERTY_DAMAGE", "ENVIRONMENTAL", "DANGEROUS_OCCURRENCE"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_SEVERITIES = ["FIRST_AID", "MEDICAL_TREATMENT", "LOST_TIME", "SERIOUS"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const PERMIT_TYPES = ["HOT_WORK", "CONFINED_SPACE", "EXCAVATION", "ELECTRICAL", "WORK_AT_HEIGHT", "LIFTING", "OTHER"] as const;
export const INSPECTION_KINDS = ["MVR", "TR", "GENERAL"] as const;

export type ObservationStatus = "OPEN" | "TRIAGED" | "CLOSED";
export type IncidentStatus = "REPORTED" | "TRIAGED" | "INVESTIGATING" | "CLOSED";
export type ActionStatus = "OPEN" | "DONE" | "VERIFIED";
export type PermitStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CLOSED";

export const OBSERVATION_FLOW: Record<ObservationStatus, ObservationStatus[]> = {
  OPEN: ["TRIAGED", "CLOSED"],
  TRIAGED: ["CLOSED"],
  CLOSED: [],
};

export const INCIDENT_FLOW: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: ["TRIAGED"],
  TRIAGED: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["CLOSED"],
  CLOSED: [],
};

export const ACTION_FLOW: Record<ActionStatus, ActionStatus[]> = {
  OPEN: ["DONE"],
  DONE: ["OPEN", "VERIFIED"],
  VERIFIED: [],
};

export const PERMIT_FLOW: Record<PermitStatus, PermitStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED"],
  REJECTED: [],
  CLOSED: [],
};

/** Lost-time and serious incidents must be investigated (hse.investigate) before closing. */
export function requiresInvestigation(severity: IncidentSeverity): boolean {
  return severity === "LOST_TIME" || severity === "SERIOUS";
}

/** Serious and lost-time reports notify hse.serious.notify holders immediately. */
export function requiresImmediateNotification(severity: IncidentSeverity): boolean {
  return requiresInvestigation(severity);
}

/** A lost-time injury (LTI) for LTIF: an injury that led to absence or worse. */
export function isLostTimeInjury(i: { type: IncidentType; severity: IncidentSeverity }): boolean {
  return i.type === "INJURY" && requiresInvestigation(i.severity);
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** LTIF = lost-time injuries × 1 000 000 / hours worked (null without hours). */
export function ltif(lostTimeInjuries: number, hours: number): number | null {
  if (!(hours > 0)) return null;
  return round((lostTimeInjuries * 1_000_000) / hours, 1);
}

/** Proactive reporting rate: (observations + near misses) × 1 000 / hours worked. */
export function reportRate(reports: number, hours: number): number | null {
  if (!(hours > 0)) return null;
  return round((reports * 1000) / hours, 2);
}

/** MVR/TR index = 100 × correct / (correct + incorrect), one decimal. */
export function inspectionIndex(correct: number, incorrect: number): number | null {
  const total = correct + incorrect;
  if (!(total > 0) || correct < 0 || incorrect < 0) return null;
  return round((100 * correct) / total, 1);
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Risk score = likelihood × consequence on 1–5 scales (1–25). */
export function riskScore(likelihood: number, consequence: number): number {
  if (![likelihood, consequence].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) throw new RangeError("likelihood and consequence must be integers 1–5");
  return likelihood * consequence;
}

export function riskLevel(score: number): RiskLevel {
  if (score <= 4) return "LOW";
  if (score <= 9) return "MEDIUM";
  if (score <= 16) return "HIGH";
  return "CRITICAL";
}

/** An action is overdue when still OPEN after its due date (dates as YYYY-MM-DD). */
export function isOverdue(action: { status: ActionStatus; dueDate: string | null }, today: string): boolean {
  return action.status === "OPEN" && action.dueDate !== null && action.dueDate < today;
}

export interface MetricsInput {
  hours: number;
  observations: { kind: ObservationKind }[];
  incidents: { type: IncidentType; severity: IncidentSeverity; status: IncidentStatus }[];
  actions: { status: ActionStatus; dueDate: string | null }[];
  toolboxTalks: { attendeeCount: number }[];
  inspections: { kind: string; inspectedOn: string; correctCount: number; incorrectCount: number }[];
  today: string;
}

/**
 * HSE key figures for a project (owner decision 3). Hours are approved hours
 * of the company's own people; subcontractor hours are not in the system.
 */
export function hseMetrics(m: MetricsInput) {
  const nearMisses = m.observations.filter((o) => o.kind === "NEAR_MISS").length;
  const safetyObservations = m.observations.length - nearMisses;
  const bySeverity = Object.fromEntries(INCIDENT_SEVERITIES.map((s) => [s, m.incidents.filter((i) => i.severity === s).length])) as Record<IncidentSeverity, number>;
  const lti = m.incidents.filter(isLostTimeInjury).length;
  const mvr = m.inspections.filter((i) => i.kind === "MVR" || i.kind === "TR").sort((a, b) => (a.inspectedOn < b.inspectedOn ? 1 : -1));
  const indexes = mvr.map((i) => ({ kind: i.kind, inspectedOn: i.inspectedOn, index: inspectionIndex(i.correctCount, i.incorrectCount) }));
  return {
    hours: round(m.hours, 2),
    safetyObservations,
    nearMisses,
    incidents: m.incidents.length,
    incidentsBySeverity: bySeverity,
    openIncidents: m.incidents.filter((i) => i.status !== "CLOSED").length,
    lostTimeInjuries: lti,
    ltif: ltif(lti, m.hours),
    reportRate: reportRate(m.observations.length, m.hours),
    openActions: m.actions.filter((a) => a.status !== "VERIFIED").length,
    overdueActions: m.actions.filter((a) => isOverdue(a, m.today)).length,
    toolboxTalks: m.toolboxTalks.length,
    toolboxAttendees: m.toolboxTalks.reduce((a, t) => a + t.attendeeCount, 0),
    latestInspectionIndex: indexes[0]?.index ?? null,
    inspectionTrend: indexes.slice(0, 8).reverse(),
  };
}

export type HseMetrics = ReturnType<typeof hseMetrics>;
