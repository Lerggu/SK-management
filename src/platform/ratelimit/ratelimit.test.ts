import { beforeEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "@/platform/errors";
import { checkRateLimit, resetRateLimits } from "./index";

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("blocks after the limit within the window and resets after it", () => {
    const rule = { name: "t", limit: 2, windowMs: 1000 };
    checkRateLimit(rule, "k", 0);
    checkRateLimit(rule, "k", 10);
    expect(() => checkRateLimit(rule, "k", 20)).toThrow(RateLimitedError);
    checkRateLimit(rule, "other", 20);
    expect(() => checkRateLimit(rule, "k", 1001)).not.toThrow();
  });
});
