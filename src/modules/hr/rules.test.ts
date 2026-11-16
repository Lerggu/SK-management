import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  isReminderWindow,
  latestPublishedByArea,
  meetsLanguage,
  reminderDueDate,
  requirementGaps,
  validityState,
  type AssessmentLike,
  type RequirementLike,
} from "./rules";

describe("reminderDueDate (one calendar month before expiry)", () => {
  it.each([
    ["2027-05-15", "2027-04-15"],
    ["2027-01-10", "2026-12-10"],
    ["2027-03-31", "2027-02-28"],
    ["2028-03-31", "2028-02-29"],
    ["2027-05-31", "2027-04-30"],
    ["2027-07-31", "2027-06-30"],
    ["2027-03-30", "2027-02-28"],
    ["2027-03-28", "2027-02-28"],
    ["2027-12-31", "2027-11-30"],
    ["2027-02-28", "2027-01-28"],
    ["2028-02-29", "2028-01-29"],
  ])("%s → %s", (expires, due) => {
    expect(reminderDueDate(expires)).toBe(due);
  });

  it("adds months across years both ways", () => {
    expect(addCalendarMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addCalendarMonths("2026-01-31", -13)).toBe("2024-12-31");
    expect(addCalendarMonths("2026-01-15", 0)).toBe("2026-01-15");
  });
});

describe("isReminderWindow", () => {
  it("opens on the due date and closes after the last valid day", () => {
    expect(isReminderWindow("2027-03-31", "2027-02-27")).toBe(false);
    expect(isReminderWindow("2027-03-31", "2027-02-28")).toBe(true);
    expect(isReminderWindow("2027-03-31", "2027-03-31")).toBe(true);
    expect(isReminderWindow("2027-03-31", "2027-04-01")).toBe(false);
  });

  it("a card added after the due date but before expiry is still reminded", () => {
    expect(isReminderWindow("2027-03-31", "2027-03-20")).toBe(true);
  });
});

describe("validityState", () => {
  it("distinguishes valid, expiring within a month, expired and no expiry", () => {
    expect(validityState("2027-06-30", false, "2027-05-29")).toBe("VALID");
    expect(validityState("2027-06-30", false, "2027-05-30")).toBe("EXPIRING");
    expect(validityState("2027-06-30", false, "2027-06-30")).toBe("EXPIRING");
    expect(validityState("2027-06-30", false, "2027-07-01")).toBe("EXPIRED");
    expect(validityState(null, true, "2027-07-01")).toBe("NO_EXPIRY");
    expect(validityState(null, false, "2027-07-01")).toBe("UNKNOWN");
  });
});

describe("latestPublishedByArea", () => {
  const row = (o: Partial<AssessmentLike> & { id: string }): AssessmentLike & { id: string } => ({
    areaId: "a1",
    kind: "SUPERVISOR",
    status: "PUBLISHED",
    level: 2,
    assessedOn: new Date("2026-01-01"),
    publishedAt: new Date("2026-01-01T10:00:00Z"),
    createdAt: new Date("2026-01-01T09:00:00Z"),
    ...o,
  });

  it("uses the newest published assessment and ignores drafts and other kinds", () => {
    const rows = [
      row({ id: "old", level: 1, assessedOn: new Date("2025-06-01") }),
      row({ id: "new", level: 3, assessedOn: new Date("2026-02-01") }),
      row({ id: "draft", level: 4, status: "DRAFT", publishedAt: null, assessedOn: new Date("2026-05-01") }),
      row({ id: "self", level: 4, kind: "SELF", assessedOn: new Date("2026-06-01") }),
      row({ id: "other-area", areaId: "a2", level: 2 }),
    ];
    const latest = latestPublishedByArea(rows, "SUPERVISOR");
    expect(latest.get("a1")?.id).toBe("new");
    expect(latest.get("a2")?.id).toBe("other-area");
    expect(latestPublishedByArea(rows, "SELF").get("a1")?.id).toBe("self");
  });

  it("on the same assessment date the later publication wins", () => {
    const rows = [row({ id: "first", publishedAt: new Date("2026-01-01T10:00:00Z") }), row({ id: "second", publishedAt: new Date("2026-01-01T12:00:00Z") })];
    expect(latestPublishedByArea(rows, "SUPERVISOR").get("a1")?.id).toBe("second");
  });

  it("a published 'not assessed' (null level) is kept distinct from a low level", () => {
    const latest = latestPublishedByArea([row({ id: "x", level: null })], "SUPERVISOR");
    expect(latest.get("a1")?.level).toBeNull();
  });
});

describe("meetsLanguage", () => {
  const fi = { language: "fi", speaking: "FLUENT", understanding: "BASIC", reading: "BEGINNER", writing: "NOT_ASSESSED" } as const;
  it("requires both speaking and understanding at the level", () => {
    expect(meetsLanguage([fi], "fi", "BASIC")).toBe(true);
    expect(meetsLanguage([fi], "fi", "FLUENT")).toBe(false);
    expect(meetsLanguage([fi], "en", "BEGINNER")).toBe(false);
  });
});

describe("requirementGaps", () => {
  const req = (o: Partial<RequirementLike> & { id: string }): RequirementLike => ({
    kind: "COMPETENCE",
    areaId: null,
    minLevel: null,
    qualificationTypeId: null,
    orientationScope: null,
    orientationTopic: null,
    ...o,
  });
  const requirements = [
    req({ id: "c1", areaId: "dig", minLevel: 3 }),
    req({ id: "c2", areaId: "survey", minLevel: 2 }),
    req({ id: "c3", areaId: "lift", minLevel: 2 }),
    req({ id: "q1", kind: "QUALIFICATION", qualificationTypeId: "ttk" }),
    req({ id: "q2", kind: "QUALIFICATION", qualificationTypeId: "tulityo" }),
    req({ id: "o1", kind: "ORIENTATION", orientationScope: "COMPANY", orientationTopic: "Yrityksen  yleisperehdytys" }),
  ];

  it("reports below level, not assessed, missing card and missing orientation", () => {
    const gaps = requirementGaps(requirements, {
      levels: new Map([
        ["dig", 2],
        ["survey", 4],
      ]),
      validQualificationTypes: new Set(["ttk"]),
      orientations: [],
    });
    expect(gaps.map((g) => [g.requirement.id, g.reason])).toEqual([
      ["c1", "BELOW_LEVEL"],
      ["c3", "NOT_ASSESSED"],
      ["q2", "MISSING"],
      ["o1", "NOT_DONE"],
    ]);
  });

  it("matches orientation topics case- and whitespace-insensitively", () => {
    const gaps = requirementGaps(requirements.slice(5), { levels: new Map(), validQualificationTypes: new Set(), orientations: [{ scope: "COMPANY", topic: "yrityksen yleisperehdytys" }] });
    expect(gaps).toEqual([]);
  });
});
