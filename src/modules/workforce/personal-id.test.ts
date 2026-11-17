import { describe, expect, it } from "vitest";
import { maskPersonalId, normalizePersonalId } from "./personal-id";

describe("Finnish personal identity code", () => {
  it("accepts valid codes of each century, normalizing case and spaces", () => {
    // Check characters computed with the official mod-31 rule (fictional codes).
    expect(normalizePersonalId("131052-308T")).toBe("131052-308T");
    expect(normalizePersonalId(" 010101a123n ")).toBe("010101A123N");
    expect(normalizePersonalId("010101Y123N")).toBe("010101Y123N");
    expect(normalizePersonalId("010150+123A")).toBe("010150+123A");
  });

  it("rejects a wrong check character, an impossible date, the wrong shape and individual numbers 000–001", () => {
    expect(normalizePersonalId("131052-308U")).toBeNull();
    expect(normalizePersonalId("310252-308T")).toBeNull();
    expect(normalizePersonalId("131052308T")).toBeNull();
    expect(normalizePersonalId("131052Z308T")).toBeNull();
    expect(normalizePersonalId("010101-001J")).toBeNull();
  });

  it("masks all but the century sign and the check character", () => {
    expect(maskPersonalId("131052-308T")).toBe("••••••-•••T");
  });
});
