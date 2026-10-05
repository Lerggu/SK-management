import { expect, test } from "@playwright/test";
import { authFile } from "./helpers";

const PROJECTS = "/c/sk-infra-demo/projects";

test.describe("AI project controller", () => {
  test.use({ storageState: authFile("pm") });

  test("project manager runs a review, asks a question and decides a recommendation", async ({ page }) => {
    await page.goto(PROJECTS);
    await page.getByRole("link", { name: /NDC-001/ }).first().click();
    await page.getByRole("link", { name: "Tekoälyohjaaja" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tekoälyohjaaja");
    await expect(page.getByTestId("ai-notice")).toContainText("päätökset tekee aina ihminen");
    await expect(page.getByTestId("ai-notice")).toContainText("Testitila");
    await expect(page.getByTestId("ai-budget")).toContainText("käytetty tässä kuussa");
    // The seeded example run is listed with its fact/forecast/recommendation labels.
    await expect(page.getByTestId("ai-runs")).toContainText("Esimerkkikatsaus");
    await expect(page.getByTestId("ai-runs")).toContainText("AI-suositus");

    const runs = page.getByTestId("ai-runs").locator("[data-run]");
    const before = await runs.count();
    await page.getByRole("button", { name: "Tee projektikatsaus" }).click();
    await expect(runs).toHaveCount(before + 1);
    await expect(runs.first()).toContainText("Projektikatsaus");
    await expect(runs.first()).toContainText("Valmis");

    const ask = page.getByTestId("ai-ask-form");
    await ask.getByLabel("Kysymys projektista").fill("Mikä uhkaa katetta eniten?");
    await ask.getByRole("button", { name: "Kysy" }).click();
    await expect(runs).toHaveCount(before + 2);
    await expect(runs.first()).toContainText("Mikä uhkaa katetta eniten?");

    const recs = page.getByTestId("ai-recommendations").locator("[data-recommendation]");
    const open = await recs.count();
    expect(open).toBeGreaterThan(0);
    await recs.first().getByRole("button", { name: "Hylkää" }).click();
    await expect(recs).toHaveCount(open - 1);
    await expect(page.getByText(/Käsitellyt suositukset/)).toBeVisible();
  });
});

test.describe("AI project controller access", () => {
  test.use({ storageState: authFile("siteManager") });

  test("site manager has no AI controller", async ({ page }) => {
    await page.goto(PROJECTS);
    await page.getByRole("link", { name: /NDC-001/ }).first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tekoälyohjaaja" })).toHaveCount(0);
    const url = page.url();
    const res = await page.goto(`${url}/ai`);
    expect(res?.status()).toBe(404);
  });
});
