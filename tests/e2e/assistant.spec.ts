/**
 * Assistant (ADR 0031) with the deterministic test provider: type a request,
 * see the proposal card, confirm it, and the project exists.
 */
import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

test.use({ storageState: authFile("ceo") });

test("type a request, confirm the proposal, the project is created", async ({ page }, testInfo) => {
  // Letters only: the deterministic test provider recognises "uusi projekti <Nimi>".
  const name = `Testi${unique(testInfo, "").replace(/[^A-Za-z]/g, "").slice(-6)}${testInfo.project.name === "mobile" ? "Mob" : "Dsk"}`;
  await page.goto("/c/sk-infra-demo/dashboard");
  await page.getByTestId("assistant-button").click();
  await expect(page).toHaveURL(/\/assistant/);
  await page.getByTestId("assistant-input").fill(`Hei, aloitetaanpa uusi projekti ${name}`);
  await page.getByRole("button", { name: "Lähetä" }).click();
  const card = page.getByTestId("assistant-actions").locator('[data-action="create_project"]').last();
  await expect(card).toHaveAttribute("data-status", "PROPOSED");
  await expect(card).toContainText(`Uusi projekti ”${name}”`);
  await card.getByRole("button", { name: "Vahvista" }).click();
  await expect(card).toHaveAttribute("data-status", "CONFIRMED");
  await page.goto("/c/sk-infra-demo/projects");
  await expect(page.getByText(name).first()).toBeVisible();
});
