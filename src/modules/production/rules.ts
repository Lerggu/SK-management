/**
 * Production control rules (pure, unit tested; ADR 0026): which resource
 * needs of a task type apply to a task, whether a person or a piece of
 * equipment fits a need, and the ranking of candidates. Safety-relevant
 * requirements (a required card, the equipment type) are hard rules here,
 * never left to AI.
 */

export interface RoleLike {
  id: string;
  kind: "PERSON" | "EQUIPMENT";
  label: string;
  quantity: number;
  qualificationTypeId: string | null;
  areaId: string | null;
  minLevel: number | null;
  trade: string | null;
  equipmentTypeId: string | null;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  archivedAt?: Date | null;
}

/**
 * A need applies when the task's heaviest load is within its weight range.
 * With an unknown weight, needs that start from a minimum weight do not
 * apply and the task is flagged (`weightUnknown`).
 */
export function applicableRoles<R extends RoleLike>(roles: readonly R[], weightKg: number | null): { roles: R[]; weightUnknown: boolean } {
  let weightUnknown = false;
  const out = roles.filter((r) => {
    if (r.archivedAt) return false;
    if (r.minWeightKg === null && r.maxWeightKg === null) return true;
    if (weightKg === null) {
      weightUnknown = true;
      return r.minWeightKg === null;
    }
    return (r.minWeightKg === null || weightKg >= r.minWeightKg) && (r.maxWeightKg === null || weightKg <= r.maxWeightKg);
  });
  return { roles: out, weightUnknown };
}

export type FitIssue = "QUALIFICATION_MISSING" | "INACTIVE" | "NOT_ASSESSED" | "LEVEL_LOW" | "TRADE_MISMATCH" | "TYPE_MISMATCH" | "OUT_OF_SERVICE" | "INSPECTION_DUE" | "BUSY" | "ABSENT";

/** Issues that make a resource unusable for the need (assignment is refused). */
export const BLOCKING: ReadonlySet<FitIssue> = new Set(["QUALIFICATION_MISSING", "INACTIVE", "TYPE_MISMATCH", "OUT_OF_SERVICE"]);

export interface PersonFacts {
  active: boolean;
  trade: string | null;
  /** Qualification types with a currently valid card. */
  validQualificationTypes: ReadonlySet<string>;
  /** Latest published supervisor level per competence area (null = not assessed). */
  levels: ReadonlyMap<string, number | null>;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("fi");

export function personFit(role: RoleLike, p: PersonFacts): FitIssue[] {
  const issues: FitIssue[] = [];
  if (!p.active) issues.push("INACTIVE");
  if (role.qualificationTypeId && !p.validQualificationTypes.has(role.qualificationTypeId)) issues.push("QUALIFICATION_MISSING");
  if (role.areaId) {
    const level = p.levels.get(role.areaId) ?? null;
    if (level === null) issues.push("NOT_ASSESSED");
    else if (level < (role.minLevel ?? 1)) issues.push("LEVEL_LOW");
  }
  if (role.trade && !(p.trade && norm(p.trade).includes(norm(role.trade)))) issues.push("TRADE_MISMATCH");
  return issues;
}

export interface EquipmentFacts {
  equipmentTypeId: string;
  status: string;
  nextInspectionDate: Date | null;
}

export function equipmentFit(role: RoleLike, e: EquipmentFacts, periodEnd: Date): FitIssue[] {
  const issues: FitIssue[] = [];
  if (role.equipmentTypeId && e.equipmentTypeId !== role.equipmentTypeId) issues.push("TYPE_MISMATCH");
  if (e.status !== "AVAILABLE" && e.status !== "IN_USE") issues.push("OUT_OF_SERVICE");
  if (e.nextInspectionDate && e.nextInspectionDate < periodEnd) issues.push("INSPECTION_DUE");
  return issues;
}

export const isBlocking = (issues: readonly FitIssue[]) => issues.some((i) => BLOCKING.has(i));

/** Best first: usable and free, then fewer warnings, then busy, then unusable; ties by name. */
export function rankCandidates<C extends { issues: FitIssue[]; label: string }>(list: readonly C[]): C[] {
  const score = (c: C) => (isBlocking(c.issues) ? 1000 : 0) + (c.issues.includes("ABSENT") ? 200 : 0) + (c.issues.includes("BUSY") ? 100 : 0) + c.issues.length;
  return [...list].sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label, "fi"));
}

export type Readiness = "NO_TYPE" | "MISSING" | "READY";

export function readiness(hasType: boolean, needs: readonly { quantity: number; assigned: number }[]): Readiness {
  if (!hasType) return "NO_TYPE";
  return needs.every((n) => n.assigned >= n.quantity) ? "READY" : "MISSING";
}

export const TASK_COLORS = ["slate", "sky", "amber", "emerald", "violet", "rose", "orange", "teal"] as const;

/**
 * Suggested task types for an infrastructure contractor. Requirements refer
 * to the HR catalogues by name and are linked when the company has them.
 */
export const SUGGESTED_TASK_TYPES: readonly {
  name: string;
  serviceType: "DELIVERY" | "LIFT" | "INTERNAL_MOVE" | "WASTE_REMOVAL" | "OTHER";
  color: (typeof TASK_COLORS)[number];
  roles: { kind: "PERSON" | "EQUIPMENT"; label: string; quantity: number; qualification?: string; area?: string; minLevel?: number; minWeightKg?: number }[];
}[] = [
  {
    name: "Nosto",
    serviceType: "LIFT",
    color: "amber",
    roles: [
      { kind: "PERSON", label: "Nostotyönjohtaja", quantity: 1, area: "Nostotyöt ja kiinnittäminen", minLevel: 4 },
      { kind: "PERSON", label: "Taakankiinnittäjä", quantity: 2, area: "Nostotyöt ja kiinnittäminen", minLevel: 3 },
      { kind: "PERSON", label: "Merkinantaja", quantity: 1, area: "Merkinanto", minLevel: 3 },
      { kind: "PERSON", label: "Nostoalueen valvoja", quantity: 1, area: "Työmaan turvallisuus", minLevel: 3 },
    ],
  },
  {
    name: "Kuorman purku",
    serviceType: "DELIVERY",
    color: "sky",
    roles: [
      { kind: "PERSON", label: "Purkaja", quantity: 2, area: "Nostotyöt ja kiinnittäminen", minLevel: 2 },
      { kind: "PERSON", label: "Purun työnjohtaja", quantity: 1, area: "Nostotyöt ja kiinnittäminen", minLevel: 3, minWeightKg: 5000 },
    ],
  },
  { name: "Asennustyö", serviceType: "OTHER", color: "emerald", roles: [{ kind: "PERSON", label: "Asentaja", quantity: 2 }] },
  { name: "Sisäinen siirto", serviceType: "INTERNAL_MOVE", color: "violet", roles: [{ kind: "PERSON", label: "Siirtäjä", quantity: 1 }] },
  { name: "Jätehuolto", serviceType: "WASTE_REMOVAL", color: "slate", roles: [{ kind: "PERSON", label: "Työntekijä", quantity: 1 }] },
];
