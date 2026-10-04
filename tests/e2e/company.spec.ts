import { expect, test } from "@playwright/test";
import { authFile, isMobile } from "./helpers";

test.describe("company selection and switching", () => {
  test.use({ storageState: authFile("groupAdmin") });

  test("picks a company, then switches to the other one", async ({ page }, testInfo) => {
    await page.goto("/c");
    await expect(page.getByRole("heading", { name: "Valitse yritys" })).toBeVisible();
    await page.getByTestId("company-purent-demo").click();
    await expect(page).toHaveURL(/\/c\/purent-demo\/dashboard$/);
    const switcher = page.getByTestId("company-switcher").filter({ visible: true });
    await expect(switcher).toContainText("Purent Demo");

    // Purent data only.
    await page.goto("/c/purent-demo/projects");
    await expect(page.getByText("Purent Harbor Warehouse Demo")).toBeVisible();
    await expect(page.getByText("Nordic Data Center Demo")).toHaveCount(0);

    if (isMobile(testInfo)) {
      await page.getByTestId("mobile-more").click();
      await page.getByRole("dialog").getByRole("link", { name: "SK Infra Demo" }).click();
    } else {
      await switcher.click();
      await page.getByRole("menuitem", { name: "SK Infra Demo" }).click();
    }
    await expect(page).toHaveURL(/\/c\/sk-infra-demo\/dashboard$/);
    await expect(page.getByTestId("company-switcher").filter({ visible: true })).toContainText("SK Infra Demo");
  });

  test("an authorized org admin can create a company", async ({ page }) => {
    await page.goto("/c");
    const slug = `demo-${Date.now().toString(36)}`;
    await page.getByLabel("Yrityksen nimi").fill(`Testi ${slug}`);
    await page.getByLabel("Osoitetunnus").fill(slug);
    await page.getByRole("button", { name: "Luo" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${slug}/dashboard$`));
  });
});

test.describe("tenant isolation in the browser", () => {
  test.use({ storageState: authFile("purentPm") });

  test("a Purent user gets 404 for SK Infra URLs", async ({ page }) => {
    const res = await page.goto("/c/sk-infra-demo/projects");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Sivua ei löytynyt" })).toBeVisible();
  });
});
