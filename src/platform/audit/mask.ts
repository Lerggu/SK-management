/**
 * Audit masking and delta computation (pure functions, unit tested).
 *
 * Sensitive values (personal contact data, rates, secrets) are replaced with
 * MASK in audit deltas. The fact that the field changed is still recorded.
 */
import { Prisma } from "@prisma/client";

export const MASK = "[MASKED]";

/** Fields masked for every entity type. */
const GLOBAL_SENSITIVE = new Set([
  "password",
  "secret",
  "token",
  "sessionToken",
  "access_token",
  "refresh_token",
  "id_token",
]);

/** Entity-specific sensitive fields. */
export const SENSITIVE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  employee: ["email", "phone", "emergencyContactName", "emergencyContactPhone"],
  // HR (ADR 0025): free-text evaluations stay in the HR tables, not in audit deltas.
  competence_assessment: ["observations", "strengths", "developmentAreas", "agreedActions", "employeeComment"],
  employee_rate: ["amount"],
  equipment_rate: ["amount"],
  user: [],
  // V7: injured-person data is personal (health) data.
  incident_person: ["personName", "employeeId", "employerName", "injuryDescription", "bodyPart", "absenceDays"],
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

function isSensitive(entityType: string, field: string): boolean {
  return GLOBAL_SENSITIVE.has(field) || (SENSITIVE_FIELDS[entityType]?.includes(field) ?? false);
}

/** Converts Prisma values (Date, Decimal, BigInt) into JSON-safe values. */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    if (Prisma.Decimal.isDecimal(value)) return value.toString();
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = toJsonValue(v);
    }
    return out;
  }
  return String(value);
}

/** Fields that are bookkeeping noise in deltas. */
const IGNORED_FIELDS = new Set(["updatedAt", "updatedById", "createdAt", "createdById"]);

export function maskRecord(entityType: string, record: Record<string, unknown> | null | undefined): JsonObject | null {
  if (!record) return null;
  const json = toJsonValue(record);
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(json)) {
    if (IGNORED_FIELDS.has(k)) continue;
    out[k] = isSensitive(entityType, k) && v !== null ? MASK : v;
  }
  return out;
}

/**
 * Structured delta: only fields whose value changed, masked.
 * Returns null/null when nothing changed.
 */
export function computeDelta(
  entityType: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: JsonObject | null; after: JsonObject | null } {
  const b = (toJsonValue(before) ?? {}) as JsonObject;
  const a = (toJsonValue(after) ?? {}) as JsonObject;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const db: JsonObject = {};
  const da: JsonObject = {};
  let changed = false;
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (JSON.stringify(b[k] ?? null) === JSON.stringify(a[k] ?? null)) continue;
    changed = true;
    const sensitive = isSensitive(entityType, k);
    db[k] = sensitive && b[k] != null ? MASK : (b[k] ?? null);
    da[k] = sensitive && a[k] != null ? MASK : (a[k] ?? null);
  }
  return changed ? { before: db, after: da } : { before: null, after: null };
}
