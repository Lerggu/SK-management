import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const e2eDb = (() => {
  const u = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://sk:sk_dev_password@localhost:5432/x");
  u.pathname = "/sk_management_e2e";
  return u.toString();
})();
process.env.E2E_DATABASE_URL = e2eDb;

// Use a pre-installed Chromium when the bundled one is unavailable (CI images, sandboxes).
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "fi-FI", timezoneId: "Europe/Helsinki", launchOptions },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 }, launchOptions }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions }, dependencies: ["setup"] },
  ],
  webServer: {
    // Dev server: the dev login is hard-disabled under NODE_ENV=production.
    command: `pnpm exec tsx tests/e2e/prepare-db.ts && pnpm exec next dev --port ${PORT}`,
    url: `${baseURL}/sign-in`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: e2eDb, DEV_LOGIN_ENABLED: "true", RATE_LIMIT_SIGN_IN: "200", AUTH_URL: baseURL, NEXT_TELEMETRY_DISABLED: "1" },
  },
});
