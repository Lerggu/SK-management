import { test } from "@playwright/test";
import { authFile } from "./helpers";

/**
 * Sales screenshots of a fictional steel mill site (branch demo/steel-screenshots
 * only; the seed on this branch renames the demo project). Not part of main.
 */
const out = (name: string, project: string) => `docs/screenshots-steel/${project}-${name}.png`;

test("steel mill demo views", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const p = testInfo.project.name;
  const as = async (user: Parameters<typeof authFile>[0]) => (await browser.newContext({ storageState: authFile(user), ...testInfo.project.use })).newPage();

  const hse = await as("hse");
  await hse.goto("/c/sk-infra-demo/hse/report?kind=SAFETY_OBSERVATION");
  await hse.screenshot({ path: out("hse-report", p), fullPage: true, caret: "initial" });

  const log = await as("logistics");
  await log.goto("/c/sk-infra-demo/logistics/map");
  await log.getByTestId("site-map").locator("img").evaluate((img: HTMLImageElement) => img.decode());
  await log.waitForTimeout(600);
  await log.screenshot({ path: out("site-map", p), fullPage: true, caret: "initial" });
  if (p === "mobile") return;

  await log.goto("/c/sk-infra-demo/logistics");
  await log.getByTestId("site-day-picker").getByLabel("Työmaa").selectOption({ label: "NSM-001 · Sulatto (EAF)" });
  await log.getByTestId("site-day-picker").getByRole("button", { name: "Näytä" }).click();
  await log.waitForURL(/site=/);
  await log.screenshot({ path: out("logistics-board", p), fullPage: true, caret: "initial" });
  await log.getByTestId("request-list").getByRole("link", { name: /Nosturiradan palkkien nosto/ }).first().click();
  await log.waitForURL(/requests\/[0-9a-f-]{36}$/);
  await log.screenshot({ path: out("lift-request", p), fullPage: true, caret: "initial" });

  const ceo = await as("ceo");
  await ceo.goto("/c/sk-infra-demo/takt");
  await ceo.getByRole("link", { name: /Sulatto – asennustahti/ }).click();
  await ceo.waitForURL(/takt\/[0-9a-f-]{36}$/);
  await ceo.screenshot({ path: out("takt-board", p), fullPage: true, caret: "initial" });
});
