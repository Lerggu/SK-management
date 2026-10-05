import { expect, type Page, type TestInfo } from "@playwright/test";

export const USERS = {
  ceo: "ceo@skinfra.example.com",
  groupAdmin: "group.admin@example.com",
  client: "client@example.com",
  purentPm: "pm@purent.example.com",
  employee: "employee@skinfra.example.com",
  supervisor: "supervisor@skinfra.example.com",
  siteManager: "site.manager@skinfra.example.com",
  pm: "pm@skinfra.example.com",
  logistics: "logistics@skinfra.example.com",
  purentCeo: "ceo@purent.example.com",
  lifting: "lifting@skinfra.example.com",
  pd: "pd@skinfra.example.com",
  hse: "hse@skinfra.example.com",
  subcontractor: "subcontractor@example.com",
} as const;

export const authFile = (user: keyof typeof USERS) => `tests/e2e/.auth/${user}.json`;

export async function devLogin(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByTestId(`dev-login-${email}`).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

export function isMobile(testInfo: TestInfo) {
  return testInfo.project.name === "mobile";
}

export function unique(testInfo: TestInfo, prefix: string) {
  return `${prefix}-${testInfo.project.name.slice(0, 3).toUpperCase()}-${Date.now().toString(36).slice(-5)}`;
}

/** Navigates via the visible navigation (sidebar on desktop, bottom bar on phones). */
export async function navigate(page: Page, testInfo: TestInfo, label: string) {
  if (isMobile(testInfo)) {
    const nav = page.getByTestId("mobile-nav");
    const link = nav.getByRole("link", { name: label });
    if (await link.count()) await link.click();
    else {
      await page.getByTestId("mobile-more").click();
      await page.getByRole("dialog").getByRole("link", { name: label }).click();
    }
  } else {
    await page.locator("aside").getByRole("link", { name: label }).click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => d.accept());
}

/** Opens the logistics board for a site (sites are chosen with the GET picker). */
export async function openLogisticsBoard(page: Page, site = "NDC-001 · Data Hall A") {
  await page.goto("/c/sk-infra-demo/logistics");
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: site });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await expect(page).toHaveURL(/site=/);
}

/** Chooses a site with the GET site picker on the current page. */
export async function pickSite(page: Page, site = "NDC-001 · Data Hall A") {
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: site });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await expect(page).toHaveURL(/site=/);
}
