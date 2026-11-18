import { describe, expect, it } from "vitest";
import { err } from "./agents";
import { clampScore, dedupeKey, discoveryDue, isoDateOrNull, letterLanguage, mergeLead, normaliseEmail, safeUrl, words, type LeadFields } from "./rules";

const lead = (over: Partial<LeadFields> = {}): LeadFields => ({
  title: "X",
  summary: null,
  category: "OTHER",
  stage: "UNKNOWN",
  country: null,
  location: null,
  ownerOrg: null,
  timing: null,
  startDate: null,
  tenderDeadline: null,
  budget: null,
  currency: null,
  budgetText: null,
  voltageKv: null,
  fitScore: 0,
  services: [],
  fitReason: null,
  ...over,
});

describe("marketing rules", () => {
  it("dedupe key ignores word order, accents, case and filler words", () => {
    expect(dedupeKey({ country: "FI", title: "Kajaanin datakeskus – 110 kV liittymä" })).toBe(dedupeKey({ country: "fi", title: "110 kV LIITTYMÄ, Kajaanin Datakeskus projekti" }));
    expect(dedupeKey({ country: "SE", title: "Kajaanin datakeskus" })).not.toBe(dedupeKey({ country: "FI", title: "Kajaanin datakeskus" }));
    expect(dedupeKey({ country: null, title: "Oy" })).toBe("xx|untitled");
    expect(words("Ääneväki ÖVERGÅNG ab")).toEqual(["aanevaki", "overgang"]);
  });

  it("merge fills only empty fields and never lowers the score", () => {
    const existing = { ...lead({ title: "A", ownerOrg: "Edited by a person", fitScore: 70, services: ["ELECTRICAL"] }) } as Record<keyof LeadFields, unknown>;
    const found = lead({ title: "A", ownerOrg: "Agent value", location: "Oulu", fitScore: 60, services: ["ELECTRICAL", "LOGISTICS"], category: "GRID", budget: "100.00", currency: "EUR" });
    expect(mergeLead(existing, found)).toEqual({ location: "Oulu", category: "GRID", budget: "100.00", currency: "EUR", services: ["ELECTRICAL", "LOGISTICS"] });
    expect(mergeLead(existing, lead({ fitScore: 90 }))).toEqual({ fitScore: 90 });
  });

  it("letter language, e-mail, URL, date and score normalisation", () => {
    expect([letterLanguage("FI"), letterLanguage("SE"), letterLanguage("DE"), letterLanguage(null)]).toEqual(["fi", "sv", "en", "en"]);
    expect(normaliseEmail(" Matti.M@Example.FI ")).toBe("matti.m@example.fi");
    expect(normaliseEmail("not an email")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://fingrid.fi/a")).toBe("https://fingrid.fi/a");
    expect(isoDateOrNull("2027-02-30")?.toISOString().slice(0, 10)).toBe("2027-03-02");
    expect(isoDateOrNull("soon")).toBeNull();
    expect([clampScore(140), clampScore(-3), clampScore("x"), clampScore(55.6)]).toEqual([100, 0, 0, 56]);
  });

  it("discovery is due when enabled and the interval has passed", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(discoveryDue({ enabled: false, intervalHours: 24, lastRunAt: null }, now)).toBe(false);
    expect(discoveryDue({ enabled: true, intervalHours: 24, lastRunAt: null }, now)).toBe(true);
    expect(discoveryDue({ enabled: true, intervalHours: 24, lastRunAt: new Date("2026-11-18T00:00:00Z") }, now)).toBe(false);
    expect(discoveryDue({ enabled: true, intervalHours: 12, lastRunAt: new Date("2026-11-18T00:00:00Z") }, now)).toBe(true);
  });

  it("maps provider and source failures to translatable messages", () => {
    expect(err(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'))).toBe("marketing.errors.aiKey");
    expect(err(new Error('529 {"type":"error","error":{"type":"overloaded_error"}}'))).toBe("marketing.errors.aiBusy");
    expect(err(new Error("Your credit balance is too low"))).toBe("marketing.errors.aiBilling");
    expect(err(new Error("TED search failed: HTTP 503"))).toBe("marketing.errors.sourceUnavailable");
    expect(err(new Error("x".repeat(800)))).toHaveLength(500);
  });
});
