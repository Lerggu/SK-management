import "server-only";
import { unstable_rethrow } from "next/navigation";
import { isAppError, ValidationError, ConflictError, RateLimitedError, type FieldErrors } from "@/platform/errors";

/**
 * Result of a server action, consumed by <ActionForm>. Messages are i18n
 * keys; `values` echoes the submitted fields so the form keeps user input.
 */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  }
  return out;
}

/** Plain object from FormData (strings only); multi-value keys become arrays. */
export function formObject(formData: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION")) continue;
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/**
 * Executes a server action body and maps domain errors to form state.
 * redirect()/notFound() thrown inside `fn` propagate unchanged.
 */
export async function runAction(formData: FormData | null, fn: () => Promise<void>): Promise<ActionState> {
  const values = formData ? formValues(formData) : undefined;
  try {
    await fn();
    return { ok: true, message: "common.saved" };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) return { ok: false, message: "errors.validation", fieldErrors: e.fieldErrors, values };
    if (e instanceof ConflictError) return { ok: false, message: "errors.conflict", fieldErrors: e.field ? { [e.field]: ["errors.conflict"] } : undefined, values };
    if (e instanceof RateLimitedError) return { ok: false, message: "errors.rateLimited", values };
    if (isAppError(e) && e.status === 403) return { ok: false, message: "errors.forbidden", values };
    if (isAppError(e) && e.status === 404) return { ok: false, message: "errors.notFound", values };
    console.error("Unhandled action error", e);
    return { ok: false, message: "errors.generic", values };
  }
}

/** Reads an uploaded file from FormData. */
export async function readFile(formData: FormData, name = "file"): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const file = formData.get(name);
  if (!file || typeof file === "string" || file.size === 0) return null;
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * Untyped form input handed to a service. Services validate every field with
 * Zod, so the cast only satisfies the compiler — it is never trusted.
 */
export function formInput<T>(formData: FormData): T {
  return formObject(formData) as unknown as T;
}
