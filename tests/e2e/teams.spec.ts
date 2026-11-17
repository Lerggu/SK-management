/**
 * Teams (ADR 0029): create a team, add members, and place the whole team in
 * the rotation calendar at once (tap the team, then a day).
 */
import { expect, test } from "@playwright/test";
import { authFile, isMobile, unique } from "./helpers";

test.use({ storageState: authFile("pm") });

test("create a team, add members and plan the team in the rotation calendar", async ({ page }, testInfo) => {
  const name = unique(testInfo, "Tiimi");
  await page.goto("/c/sk-infra-demo/workforce/teams");
  const form = page.getByTestId("team-form");
  await form.getByLabel("Tiimin nimi").fill(name);
  await form.getByRole("button", { name: "Luo tiimi" }).click();
  const card = page.locator(`[data-team="${name}"]`);
  await expect(card).toBeVisible();
  await card.getByText("Lisää jäseniä").first().click();
  const boxes = card.getByTestId("team-add").getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await card.getByTestId("team-add").getByRole("button", { name: "Lisää jäseniä" }).click();
  await expect(card.getByTestId("team-members").locator("[data-member]")).toHaveCount(2);

  const date = isMobile(testInfo) ? "2027-04-12" : "2027-04-05";
  await page.goto(`/c/sk-infra-demo/workforce/rotation?date=${date}&weeks=1`);
  await page.locator(`[data-panel-team="${name}"]`).click();
  const row = page.locator("[data-row]").first();
  const rowName = (await row.getAttribute("data-row"))!;
  await page.locator(`[data-cell="${rowName}|${date}"]`).click();
  const dialog = page.getByTestId("rotation-dialog");
  await expect(dialog.getByTestId("dialog-team")).toContainText("(2)");
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.locator(`[data-cell="${rowName}|${date}"]`).locator("[data-person]")).toHaveCount(2);
});
