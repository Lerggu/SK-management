import { afterEach, describe, expect, it } from "vitest";
import { decryptField, encryptField, fieldLookupHash } from "./field";

const original = process.env.SK_FIELD_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.SK_FIELD_KEY;
  else process.env.SK_FIELD_KEY = original;
});

describe("field encryption", () => {
  it("round-trips, never stores the clear value, and uses a fresh IV each time", () => {
    const a = encryptField("131052-308T");
    const b = encryptField("131052-308T");
    expect(a).not.toContain("131052");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("131052-308T");
  });

  it("detects tampering", () => {
    const parts = encryptField("131052-308T").split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 1;
    parts[3] = data.toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("depends on the key: another key cannot decrypt and gives another lookup hash", () => {
    process.env.SK_FIELD_KEY = Buffer.alloc(32, 1).toString("base64");
    const enc = encryptField("x");
    const h1 = fieldLookupHash("x");
    process.env.SK_FIELD_KEY = Buffer.alloc(32, 2).toString("base64");
    expect(() => decryptField(enc)).toThrow();
    expect(fieldLookupHash("x")).not.toBe(h1);
    expect(fieldLookupHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a key of the wrong length", () => {
    process.env.SK_FIELD_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptField("x")).toThrow(/32 bytes/);
  });
});
