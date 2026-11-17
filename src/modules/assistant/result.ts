import { z } from "zod";
import { ACTION_TYPES } from "./actions";

/** The assistant's structured answer (strict-tool compatible). */
export const ASSISTANT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: { type: "string", description: "Short reply to the person: what you propose, or one question." },
    actions: {
      type: "array",
      description: "Proposed actions in the order they must be done. Empty when you ask a question.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "params_json"],
        properties: {
          type: { type: "string", enum: [...ACTION_TYPES] },
          params_json: { type: "string", description: "The action's params as a JSON object string." },
        },
      },
    },
  },
} as const;

/** Model output is untrusted: shape and size first, params per action later. */
export const assistantResultSchema = z.object({
  reply: z.string().trim().min(1).max(2000),
  actions: z.array(z.object({ type: z.string().max(40), params_json: z.string().max(4000) })).max(20),
});

/**
 * Rule-based answer for the deterministic provider (tests and keyless
 * development only): understands "uusi projekti <Nimi>" and
 * "lisää henkilö <Etunimi> <Sukunimi>[, <ammatti>]". Labelled [TEST].
 */
export function deterministicAssistantAnswer(message: string) {
  const actions: { type: string; params_json: string }[] = [];
  const project = /projekti\s+([A-ZÅÄÖ][\p{L}-]+)/u.exec(message);
  if (project) actions.push({ type: "create_project", params_json: JSON.stringify({ name: project[1] }) });
  const person = /henkilö\s+([A-ZÅÄÖ][\p{L}-]+)\s+([A-ZÅÄÖ][\p{L}-]+)(?:,\s*([^,.]+))?/u.exec(message);
  if (person) actions.push({ type: "create_employee", params_json: JSON.stringify({ firstName: person[1], lastName: person[2], trade: person[3]?.trim() || null }) });
  return { reply: actions.length ? `[TEST] Ehdotan ${actions.length} toimenpidettä. Tarkista ja vahvista.` : "[TEST] En tunnistanut toimenpidettä. Kokeile esim. ”uusi projekti Mikkeli”.", actions };
}
