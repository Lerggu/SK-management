import { expect, test } from "@playwright/test";
import { authFile, navigate, unique } from "./helpers";

test.use({ storageState: authFile("ceo") });

test("create a project and a site", async ({ page }, testInfo) => {
  const code = unique(testInfo, "P");
  await page.goto("/c/sk-infra-demo/dashboard");
  await navigate(page, testInfo, "Projektit");
  await page.getByRole("link", { name: "Uusi projekti" }).click();

  // Validation error keeps the typed values.
  await page.getByLabel("Projektin nimi").fill("E2E projekti");
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByText("Pakollinen tieto")).toBeVisible();
  await expect(page.getByLabel("Projektin nimi")).toHaveValue("E2E projekti");

  await page.getByLabel("Projektinumero").fill(code);
  await page.getByLabel("Asiakas").fill("Testiasiakas Oy");
  await page.getByLabel("Tila").selectOption("ACTIVE");
  await page.getByLabel("Alkaa").fill("2026-11-01");
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${code} · E2E projekti`);

  await page.getByRole("link", { name: "Lisää työmaa" }).click();
  await page.getByLabel("Työmaan nimi").fill("Halli B");
  await page.getByLabel("Paikkakunta").fill("Oulu");
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByTestId("site-list")).toContainText("Halli B");

  await page.goto("/c/sk-infra-demo/projects");
  await expect(page.getByRole("link", { name: new RegExp(code) })).toBeVisible();
});
