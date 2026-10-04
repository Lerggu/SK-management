import { z } from "zod";
import { ValidationError, type FieldErrors } from "@/platform/errors";

/**
 * Validation messages are i18n keys (messages/*.json → "validation.*"), so
 * the UI can show them in Finnish or English. The global error map converts
 * Zod issue codes to keys; schemas may pass explicit keys for custom rules.
 */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case "invalid_type":
        return iss.input === undefined || iss.input === null ? "validation.required" : "validation.invalid";
      case "too_small":
        return iss.origin === "string" && iss.minimum === 1 ? "validation.required" : "validation.tooSmall";
      case "too_big":
        return iss.origin === "string" ? "validation.tooLong" : "validation.tooBig";
      case "invalid_format":
        return iss.format === "email" ? "validation.email" : "validation.invalidFormat";
      case "invalid_value":
        return "validation.invalidOption";
      default:
        return undefined;
    }
  },
});

/** Parses input with a Zod schema, converting failures to ValidationError. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(fieldErrors);
}

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

/** Required trimmed text. */
export const text = (max = 200) => z.string().trim().min(1).max(max);

/** Optional text; empty string becomes null (forms send full records). */
export const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).default(null);

export const optionalEmail = () => z.preprocess(emptyToNull, z.email().max(200).nullable()).default(null);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → Date at UTC midnight (stored in a `date` column). */
export const dateOnly = () =>
  z
    .string()
    .regex(ISO_DATE, "validation.date")
    .transform((s) => new Date(`${s}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), "validation.date");

export const optionalDate = () => z.preprocess(emptyToNull, dateOnly().nullable()).default(null);

/**
 * Money / decimal input. Accepts "1234.5", "1234,50" or "1 234,50" and returns
 * a normalized string for numeric(14,2). Never converted to a float.
 */
export const decimalString = (maxIntegerDigits = 12, scale = 2) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s ]/g, "").replace(",", "."))
    .refine((s) => new RegExp(`^\\d{1,${maxIntegerDigits}}(\\.\\d{1,${scale}})?$`).test(s), "validation.decimal");

export const optionalDecimal = (maxIntegerDigits = 12, scale = 2) =>
  z.preprocess(emptyToNull, decimalString(maxIntegerDigits, scale).nullable()).default(null);

export const currency = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : "EUR"),
    z.string().regex(/^[A-Z]{3}$/, "validation.currency"),
  ).default("EUR");

export const uuid = () => z.uuid();
export const optionalUuid = () => z.preprocess(emptyToNull, z.uuid().nullable()).default(null);

export const slug = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "validation.slug");

/** Checkbox/query flag: true only for true, "true", "on" or "1". */
export const flag = () => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()).default(false);
