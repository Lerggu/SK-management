import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "@/platform/errors";
import { currency, decimalString, optionalDate, optionalText, parseInput, slug, text } from "./validation";

describe("validation helpers", () => {
  it("accepts Finnish decimal comma and spaces for money", () => {
    expect(parseInput(decimalString(), "1 234,50")).toBe("1234.50");
    expect(parseInput(decimalString(), "42")).toBe("42");
    expect(() => parseInput(decimalString(), "12.345")).toThrow(ValidationError);
    expect(() => parseInput(decimalString(), "-1")).toThrow(ValidationError);
  });

  it("parses date-only values at UTC midnight and empty as null", () => {
    expect(parseInput(optionalDate(), "2026-10-04")?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(parseInput(optionalDate(), "")).toBeNull();
    expect(() => parseInput(optionalDate(), "4.10.2026")).toThrow(ValidationError);
  });

  it("returns i18n message keys for field errors", () => {
    const schema = z.object({ name: text(5), code: optionalText(3), slug: slug(), currency: currency() });
    try {
      parseInput(schema, { name: "", code: "abcd", slug: "Bad Slug!", currency: "eu" });
      expect.unreachable();
    } catch (e) {
      const err = e as ValidationError;
      expect(err.fieldErrors.name).toEqual(["validation.required"]);
      expect(err.fieldErrors.code).toEqual(["validation.tooLong"]);
      expect(err.fieldErrors.slug).toEqual(["validation.slug"]);
      expect(err.fieldErrors.currency).toEqual(["validation.currency"]);
    }
  });

  it("defaults currency to EUR", () => {
    expect(parseInput(currency(), "")).toBe("EUR");
    expect(parseInput(currency(), "sek")).toBe("SEK");
  });
});

describe("flag", () => {
  it("parses checkbox and query flags strictly", async () => {
    const { flag } = await import("./validation");
    expect(parseInput(flag(), "on")).toBe(true);
    expect(parseInput(flag(), "true")).toBe(true);
    expect(parseInput(flag(), "false")).toBe(false);
    expect(parseInput(flag(), undefined)).toBe(false);
  });
});
