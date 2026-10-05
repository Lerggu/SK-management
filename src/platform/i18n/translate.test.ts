import { describe, expect, it } from "vitest";
import { translate } from "./translate";

describe("translate (server-side e-mails)", () => {
  it("fills placeholders in the user's language, Finnish by default", () => {
    expect(translate("en", "mail.seriousIncidentSubject", { project: "P-1 Demo", number: 3 })).toBe("SERIOUS INCIDENT – P-1 Demo #3");
    expect(translate(null, "mail.seriousIncidentSubject", { project: "P-1", number: 1 })).toBe("VAKAVA TAPATURMA – P-1 #1");
  });
  it("returns the key when missing", () => {
    expect(translate("fi", "mail.nope")).toBe("mail.nope");
  });
});
