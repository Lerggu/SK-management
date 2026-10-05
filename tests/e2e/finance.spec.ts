import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

test.use({ storageState: authFile("pm") });

test("project manager sees budget vs actual and records a cost", async ({ page }, testInfo) => {
  await page.goto("/c/sk-infra-demo/projects");
  await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
  await page.getByRole("link", { name: "Talous" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projektin talous");
  const labor = page.getByTestId("budget-vs-actual").locator('[data-category="LABOR"]');
  await expect(labor).toContainText("180 000,00");
  await expect(labor).not.toContainText(/^Työ\s*180 000,00 €\s*0,00 €/);
  await expect(page.getByTestId("budget-versions").locator('[data-status="ACTIVE"]')).toBeVisible();

  const description = unique(testInfo, "Kaapelikengät");
  await page.getByLabel("Summa").fill("1 234,50");
  await page.getByLabel("Kuvaus").fill(description);
  await page.getByRole("button", { name: "Kirjaa kustannus" }).click();
  await expect(page.getByTestId("cost-list")).toContainText(description);
  await expect(page.getByTestId("cost-list")).toContainText("1 234,50");
});

test.describe("site manager", () => {
  test.use({ storageState: authFile("siteManager") });

  test("cannot open project finance", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/projects");
    await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
    await expect(page.getByRole("link", { name: "Talous" })).toHaveCount(0);
  });
});
