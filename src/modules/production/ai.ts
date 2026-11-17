/**
 * Pure helpers of the AI staffing suggestion (ADR 0026, phase 4).
 *
 * The AI provider sees a pseudonymised view of a task: needs as N1, N2… and
 * candidates as C1, C2… with only their trade (people) or type (equipment)
 * and the rule warnings. No names, asset numbers or ids leave the system
 * (owner decision: no personal data to the AI provider). Candidates that the
 * rules block are never offered, and every pick the model returns is checked
 * against the offered set before a person can accept it.
 */
import { z } from "zod";
import type { FitIssue } from "./rules";

export const STAFFING_PROMPT_VERSION = "logistics-staffing/1";
export const RISK_PROMPT_VERSION = "logistics-risk/1";
/** Candidates offered per need (the rule ranking decides which). */
export const MAX_CANDIDATES_PER_NEED = 12;

export interface StaffingNeedInput {
  role: { id: string; label: string; kind: "PERSON" | "EQUIPMENT"; quantity: number; minLevel: number | null; trade: string | null };
  /** Card and competence requirement names (catalogue names, not personal data). */
  requires: { card: string | null; competence: string | null; equipmentType: string | null };
  missing: number;
  candidates: { value: string; label: string; detail: string | null; issues: FitIssue[]; blocking: boolean }[];
}

export interface StaffingTaskInput {
  serviceType: string;
  taskType: string | null;
  start: Date;
  end: Date;
  weightKg: number | null;
}

export interface PseudonymisedStaffing {
  payload: {
    task: { serviceType: string; taskType: string | null; start: string; end: string; durationHours: number; heaviestLoadKg: number | null };
    needs: {
      need: string;
      role: string;
      kind: "PERSON" | "EQUIPMENT";
      missing: number;
      requires: { card: string | null; competence: string | null; minLevel: number | null; trade: string | null; equipmentType: string | null };
      candidates: { candidate: string; trade: string | null; warnings: FitIssue[] }[];
    }[];
  };
  /** N# → role id. */
  needs: Map<string, { roleId: string; label: string; missing: number; candidates: Set<string> }>;
  /** C# → resource value ("EMPLOYEE:id" / "EQUIPMENT:id") and its display label. */
  candidates: Map<string, { resource: string; label: string }>;
}

/** Builds the pseudonymised tool output and the server-side reference maps. */
export function pseudonymiseStaffing(task: StaffingTaskInput, needs: StaffingNeedInput[]): PseudonymisedStaffing {
  const byResource = new Map<string, string>();
  const candidates = new Map<string, { resource: string; label: string }>();
  const needMap: PseudonymisedStaffing["needs"] = new Map();
  const ref = (value: string, label: string) => {
    let c = byResource.get(value);
    if (!c) {
      c = `C${byResource.size + 1}`;
      byResource.set(value, c);
      candidates.set(c, { resource: value, label });
    }
    return c;
  };
  const payloadNeeds = needs
    .filter((n) => n.missing > 0)
    .map((n, i) => {
      const need = `N${i + 1}`;
      const offered = n.candidates.filter((c) => !c.blocking).slice(0, MAX_CANDIDATES_PER_NEED);
      const refs = offered.map((c) => ({ candidate: ref(c.value, c.label), trade: n.role.kind === "PERSON" ? c.detail : null, warnings: c.issues }));
      needMap.set(need, { roleId: n.role.id, label: n.role.label, missing: n.missing, candidates: new Set(refs.map((r) => r.candidate)) });
      return {
        need,
        role: n.role.label,
        kind: n.role.kind,
        missing: n.missing,
        requires: { card: n.requires.card, competence: n.requires.competence, minLevel: n.role.minLevel, trade: n.role.trade, equipmentType: n.requires.equipmentType },
        candidates: refs,
      };
    });
  return {
    payload: {
      task: {
        serviceType: task.serviceType,
        taskType: task.taskType,
        start: task.start.toISOString(),
        end: task.end.toISOString(),
        durationHours: Math.round(((task.end.getTime() - task.start.getTime()) / 3_600_000) * 10) / 10,
        heaviestLoadKg: task.weightKg,
      },
      needs: payloadNeeds,
    },
    needs: needMap,
    candidates,
  };
}

/** JSON Schema of the staffing answer (strict-tool compatible). */
export const STAFFING_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "picks"],
  properties: {
    summary: { type: "string", description: "1-3 sentences: how the task is staffed and what remains open." },
    picks: {
      type: "array",
      description: "One entry per proposed assignment. At most `missing` picks per need; a candidate at most once overall.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["need", "candidate", "reason"],
        properties: {
          need: { type: "string", description: "Need reference, e.g. N1." },
          candidate: { type: "string", description: "Candidate reference offered for that need, e.g. C3." },
          reason: { type: "string", description: "Short reason (one sentence)." },
        },
      },
    },
  },
} as const;

/** The model's answer is untrusted output: shape and length checks first. */
export const staffingResultSchema = z.object({
  summary: z.string().trim().min(1).max(1500),
  picks: z
    .array(z.object({ need: z.string().trim().max(10), candidate: z.string().trim().max(10), reason: z.string().trim().max(500) }))
    .max(100),
});
export type StaffingResult = z.output<typeof staffingResultSchema>;

export interface ResolvedPick {
  roleId: string;
  roleLabel: string;
  resource: string;
  label: string;
  reason: string;
}

/**
 * Maps the model's picks back to roles and resources. Picks that name an
 * unknown need, a candidate not offered for that need, a resource already
 * picked, or exceed the need's open quantity are dropped (and counted).
 */
export function resolvePicks(p: PseudonymisedStaffing, picks: StaffingResult["picks"]): { picks: ResolvedPick[]; rejected: number } {
  const used = new Set<string>();
  const perNeed = new Map<string, number>();
  const out: ResolvedPick[] = [];
  let rejected = 0;
  for (const pick of picks) {
    const need = p.needs.get(pick.need);
    const cand = p.candidates.get(pick.candidate);
    if (!need || !cand || !need.candidates.has(pick.candidate) || used.has(cand.resource) || (perNeed.get(pick.need) ?? 0) >= need.missing) {
      rejected++;
      continue;
    }
    used.add(cand.resource);
    perNeed.set(pick.need, (perNeed.get(pick.need) ?? 0) + 1);
    out.push({ roleId: need.roleId, roleLabel: need.label, resource: cand.resource, label: cand.label, reason: pick.reason });
  }
  return { picks: out, rejected };
}

/**
 * Rule-only answer in the staffing result shape: the best-ranked offered
 * candidates per need. Used by the deterministic provider (tests and keyless
 * development); clearly labelled as such.
 */
export function ruleBasedAnswer(payload: PseudonymisedStaffing["payload"]): StaffingResult {
  const used = new Set<string>();
  const picks: StaffingResult["picks"] = [];
  for (const n of payload.needs) {
    for (const c of n.candidates) {
      if (picks.filter((x) => x.need === n.need).length >= n.missing) break;
      if (used.has(c.candidate)) continue;
      used.add(c.candidate);
      picks.push({ need: n.need, candidate: c.candidate, reason: c.warnings.length ? `[TEST] Rule ranking (${c.warnings.join(", ")})` : "[TEST] Rule ranking: no warnings" });
    }
  }
  return { summary: `[TEST] Deterministic suggestion without an AI model: ${picks.length} picks.`, picks };
}
