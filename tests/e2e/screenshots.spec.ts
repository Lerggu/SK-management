import { test } from "@playwright/test";
import { authFile } from "./helpers";

/** Captures the main views for the release reports (docs/screenshots). */
test.use({ storageState: authFile("ceo") });

const VIEWS: [string, string][] = [
  ["dashboard", "/c/sk-infra-demo/dashboard"],
  ["projects", "/c/sk-infra-demo/projects"],
  ["workforce", "/c/sk-infra-demo/workforce"],
  ["equipment", "/c/sk-infra-demo/equipment"],
  ["documents", "/c/sk-infra-demo/documents"],
  ["settings-roles", "/c/sk-infra-demo/settings/roles"],
  ["settings-audit", "/c/sk-infra-demo/settings/audit"],
  ["time", "/c/sk-infra-demo/time"],
  ["time-approvals", "/c/sk-infra-demo/time/approvals"],
];

test("capture main views", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const dir = `docs/screenshots/${testInfo.project.name}`;
  for (const [name, path] of VIEWS) {
    await page.goto(path);
    await page.screenshot({ path: `${dir}/${name}.png`, caret: "initial" });
  }
  await page.goto("/c/sk-infra-demo/projects");
  await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
  await page.waitForURL(/projects\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/project-detail.png`, caret: "initial" });
  await page.getByRole("link", { name: "Talous" }).click();
  await page.waitForURL(/finance$/);
  await page.screenshot({ path: `${dir}/project-finance.png`, fullPage: true, caret: "initial" });
  await page.goBack();
  await page.getByRole("link", { name: /\d{4} · Data Hall A/ }).first().click();
  await page.waitForURL(/diary\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/site-diary.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/takt");
  await page.screenshot({ path: `${dir}/takt-plans.png`, caret: "initial" });
  await page.getByRole("link", { name: /Data Hall A – sähkötahti/ }).click();
  await page.waitForURL(/takt\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/takt-board.png`, fullPage: true, caret: "initial" });
  const boardUrl = page.url();
  await page.getByTestId("takt-board").locator('[data-status="BLOCKED"]').first().click();
  await page.waitForURL(/activities\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/takt-activity.png`, fullPage: true, caret: "initial" });
  await page.goto(boardUrl);
  await page.getByRole("link", { name: "Vertaa baselineen" }).click();
  await page.waitForURL(/compare/);
  await page.screenshot({ path: `${dir}/takt-compare.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/takt/lookahead?weeks=6");
  await page.screenshot({ path: `${dir}/takt-lookahead.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/settings/calendar");
  await page.screenshot({ path: `${dir}/settings-calendar.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/logistics");
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: "NDC-001 · Data Hall A" });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await page.waitForURL(/site=/);
  await page.screenshot({ path: `${dir}/logistics-board.png`, fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "Porttinäkymä" }).click();
  await page.waitForURL(/gate/);
  await page.screenshot({ path: `${dir}/logistics-gate.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/logistics/bookings");
  await page.screenshot({ path: `${dir}/logistics-bookings.png`, fullPage: true, caret: "initial" });
  await page.goBack();
  await page.goto("/c/sk-infra-demo/logistics");
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: "NDC-001 · Data Hall A" });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await page.getByTestId("request-list").getByRole("link").first().click();
  await page.waitForURL(/requests\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/logistics-request.png`, fullPage: true, caret: "initial" });
  // V5
  await page.goto("/c/sk-infra-demo/lifting");
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: "NDC-001 · Data Hall A" });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await page.waitForURL(/site=/);
  await page.screenshot({ path: `${dir}/lifting-list.png`, fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: /Muuntajan nosto/ }).click();
  await page.waitForURL(/lifting\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/lifting-plan-submitted.png`, fullPage: true, caret: "initial" });
  await page.goBack();
  await page.getByRole("link", { name: /Kaapelihyllynippujen nosto/ }).click();
  await page.waitForURL(/lifting\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/lifting-plan-approved.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/lifting/accessories");
  await page.screenshot({ path: `${dir}/lifting-accessories.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/materials");
  await page.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: "NDC-001 · Data Hall A" });
  await page.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await page.waitForURL(/site=/);
  await page.screenshot({ path: `${dir}/materials.png`, fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: /KK-0001/ }).click();
  await page.waitForURL(/drums\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/materials-drum.png`, fullPage: true, caret: "initial" });
  await page.goBack();
  await page.getByRole("link", { name: /ME-0001/ }).click();
  await page.waitForURL(/batches\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/materials-batch.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/scan");
  await page.screenshot({ path: `${dir}/scan.png`, fullPage: true, caret: "initial" });
  // V6
  await page.goto("/c/sk-infra-demo/sales");
  await page.screenshot({ path: `${dir}/sales.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/sales/quotes");
  await page.screenshot({ path: `${dir}/sales-quotes.png`, fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: /Data Hall B sähköasennukset/ }).click();
  await page.waitForURL(/quotes\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/sales-quote.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/projects");
  await page.getByRole("link", { name: /NDC-001/ }).first().click();
  await page.getByRole("link", { name: "Sopimus ja ennuste" }).click();
  await page.waitForURL(/commercial$/);
  await page.screenshot({ path: `${dir}/project-commercial.png`, fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: /Väliaikainen työmaavalaistus/ }).click();
  await page.waitForURL(/variations\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/variation.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/billing");
  await page.screenshot({ path: `${dir}/billing.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/documents");
  await page.getByRole("link", { name: /pääkaavio/ }).click();
  await page.waitForURL(/documents\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/document-versions.png`, fullPage: true, caret: "initial" });
  await page.goto("/c/sk-infra-demo/workforce");
  await page.getByRole("link", { name: /Esimerkki Antti/ }).click();
  await page.waitForURL(/workforce\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/employee-detail.png`, fullPage: true, caret: "initial" });
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.screenshot({ path: `${dir}/sign-in.png`, caret: "initial" });
});

/** V7 views: HSE (as HSE), the client portal and the subcontractor portal. */
test("capture V7 views", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const dir = `docs/screenshots/${testInfo.project.name}`;
  const as = async (user: Parameters<typeof authFile>[0]) => (await browser.newContext({ storageState: authFile(user), ...testInfo.project.use })).newPage();
  const hse = await as("hse");
  await hse.goto("/c/sk-infra-demo/hse");
  await hse.screenshot({ path: `${dir}/hse.png`, fullPage: true, caret: "initial" });
  await hse.getByTestId("hse-urgent").getByRole("link").first().click();
  await hse.waitForURL(/incidents\/[0-9a-f-]{36}$/);
  await hse.screenshot({ path: `${dir}/hse-incident.png`, fullPage: true, caret: "initial" });
  await hse.goto("/c/sk-infra-demo/hse/report?kind=SAFETY_OBSERVATION");
  await hse.screenshot({ path: `${dir}/hse-report.png`, fullPage: true, caret: "initial" });
  const client = await as("client");
  await client.goto("/c/sk-infra-demo/portal");
  await client.screenshot({ path: `${dir}/portal-client.png`, fullPage: true, caret: "initial" });
  const pending = client.getByRole("link", { name: /UPS-tilan lisäpistorasiat/ });
  if (await pending.count()) {
    await pending.first().click();
    await client.waitForURL(/approvals\/[0-9a-f-]{36}$/);
    await client.screenshot({ path: `${dir}/portal-approval.png`, fullPage: true, caret: "initial" });
  }
  const sub = await as("subcontractor");
  await sub.goto("/c/sk-infra-demo/portal");
  await sub.screenshot({ path: `${dir}/portal-subcontractor.png`, fullPage: true, caret: "initial" });
});
