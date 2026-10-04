import { expect, test } from "@playwright/test";
import { authFile, isMobile } from "./helpers";

test.use({ storageState: authFile("groupAdmin") });

test("Finnish by default; switch to English and back", async ({ page }, testInfo) => {
  await page.goto("/c/sk-infra-demo/dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "fi");
  const scope = isMobile(testInfo) ? page.getByRole("dialog") : page.locator("aside");
  if (isMobile(testInfo)) await page.getByTestId("mobile-more").click();
  await scope.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  if (isMobile(testInfo)) await page.getByTestId("mobile-more").click();
  const scope2 = isMobile(testInfo) ? page.getByRole("dialog") : page.locator("aside");
  await scope2.getByRole("button", { name: "Suomi" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fi");
});
