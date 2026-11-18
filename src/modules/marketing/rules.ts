/**
 * Pure rules of the marketing register (ADR 0032): duplicate detection,
 * merge of a re-found lead, letter language, sendability.
 */

export const MARKETING_CATEGORIES = ["DATA_CENTER", "HYDROGEN", "BIO", "INDUSTRIAL", "GRID", "ENERGY", "INFRASTRUCTURE", "OTHER"] as const;
export type MarketingCategory = (typeof MARKETING_CATEGORIES)[number];
export const MARKETING_STAGES = ["PLANNING", "PERMITTING", "TENDERING", "CONSTRUCTION", "OPERATION", "UNKNOWN"] as const;
export type MarketingStage = (typeof MARKETING_STAGES)[number];
export const LEAD_STATUSES = ["NEW", "QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "DISCARDED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** What we sell (owner brief 2026-11-17). */
export const MARKETING_SERVICES = ["ELECTRICAL", "INFRA", "LOGISTICS", "STAFFING", "EQUIPMENT", "TURNKEY"] as const;
export type MarketingService = (typeof MARKETING_SERVICES)[number];
export const CALL_STATUSES = ["TODO", "CALLED", "NO_ANSWER", "NOT_INTERESTED", "MEETING"] as const;

/** Statuses after which no new letters are drafted for a lead. */
export const CLOSED_STATUSES: ReadonlySet<LeadStatus> = new Set(["NOT_INTERESTED", "CONVERTED", "DISCARDED"]);

const STOP = new Set([
  "the", "and", "for", "with", "project", "projekti", "hanke", "new", "uusi", "och", "med", "for", "von", "und", "der", "die", "das", "construction",
  "rakentaminen", "urakka", "upphandling", "entreprenad", "works", "work", "oy", "ab", "as", "gmbh", "ltd", "oyj",
]);

/** Lower-case ASCII words of a text (accents removed). */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Identity of a project across sources: country plus the significant words
 * of the title (order-independent, at most 8). The same project found in
 * TED and in the news usually shares its distinctive name words.
 */
export function dedupeKey(input: { country: string | null; title: string }): string {
  const w = [...new Set(words(input.title))].sort().slice(0, 8);
  return `${(input.country ?? "xx").toLowerCase()}|${w.join("-") || "untitled"}`.slice(0, 200);
}

export interface LeadFields {
  title: string;
  summary: string | null;
  category: MarketingCategory;
  stage: MarketingStage;
  country: string | null;
  location: string | null;
  ownerOrg: string | null;
  timing: string | null;
  startDate: Date | null;
  tenderDeadline: Date | null;
  budget: string | null;
  currency: string | null;
  budgetText: string | null;
  voltageKv: number | null;
  fitScore: number;
  services: MarketingService[];
  fitReason: string | null;
}

/**
 * Update for a lead that was found again: only empty fields are filled and
 * the fit score may rise, so edits made by people are never overwritten.
 */
export function mergeLead(existing: Record<keyof LeadFields, unknown>, found: LeadFields): Partial<LeadFields> {
  const out: Partial<LeadFields> = {};
  const fill = <K extends keyof LeadFields>(k: K) => {
    const cur = existing[k];
    const empty = cur === null || cur === undefined || cur === "" || (k === "category" && cur === "OTHER") || (k === "stage" && cur === "UNKNOWN");
    const v = found[k];
    const unknown = v === null || v === undefined || (k === "category" && v === "OTHER") || (k === "stage" && v === "UNKNOWN");
    if (empty && !unknown) (out as Record<string, unknown>)[k] = v;
  };
  (["summary", "category", "stage", "country", "location", "ownerOrg", "timing", "startDate", "tenderDeadline", "budgetText", "voltageKv", "fitReason"] as const).forEach(fill);
  if ((existing.budget === null || existing.budget === undefined) && found.budget !== null && found.currency) {
    out.budget = found.budget;
    out.currency = found.currency;
  }
  if (found.fitScore > Number(existing.fitScore ?? 0)) out.fitScore = found.fitScore;
  const services = new Set([...((existing.services as string[] | null) ?? []), ...found.services]);
  if (services.size > ((existing.services as string[] | null) ?? []).length) out.services = [...services] as MarketingService[];
  return out;
}

/** Letter language by the project's country. */
export function letterLanguage(country: string | null): "fi" | "sv" | "en" {
  if (country === "FI") return "fi";
  if (country === "SE") return "sv";
  return "en";
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export function normaliseEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && EMAIL.test(v) && v.length <= 200 ? v : null;
}

/** http(s) URL or null. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD → Date (UTC midnight) or null. */
export function isoDateOrNull(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function clampScore(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}

/** First day of the month (UTC), for the monthly AI budget. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of the day in UTC, for the daily send limit. */
export function dayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Discovery is due when enabled and the interval has passed since the last run. */
export function discoveryDue(settings: { enabled: boolean; intervalHours: number; lastRunAt: Date | null }, now = new Date()): boolean {
  if (!settings.enabled) return false;
  return !settings.lastRunAt || now.getTime() - settings.lastRunAt.getTime() >= settings.intervalHours * 3_600_000;
}
