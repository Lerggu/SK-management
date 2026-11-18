/**
 * The Claude API rejects strict tool schemas with more than 16 union-typed
 * parameters (anyOf or type arrays, e.g. nullable fields): "Schemas contains
 * too many parameters with union types". Every structured result schema the
 * app sends must stay within the limit.
 */
import { describe, expect, it } from "vitest";
import { AI_INSIGHT_SCHEMA } from "@/platform/ai";
import { ASSISTANT_RESULT_SCHEMA } from "@/modules/assistant/result";
import { STAFFING_RESULT_SCHEMA } from "@/modules/production/ai";
import { DISCOVERY_SCHEMA, LETTER_SCHEMA, TED_SCORE_SCHEMA } from "./ai";

/** Number of properties (at any depth) whose schema is a union. */
function unionParams(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  const s = schema as Record<string, unknown>;
  let n = 0;
  if (s.properties && typeof s.properties === "object") {
    for (const p of Object.values(s.properties as Record<string, Record<string, unknown>>)) {
      if (Array.isArray(p?.anyOf) || Array.isArray(p?.oneOf) || Array.isArray(p?.type)) n++;
      n += unionParams(p);
    }
  }
  if (s.items) n += unionParams(s.items);
  for (const key of ["anyOf", "oneOf"] as const) if (Array.isArray(s[key])) for (const v of s[key] as unknown[]) n += unionParams(v);
  return n;
}

describe("AI result schemas stay within the API's union-parameter limit", () => {
  const schemas = { AI_INSIGHT_SCHEMA, ASSISTANT_RESULT_SCHEMA, STAFFING_RESULT_SCHEMA, TED_SCORE_SCHEMA, DISCOVERY_SCHEMA, LETTER_SCHEMA };
  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} has at most 16 union-typed parameters`, () => {
      expect(unionParams(schema)).toBeLessThanOrEqual(16);
    });
  }
  it("counts nullable fields at any depth", () => {
    expect(unionParams({ type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] }, b: { type: "array", items: { type: "object", properties: { c: { type: ["string", "null"] } } } } } })).toBe(2);
  });
});
