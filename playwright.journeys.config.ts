import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Role journeys: soft-step usability runs (tests/journeys), never part of CI gating. */
export default defineConfig({
  ...base,
  testDir: "tests",
  testMatch: [/journeys\/.*\.journey\.ts/, /e2e\/auth\.setup\.ts/],
  timeout: 600_000,
  retries: 0,
  projects: (base.projects ?? []).map((p) => (p.name === "setup" ? { ...p, testMatch: /e2e\/auth\.setup\.ts/ } : { ...p, testMatch: /journeys\/.*\.journey\.ts/ })),
});
