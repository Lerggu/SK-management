/**
 * Marketing automation (ADR 0032), desktop and phone: the CEO switches the
 * agents on with themself as the reply recipient, runs the search (test AI
 * provider, TED offline), approves a drafted letter, the letter arrives in
 * the dev mailbox with Reply-To and an unsubscribe link, and the recipient
 * unsubscribes without signing in.
 */
import { expect, test } from "@playwright/test";
import { authFile, USERS } from "./helpers";

test.describe("marketing", () => {
  test.use({ storageState: authFile("ceo") });

  test("settings, search, approve and send, unsubscribe", async ({ page, browser }) => {
    await page.goto("/c/sk-infra-demo/marketing/settings");
    const form = page.getByTestId("marketing-settings");
    await form.getByRole("checkbox", { name: "Agentit käytössä (haku ajastetusti)" }).check();
    await form.getByRole("checkbox", { name: new RegExp(USERS.ceo) }).check();
    await form.getByLabel("Allekirjoituksen nimi").fill("SK Infra myynti");
    await form.getByRole("button", { name: "Tallenna" }).click();
    await expect(form.getByText("Tallennettu")).toBeVisible();

    await page.goto("/c/sk-infra-demo/marketing");
    await page.getByRole("button", { name: "Hae nyt" }).click();
    await expect(page.getByText("Haku käynnistyi.")).toBeVisible();

    // The search and drafting run in the background; the drafts appear for approval.
    await expect(async () => {
      await page.goto("/c/sk-infra-demo/marketing/approvals");
      await expect(page.getByTestId("letter-form").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    const letter = page.locator("section").filter({ has: page.getByTestId("letter-form") }).first();
    const to = (await letter.getByText(/@example\.test/).first().textContent())!.match(/<([^>]+)>/)![1];
    await letter.getByRole("button", { name: "Hyväksy ja lähetä" }).click();
    await expect(page.getByTestId("approval-notice")).toHaveText("Kirje lähetetty.");

    await page.goto("/dev/mailbox");
    const mail = page.locator(`[data-testid="dev-mail"][data-to="${to}"]`).first();
    await expect(mail).toContainText(`Reply-To: ${USERS.ceo}`);
    await expect(mail).toContainText("SK Infra myynti");
    const link = /https?:\/\/\S+\/unsubscribe\/[A-Za-z0-9_-]+/.exec((await mail.textContent()) ?? "")![0];

    // The recipient is not a user: no sign-in needed.
    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const g = await guest.newPage();
    await g.goto(new URL(link).pathname);
    await g.getByTestId("unsubscribe").getByRole("button", { name: "Peru yhteydenotot" }).click();
    await expect(g.getByText(/ei ota sinuun enää yhteyttä/)).toBeVisible();
    await guest.close();

    await page.goto("/c/sk-infra-demo/marketing/settings");
    await expect(page.getByTestId("suppressions")).toContainText(to);

    // The register shows the found project with its source.
    await page.goto("/c/sk-infra-demo/marketing");
    await page.getByRole("link", { name: /\[TEST\] Sample data centers project/ }).first().click();
    await expect(page.getByTestId("lead-sources")).toContainText("[TEST] Sample source");
    await expect(page.getByTestId("fit-score")).toContainText("80");
  });

  test("people without marketing access do not see it", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("siteManager") });
    const p = await ctx.newPage();
    await p.goto("/c/sk-infra-demo/marketing");
    await expect(p.getByRole("heading", { name: "Sivua ei löytynyt" })).toBeVisible();
    await ctx.close();
  });
});
