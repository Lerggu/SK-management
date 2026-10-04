import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, isMobile, navigate } from "./helpers";

test.describe("hours: log → submit → approve", () => {
  test("employee logs hours with a quick-pick button and submits the week", async ({ browser }, testInfo) => {
    const page = await browser.newPage({ storageState: authFile("employee"), ...(isMobile(testInfo) ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {}) });
    await page.goto("/c/sk-infra-demo/dashboard");
    await expect(page.getByTestId("today")).toBeVisible();
    await navigate(page, testInfo, "Tunnit");
    await page.getByRole("button", { name: "8 h" }).click();
    await expect(page.getByLabel("Tunnit", { exact: true })).toHaveValue("8");
    await page.getByLabel("Muistiinpano").fill(`E2E ${testInfo.project.name}`);
    await page.getByRole("button", { name: "Kirjaa tunnit" }).click();
    await expect(page.getByTestId("week-entries")).toContainText(`E2E ${testInfo.project.name}`);
    await page.getByRole("button", { name: "Lähetä viikko hyväksyttäväksi" }).click();
    await expect(page.getByRole("button", { name: "Lähetä viikko hyväksyttäväksi" })).toHaveCount(0);
    await expect(page.locator('[data-status="SUBMITTED"]').first()).toBeVisible();
    await page.close();
  });

  test("site manager approves submitted hours", async ({ browser }, testInfo) => {
    const page = await browser.newPage({ storageState: authFile("siteManager"), ...(isMobile(testInfo) ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {}) });
    await page.goto("/c/sk-infra-demo/time/approvals");
    await expect(page.getByTestId("approval-group").first()).toBeVisible();
    await page.getByRole("button", { name: "Hyväksy valitut" }).click();
    await expect(page.getByText("Ei hyväksyttäviä tunteja.")).toBeVisible();
    await page.close();
  });
});

test.describe("payroll export", () => {
  test.use({ storageState: authFile("ceo") });

  test("CEO exports approved hours as CSV", async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), "export runs once per database (desktop project)");
    acceptDialogs(page);
    await page.goto("/c/sk-infra-demo/time/export");
    await page.getByLabel("Alkaen").fill("2020-01-01");
    await page.getByRole("button", { name: "Vie ja lataa CSV" }).click();
    const link = page.getByTestId("export-download");
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const body = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(body).toString("utf8");
    expect(text).toContain("employee_number;last_name;first_name;work_date;project");
    expect(text).toContain("NDC-001");
  });
});
