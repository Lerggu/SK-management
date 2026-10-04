import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevLoginEnabled, resetEnvCache } from "./env";

describe("dev login guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("is hard-disabled in production even if the flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("DEV_LOGIN_ENABLED", "true");
    resetEnvCache();
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("follows the flag outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("DEV_LOGIN_ENABLED", "true");
    resetEnvCache();
    expect(isDevLoginEnabled()).toBe(true);
    vi.stubEnv("DEV_LOGIN_ENABLED", "false");
    resetEnvCache();
    expect(isDevLoginEnabled()).toBe(false);
  });
});
