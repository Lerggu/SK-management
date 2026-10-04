import { z } from "zod";
import { optionalDate, optionalDecimal, optionalText, optionalUuid, text, uuid, flag } from "@/platform/http/validation";

export const EQUIPMENT_CATEGORIES = [
  "CRANE",
  "TELEHANDLER",
  "EXCAVATOR",
  "WHEEL_LOADER",
  "FORKLIFT",
  "AERIAL_PLATFORM",
  "VEHICLE",
  "LIFTING_ACCESSORY",
  "CABLE_EQUIPMENT",
  "OTHER",
] as const;
export const EQUIPMENT_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"] as const;

export const equipmentTypeSchema = z.object({
  name: text(120),
  category: z.enum(EQUIPMENT_CATEGORIES).default("OTHER"),
  description: optionalText(1000),
});
export type EquipmentTypeInput = z.input<typeof equipmentTypeSchema>;

export const equipmentSchema = z
  .object({
    equipmentTypeId: uuid(),
    assetNumber: text(40),
    name: text(160),
    manufacturer: optionalText(120),
    model: optionalText(120),
    serialNumber: optionalText(120),
    registrationNumber: optionalText(40),
    status: z.enum(EQUIPMENT_STATUSES).default("AVAILABLE"),
    currentProjectId: optionalUuid(),
    currentSiteId: optionalUuid(),
    meterHours: optionalDecimal(9, 1),
    nextInspectionDate: optionalDate(),
    notes: optionalText(2000),
  })
  .refine((v) => !v.currentSiteId || v.currentProjectId, { path: ["currentSiteId"], message: "validation.siteRequiresProject" });
export type EquipmentInput = z.input<typeof equipmentSchema>;

export const equipmentListSchema = z.object({
  q: optionalText(100),
  includeArchived: flag(),
  projectId: optionalUuid(),
});
