import { expect, test } from "@playwright/test";
import { authFile, navigate, unique } from "./helpers";

test.use({ storageState: authFile("ceo") });

test("document with two versions: CURRENT vs SUPERSEDED, approval, download", async ({ page }, testInfo) => {
  const title = unique(testInfo, "Piirustus");
  await page.goto("/c/sk-infra-demo/dashboard");
  await navigate(page, testInfo, "Dokumentit");
  await page.getByRole("link", { name: "Uusi dokumentti" }).click();
  await page.getByLabel("Otsikko").fill(title);
  await page.getByLabel("Luokka").selectOption("DRAWING");
  await page.getByLabel("Näkyvyys").selectOption({ label: "NDC-001 · Nordic Data Center Demo" });
  await page.getByLabel("Revisio").fill("A");
  await page.getByLabel("Tiedosto").setInputFiles({ name: "piirustus-a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 revision A") });
  await page.getByRole("button", { name: "Luo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByTestId("current-version")).toContainText("Versio 1");

  // Second version
  await page.getByLabel("Revisio").fill("B");
  await page.getByLabel("Muutoksen kuvaus").fill("Kaapelireitti muutettu");
  await page.getByLabel("Tiedosto").setInputFiles({ name: "piirustus-b.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 revision B") });
  await page.getByRole("button", { name: "Lataa uusi versio" }).click();
  await expect(page.getByTestId("current-version")).toContainText("Versio 2");

  const versions = page.getByTestId("version-list").locator("li");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toHaveAttribute("data-status", "CURRENT");
  await expect(versions.nth(0)).toContainText("VOIMASSA");
  await expect(versions.nth(1)).toHaveAttribute("data-status", "SUPERSEDED");
  await expect(versions.nth(1)).toContainText("KORVATTU");

  // Approve current version
  await page.getByTestId("current-version").locator("..").getByRole("button", { name: "Hyväksy", exact: true }).click();
  await expect(page.getByTestId("current-version")).toContainText("Hyväksytty");

  // Download the superseded version (content preserved)
  const [download] = await Promise.all([page.waitForEvent("download"), versions.nth(1).getByRole("link", { name: /Lataa/ }).click()]);
  expect(download.suggestedFilename()).toBe("piirustus-a.pdf");
});
