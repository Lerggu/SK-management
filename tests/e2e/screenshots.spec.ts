import { test } from "@playwright/test";
import { authFile } from "./helpers";

/** Captures the main V1 views for the release report (docs/screenshots). */
test.use({ storageState: authFile("ceo") });

const VIEWS: [string, string][] = [
  ["dashboard", "/c/sk-infra-demo/dashboard"],
  ["projects", "/c/sk-infra-demo/projects"],
  ["workforce", "/c/sk-infra-demo/workforce"],
  ["equipment", "/c/sk-infra-demo/equipment"],
  ["documents", "/c/sk-infra-demo/documents"],
  ["settings-roles", "/c/sk-infra-demo/settings/roles"],
  ["settings-audit", "/c/sk-infra-demo/settings/audit"],
];

test("capture main views", async ({ page }, testInfo) => {
  const dir = `docs/screenshots/${testInfo.project.name}`;
  for (const [name, path] of VIEWS) {
    await page.goto(path);
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  await page.goto("/c/sk-infra-demo/projects");
  await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
  await page.waitForURL(/projects\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/project-detail.png` });
  await page.goto("/c/sk-infra-demo/documents");
  await page.getByRole("link", { name: /pääkaavio/ }).click();
  await page.waitForURL(/documents\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/document-versions.png`, fullPage: true });
  await page.goto("/c/sk-infra-demo/workforce");
  await page.getByRole("link", { name: /Esimerkki Antti/ }).click();
  await page.waitForURL(/workforce\/[0-9a-f-]{36}$/);
  await page.screenshot({ path: `${dir}/employee-detail.png`, fullPage: true });
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.screenshot({ path: `${dir}/sign-in.png` });
});
