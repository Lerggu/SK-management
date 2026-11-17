/**
 * Invitation e-mail: the CEO invites a subcontractor, the invitation e-mail
 * arrives (dev mailbox) with the sign-in page link and the address
 * prefilled; the subcontractor asks for a sign-in link from there.
 */
import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

test.describe("invitation e-mail", () => {
  test.use({ storageState: authFile("ceo") });

  test("invite a subcontractor, the e-mail leads to sign-in with the address prefilled", async ({ page, browser }, testInfo) => {
    const email = `${unique(testInfo, "urakoitsija").toLowerCase().replace(/[^a-z0-9-]/g, "-")}@example.test`;
    await page.goto("/c/sk-infra-demo/settings/members");
    await page.getByLabel("Sähköposti").first().fill(email);
    await page.getByLabel("Nimi").first().fill("Urho Urakoitsija");
    await page.getByRole("checkbox", { name: "Aliurakoitsija" }).first().check();
    await page.getByRole("button", { name: "Kutsu käyttäjä" }).click();
    await expect(page.getByText("Kutsu lähetetty sähköpostilla.")).toBeVisible();

    await page.goto("/dev/mailbox");
    const mail = page.locator(`[data-testid="dev-mail"][data-to="${email}"]`).first();
    await expect(mail).toContainText("kutsui sinut");
    const link = /https?:\/\/\S+\/sign-in\?email=\S+/.exec((await mail.textContent()) ?? "")![0];
    expect(link).not.toContain("token=");

    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const g = await guest.newPage();
    await g.goto(new URL(link).pathname + new URL(link).search);
    const form = g.getByTestId("email-link-form");
    await expect(form.getByPlaceholder("Sähköposti")).toHaveValue(email);
    await form.getByRole("button", { name: "Lähetä kirjautumislinkki" }).click();
    await expect(g.getByTestId("link-sent")).toBeVisible();
    await guest.close();

    await page.goto("/dev/mailbox");
    await expect(page.locator(`[data-testid="dev-mail"][data-to="${email}"]`).filter({ hasText: "sign-in/email?token=" })).toHaveCount(1);
  });
});
