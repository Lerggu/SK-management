import { test as setup } from "@playwright/test";
import { USERS, authFile, devLogin } from "./helpers";

for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
  setup(`sign in as ${key}`, async ({ page }) => {
    await devLogin(page, USERS[key]);
    await page.context().storageState({ path: authFile(key) });
  });
}
