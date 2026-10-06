/**
 * Pure HR rules (unit tested): reminder dates, validity states, the latest
 * assessment per area and job-requirement gaps. Dates are calendar dates
 * ("YYYY-MM-DD"); "today" is the Helsinki calendar date.
 */

export type IsoDate = string;

export function isoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function dateFromIso(s: IsoDate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Adds calendar months; a day missing in the target month becomes its last day. */
export function addCalendarMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month0 = index - year * 12;
  const day = Math.min(d, daysInMonth(year, month0));
  return `${String(year).padStart(4, "0")}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reminder date: one calendar month before the last valid day. When that day
 * does not exist (31 March → 31 February), the last day of the month is used.
 */
export function reminderDueDate(expiresOn: IsoDate): IsoDate {
  return addCalendarMonths(expiresOn, -1);
}

/**
 * A reminder is sent in the run on or after the due date while the card is
 * still valid (the expiry date is its last valid day). A card added after
 * the due date but before expiry is reminded in the next run.
 */
export function isReminderWindow(expiresOn: IsoDate, today: IsoDate): boolean {
  return reminderDueDate(expiresOn) <= today && today <= expiresOn;
}

export type ValidityState = "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY" | "UNKNOWN";

/** Validity shown with text and colour: expiring = within a calendar month. */
export function validityState(expiresOn: IsoDate | null, noExpiry: boolean, today: IsoDate): ValidityState {
  if (!expiresOn) return noExpiry ? "NO_EXPIRY" : "UNKNOWN";
  if (today > expiresOn) return "EXPIRED";
  if (today >= reminderDueDate(expiresOn)) return "EXPIRING";
  return "VALID";
}

/** Whether a record counts as a currently valid qualification. */
export function isCurrentlyValid(expiresOn: IsoDate | null, noExpiry: boolean, today: IsoDate): boolean {
  const s = validityState(expiresOn, noExpiry, today);
  return s === "VALID" || s === "EXPIRING" || s === "NO_EXPIRY";
}

export interface AssessmentLike {
  areaId: string;
  kind: "SUPERVISOR" | "SELF";
  status: "DRAFT" | "PUBLISHED";
  level: number | null;
  assessedOn: Date;
  publishedAt: Date | null;
  createdAt: Date;
  archivedAt?: Date | null;
}

/**
 * Latest published assessment of each area for one kind: newest assessment
 * date, then newest publication. Drafts and archived rows never count.
 */
export function latestPublishedByArea<T extends AssessmentLike>(rows: readonly T[], kind: "SUPERVISOR" | "SELF"): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.kind !== kind || r.status !== "PUBLISHED" || r.archivedAt) continue;
    const prev = out.get(r.areaId);
    if (!prev || compareAssessments(r, prev) > 0) out.set(r.areaId, r);
  }
  return out;
}

function compareAssessments(a: AssessmentLike, b: AssessmentLike): number {
  const byDate = a.assessedOn.getTime() - b.assessedOn.getTime();
  if (byDate !== 0) return byDate;
  const byPublished = (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0);
  if (byPublished !== 0) return byPublished;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export const LANGUAGE_LEVELS = ["NOT_ASSESSED", "BEGINNER", "BASIC", "FLUENT", "NATIVE"] as const;
export type LanguageLevelKey = (typeof LANGUAGE_LEVELS)[number];

export function languageLevelRank(level: LanguageLevelKey): number {
  return LANGUAGE_LEVELS.indexOf(level);
}

export interface LanguageLike {
  language: string;
  speaking: LanguageLevelKey;
  understanding: LanguageLevelKey;
  reading: LanguageLevelKey;
  writing: LanguageLevelKey;
}

/**
 * Language filter for crew planning: the employee has the language with at
 * least `minLevel` in speaking and understanding (any assessment source).
 */
export function meetsLanguage(rows: readonly LanguageLike[], language: string, minLevel: LanguageLevelKey): boolean {
  const min = languageLevelRank(minLevel);
  return rows.some((r) => r.language === language && languageLevelRank(r.speaking) >= min && languageLevelRank(r.understanding) >= min);
}

export interface RequirementLike {
  id: string;
  kind: "COMPETENCE" | "QUALIFICATION" | "ORIENTATION";
  areaId: string | null;
  minLevel: number | null;
  qualificationTypeId: string | null;
  orientationScope: "COMPANY" | "SITE" | "EQUIPMENT" | null;
  orientationTopic: string | null;
}

export interface EmployeeFacts {
  /** Latest published supervisor level per area (null = not assessed). */
  levels: ReadonlyMap<string, number | null>;
  /** Qualification type ids with a currently valid record. */
  validQualificationTypes: ReadonlySet<string>;
  /** Done orientations (scope + normalized topic). */
  orientations: readonly { scope: string; topic: string }[];
}

export type GapReason = "NOT_ASSESSED" | "BELOW_LEVEL" | "MISSING" | "NOT_DONE";

export interface RequirementGap<R extends RequirementLike = RequirementLike> {
  requirement: R;
  reason: GapReason;
  currentLevel?: number | null;
}

export const normalizeTopic = (s: string) => s.trim().toLocaleLowerCase("fi").replace(/\s+/g, " ");

/** Compares an employee with the requirements of their job profile. */
export function requirementGaps<R extends RequirementLike>(requirements: readonly R[], facts: EmployeeFacts): RequirementGap<R>[] {
  const gaps: RequirementGap<R>[] = [];
  for (const r of requirements) {
    if (r.kind === "COMPETENCE" && r.areaId) {
      const level = facts.levels.get(r.areaId) ?? null;
      if (level === null) gaps.push({ requirement: r, reason: "NOT_ASSESSED", currentLevel: null });
      else if (level < (r.minLevel ?? 1)) gaps.push({ requirement: r, reason: "BELOW_LEVEL", currentLevel: level });
    } else if (r.kind === "QUALIFICATION" && r.qualificationTypeId) {
      if (!facts.validQualificationTypes.has(r.qualificationTypeId)) gaps.push({ requirement: r, reason: "MISSING" });
    } else if (r.kind === "ORIENTATION" && r.orientationTopic) {
      const topic = normalizeTopic(r.orientationTopic);
      if (!facts.orientations.some((o) => o.scope === r.orientationScope && normalizeTopic(o.topic) === topic)) gaps.push({ requirement: r, reason: "NOT_DONE" });
    }
  }
  return gaps;
}

/** Suggested competence areas for an infrastructure contractor (admin can add them in one step). */
export const SUGGESTED_COMPETENCE_AREAS: readonly { category: string; name: string; isKey: boolean }[] = [
  { category: "Maanrakennus", name: "Kaivannot ja luiskat", isKey: true },
  { category: "Maanrakennus", name: "Kaivantojen tuennat", isKey: true },
  { category: "Maanrakennus", name: "Täytöt ja tiivistys", isKey: false },
  { category: "Koneet ja työvälineet", name: "Kaivinkone", isKey: true },
  { category: "Koneet ja työvälineet", name: "Pyöräkuormaaja", isKey: false },
  { category: "Koneet ja työvälineet", name: "Dumpperi ja kuorma-auto", isKey: false },
  { category: "Koneet ja työvälineet", name: "Tärylevy ja jyrä", isKey: false },
  { category: "Koneet ja työvälineet", name: "Pienkoneet ja käsityökalut", isKey: false },
  { category: "Putki- ja kunnallistekniikka", name: "Vesijohdot ja viemärit", isKey: true },
  { category: "Putki- ja kunnallistekniikka", name: "Kaapeli- ja suojaputkiasennus", isKey: false },
  { category: "Putki- ja kunnallistekniikka", name: "Kaivot ja liitokset", isKey: false },
  { category: "Mittaus", name: "Työmaamittaus", isKey: true },
  { category: "Mittaus", name: "Koneohjaus", isKey: true },
  { category: "Mittaus", name: "Piirustusten ja suunnitelmien lukeminen", isKey: true },
  { category: "Nosto- ja merkinantotyöt", name: "Nostotyöt ja kiinnittäminen", isKey: true },
  { category: "Nosto- ja merkinantotyöt", name: "Merkinanto", isKey: false },
  { category: "Turvallisuus ja laatu", name: "Työmaan turvallisuus", isKey: true },
  { category: "Turvallisuus ja laatu", name: "Liikennejärjestelyt", isKey: false },
  { category: "Turvallisuus ja laatu", name: "Laadunvarmistus ja dokumentointi", isKey: true },
  { category: "Työnjohto", name: "Työn suunnittelu", isKey: true },
  { category: "Työnjohto", name: "Työnjohto", isKey: false },
  { category: "Työnjohto", name: "Perehdyttäminen", isKey: false },
];

/** Suggested card and qualification types (validity in months where fixed). */
export const SUGGESTED_QUALIFICATION_TYPES: readonly { name: string; defaultIssuer: string | null; defaultValidityMonths: number | null }[] = [
  { name: "Työturvallisuuskortti", defaultIssuer: "Työturvallisuuskeskus TTK", defaultValidityMonths: 60 },
  { name: "Tieturva 1", defaultIssuer: null, defaultValidityMonths: 60 },
  { name: "Tieturva 2", defaultIssuer: null, defaultValidityMonths: 60 },
  { name: "Tulityökortti", defaultIssuer: "Suomen Pelastusalan Keskusjärjestö SPEK", defaultValidityMonths: 60 },
  { name: "Ensiapu EA1", defaultIssuer: "Suomen Punainen Risti", defaultValidityMonths: 36 },
  { name: "Ensiapu EA2", defaultIssuer: "Suomen Punainen Risti", defaultValidityMonths: 36 },
  { name: "Hätäensiapu", defaultIssuer: "Suomen Punainen Risti", defaultValidityMonths: 36 },
  { name: "Sähkötyöturvallisuus (SFS 6002)", defaultIssuer: null, defaultValidityMonths: 60 },
  { name: "Vesityökortti", defaultIssuer: "Ruokavirasto", defaultValidityMonths: 60 },
  { name: "Ammattipätevyys (kuljettaja)", defaultIssuer: "Traficom", defaultValidityMonths: 60 },
  { name: "Ajokortti", defaultIssuer: "Traficom", defaultValidityMonths: null },
  { name: "Nostokortti / nostotöiden pätevyys", defaultIssuer: null, defaultValidityMonths: null },
];
