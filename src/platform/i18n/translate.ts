import fi from "./messages/fi.json";
import en from "./messages/en.json";
import { toLocale } from "./config";

const MESSAGES = { fi, en } as const;

/**
 * Server-side translation outside React (e-mails). Looks up a dotted key in
 * the locale's messages and fills {param} placeholders. Falls back to the key.
 */
export function translate(locale: string | null | undefined, key: string, params: Record<string, string | number> = {}): string {
  let node: unknown = MESSAGES[toLocale(locale)];
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== "string") return key;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
