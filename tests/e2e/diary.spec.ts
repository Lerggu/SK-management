import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, isMobile } from "./helpers";

test.use({ storageState: authFile("supervisor") });

test("supervisor writes and signs today's site diary", async ({ page }, testInfo) => {
  acceptDialogs(page);
  // Each viewport uses its own site so both runs start from a draft.
  const site = isMobile(testInfo) ? "Logistics Yard" : "110 kV Substation";
  await page.goto("/c/sk-infra-demo/projects");
  await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
  await page.getByRole("button", { name: `Päiväkirja tänään: ${site}` }).click();
  await expect(page).toHaveURL(/\/diary\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(site);

  await page.getByLabel("Sää", { exact: true }).fill("Aurinkoista");
  await page.getByRole("button", { name: "Tallenna" }).click();
  await expect(page.getByText("Tallennettu")).toBeVisible();

  await page.getByLabel("Kuvaus").fill("E2E: kaapelinveto");
  await page.getByRole("button", { name: "Lisää merkintä" }).click();
  await expect(page.getByTestId("diary-entries")).toContainText("E2E: kaapelinveto");

  await page.getByLabel("Lisää kuva").setInputFiles({ name: "kuva.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
  await page.getByRole("button", { name: "Lataa kuva" }).click();
  await expect(page.getByText("kuva.png")).toBeVisible();

  await page.getByRole("button", { name: "Allekirjoita päiväkirja" }).click();
  await expect(page.getByTestId("diary-signed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allekirjoita päiväkirja" })).toHaveCount(0);
  await expect(page.getByLabel("Sää", { exact: true })).toHaveCount(0);
});
