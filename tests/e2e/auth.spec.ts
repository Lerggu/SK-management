import { expect, test } from "@playwright/test";
import { devLogin, isMobile } from "./helpers";

test("unauthenticated users are sent to sign-in", async ({ page }) => {
  await page.goto("/c/sk-infra-demo/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
});

test("sign in, see the dashboard and navigation, sign out", async ({ page }, testInfo) => {
  await devLogin(page, "pd@skinfra.example.com");
  await expect(page).toHaveURL(/\/c\/sk-infra-demo\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tervetuloa");
  if (isMobile(testInfo)) {
    await expect(page.getByTestId("mobile-nav")).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
    // Touch targets in the bottom bar are at least 44 px high.
    const box = await page.getByTestId("mobile-nav").getByRole("link").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("mobile-more").click();
    await page.getByRole("dialog").getByRole("button", { name: "Kirjaudu ulos" }).click();
  } else {
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByTestId("mobile-nav")).toBeHidden();
    await page.locator("aside").getByRole("button", { name: "Kirjaudu ulos" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/c/sk-infra-demo/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("uninvited e-mail cannot sign in", async ({ page }) => {
  await page.goto("/sign-in?error=not_invited");
  await expect(page.getByRole("alert")).toContainText("kutsuttu");
});
