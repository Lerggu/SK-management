import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, navigate, unique } from "./helpers";

test.use({ storageState: authFile("ceo") });

test("employee CRUD with rates", async ({ page }, testInfo) => {
  acceptDialogs(page);
  const number = unique(testInfo, "E");
  await page.goto("/c/sk-infra-demo/dashboard");
  await navigate(page, testInfo, "Henkilöstö");
  await page.getByRole("link", { name: "Uusi henkilö" }).click();
  await page.getByLabel("Etunimi").fill("Eero");
  await page.getByLabel("Sukunimi").fill("Esimerkki");
  await page.getByLabel("Henkilönumero").fill(number);
  await page.getByLabel("Ammatti").fill("Sähköasentaja");
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eero Esimerkki");

  // Employee number and personal identity code are separate fields (ADR 0028).
  await expect(page.getByTestId("employee-number")).toHaveText(number);
  const pid = page.getByTestId("personal-id");
  await expect(pid).toContainText("Ei tallennettu.");
  await pid.getByText("Lisää henkilötunnus").click();
  await pid.getByLabel("Henkilötunnus").fill("131052-308x");
  await pid.getByRole("button", { name: "Tallenna" }).click();
  await expect(pid.getByText("Virheellinen henkilötunnus", { exact: false })).toBeVisible();
  // Fictional codes with valid check characters; one per viewport (unique per company).
  await pid.getByLabel("Henkilötunnus").fill(testInfo.project.name.includes("mobile") ? "010101A123N" : "131052-308T");
  await pid.getByRole("button", { name: "Tallenna" }).click();
  await expect(pid.getByTestId("pid-value")).toHaveText(/^••••••[-A]•••[NT]$/);
  await pid.getByRole("button", { name: "Näytä" }).click();
  await expect(pid.getByTestId("pid-value")).toHaveText(/^(131052-308T|010101A123N)$/);
  await pid.getByRole("button", { name: "Piilota" }).click();
  await expect(pid.getByTestId("pid-value")).toContainText("•");

  // Update
  await page.getByRole("link", { name: "Muokkaa" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Muokkaa henkilöä");
  await page.getByLabel("Puhelin", { exact: true }).fill("+358 40 123 4567");
  await page.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.getByText("+358 40 123 4567")).toBeVisible();

  // Rate (Finnish decimal comma)
  await page.getByLabel("Summa").fill("44,50");
  await page.getByRole("button", { name: "Lisää hinta" }).click();
  await expect(page.getByTestId("current-cost")).toContainText("44,50");

  // Archive
  await page.getByRole("button", { name: "Arkistoi" }).first().click();
  await expect(page).toHaveURL(/\/workforce$/);
  await expect(page.getByText(number)).toHaveCount(0);
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("cannot see workforce, rates or equipment", async ({ page, request }) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await expect(page.getByRole("link", { name: "Henkilöstö" })).toHaveCount(0);
    await page.goto("/c/sk-infra-demo/workforce");
    await expect(page).toHaveURL(/\/portal/);
    const api = await page.request.get("/api/v1/companies/sk-infra-demo/employees");
    expect(api.status()).toBe(403);
    void request;
  });
});
