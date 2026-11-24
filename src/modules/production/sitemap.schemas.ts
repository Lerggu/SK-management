import { z } from "zod";
import { optionalText, optionalUuid, text } from "@/platform/http/validation";

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

/** Kinds of things on a site map (ADR 0034). Gates, unloading points and storage are logistics locations too. */
export const SITE_MAP_OBJECT_KINDS = ["GATE", "UNLOADING", "STORAGE", "CRANE", "LIFT_AREA", "SITE_OFFICE", "PARKING", "WASTE", "DANGER_ZONE", "OTHER"] as const;
export type SiteMapObjectKind = (typeof SITE_MAP_OBJECT_KINDS)[number];
export const LOCATION_KINDS: readonly SiteMapObjectKind[] = ["GATE", "UNLOADING", "STORAGE"];
/** Kinds drawn as an area by default (others are points). */
export const AREA_KINDS: readonly SiteMapObjectKind[] = ["STORAGE", "LIFT_AREA", "PARKING", "DANGER_ZONE"];

/** A fraction of the map, 0–1 (rounded to 6 decimals). */
const fraction = (min = 0) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(",", ".")) : v),
    z
      .number()
      .min(min)
      .max(1)
      .transform((n) => Math.round(n * 1e6) / 1e6),
  );
const optionalSize = () => z.preprocess((v) => (v === "" || v === undefined ? null : v), fraction(0.005).nullable()).default(null);
const clock = () =>
  z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "validation.clock")
      .transform((s) => {
        const [h, m] = s.split(":").map(Number);
        return h * 60 + m;
      })
      .nullable(),
  ).default(null);

export const siteMapViewSchema = z.object({
  siteId: optionalUuid(),
  date: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date").nullable()).default(null),
  range: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["day", "week"])).default("week"),
});
export type SiteMapViewInput = z.input<typeof siteMapViewSchema>;

export const uploadMapSchema = z.object({
  title: optionalText(120),
  /** Pixel size measured in the browser (the image is shown with this aspect ratio). */
  width: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(50).max(20000)),
  height: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(50).max(20000)),
});
export type UploadMapInput = z.input<typeof uploadMapSchema>;

const areaRefine = (v: { x: number; y: number; width: number | null; height: number | null }) =>
  (v.width === null) === (v.height === null) && (v.width === null || (v.x + v.width <= 1.000001 && v.y + v.height! <= 1.000001));

export const createObjectSchema = z
  .object({
    kind: z.enum(SITE_MAP_OBJECT_KINDS),
    code: optionalText(12),
    name: text(80),
    x: fraction(),
    y: fraction(),
    width: optionalSize(),
    height: optionalSize(),
    notes: optionalText(500),
    /** Place an existing gate/unloading point/storage instead of creating one. */
    locationId: optionalUuid(),
    /** Opening hours of a new gate. */
    opens: clock(),
    closes: clock(),
  })
  .refine(areaRefine, { path: ["width"], message: "validation.areaOutside" })
  .refine((v) => v.opens === null || v.closes === null || v.closes > v.opens, { path: ["closes"], message: "validation.timeRange" });
export type CreateObjectInput = z.input<typeof createObjectSchema>;

export const updateObjectSchema = z.object({ code: optionalText(12), name: text(80), notes: optionalText(500) });
export type UpdateObjectInput = z.input<typeof updateObjectSchema>;

export const moveObjectSchema = z
  .object({ x: fraction(), y: fraction(), width: optionalSize(), height: optionalSize() })
  .refine(areaRefine, { path: ["width"], message: "validation.areaOutside" });
export type MoveObjectInput = z.input<typeof moveObjectSchema>;

export const placeTaskSchema = z.object({ x: fraction(), y: fraction(), objectId: optionalUuid() });
export type PlaceTaskInput = z.input<typeof placeTaskSchema>;
