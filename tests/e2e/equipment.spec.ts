import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, navigate, unique } from "./helpers";

test.use({ storageState: authFile("ceo") });

test("equipment CRUD", async ({ page }, testInfo) => {
  acceptDialogs(page);
  const asset = unique(testInfo, "EQ");
  await page.goto("/c/sk-infra-demo/dashboard");
  await navigate(page, testInfo, "Kalusto");
  await page.getByRole("link", { name: "Uusi kalustoyksikkö" }).click();
  await page.getByLabel(/^Nimi/).fill("Kurottaja E2E");
  await page.getByLabel("Kalustonumero").fill(asset);
  await page.getByLabel("Kalustotyyppi").selectOption({ label: "Kurottaja (Kurottaja)" });
  await page.getByLabel("Sijainti").selectOption({ label: "NDC-001 › Data Hall A" });
  await page.getByLabel("Käyttötunnit").fill("1200,5");
  await page.getByLabel("Seuraava tarkastus").fill("2027-03-01");
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${asset} · Kurottaja E2E`);
  await expect(page.getByText("NDC-001 · Nordic Data Center Demo › Data Hall A")).toBeVisible();

  await page.getByRole("link", { name: "Muokkaa" }).click();
  await page.getByLabel("Tila").selectOption("MAINTENANCE");
  await page.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.locator('[data-status="MAINTENANCE"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Arkistoi" }).first().click();
  await expect(page).toHaveURL(/\/equipment$/);
  await expect(page.getByText(asset)).toHaveCount(0);
});
