/**
 * Production control, phase 1 (ADR 0026): one menu item for takt and
 * logistics, task types with resource needs, and staffing a task from
 * rule-based candidates. Desktop and phone viewports.
 */
import { expect, test } from "@playwright/test";
import { authFile, navigate, unique } from "./helpers";

test.describe("logistics coordinator", () => {
  test.use({ storageState: authFile("logistics") });

  test("takt and logistics are under 'Tuotannonohjaus'", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await navigate(page, testInfo, "Tuotannonohjaus");
    const tabs = page.getByRole("navigation", { name: "Tuotannonohjaus" });
    await expect(tabs.getByRole("link", { name: "Tahtiaikataulu" })).toBeVisible();
    await tabs.getByRole("link", { name: "Logistiikka" }).click();
    await expect(page).toHaveURL(/\/logistics/);
    await tabs.getByRole("link", { name: "Tehtävätyypit" }).click();
    await expect(page.getByTestId("task-type-Nosto")).toContainText("Taakankiinnittäjä");
  });

  test("a task with a task type shows its resource needs; a candidate is booked", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "Purku");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Kuorman purku" });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const need = page.getByTestId("staffing-needs").locator('[data-need="Purkaja"]');
    await expect(need).toHaveAttribute("data-missing", "2");
    await need.getByTestId("candidates").getByRole("button", { name: "Varaa" }).first().click();
    await expect(page.getByTestId("staffing-needs").locator('[data-need="Purkaja"]')).toHaveAttribute("data-missing", "1");
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-readiness", "MISSING");
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("has no production control", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/portal");
    await expect(page.getByRole("link", { name: "Tuotannonohjaus" })).toHaveCount(0);
  });
});
