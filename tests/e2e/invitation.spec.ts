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

    // The pending invitation can be resent straight from its row.
    const row = page.locator("li").filter({ hasText: email });
    await row.getByTestId("resend-invite").getByRole("button", { name: "Lähetä kutsu uudelleen" }).click();
    await expect(row.getByText("Kutsu lähetetty sähköpostilla.")).toBeVisible();

    await page.goto("/dev/mailbox");
    await expect(page.locator(`[data-testid="dev-mail"][data-to="${email}"]`).filter({ hasText: "kutsui sinut" })).toHaveCount(2);
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
    const linkMail = page.locator(`[data-testid="dev-mail"][data-to="${email}"]`).filter({ hasText: "sign-in/email?token=" });
    await expect(linkMail).toHaveCount(1);
    const signInLink = /https?:\/\/\S+\/sign-in\/email\?token=[A-Za-z0-9_-]+/.exec((await linkMail.textContent()) ?? "")![0];

    // First sign-in: the registration form comes first (ADR 0030).
    const guest2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const g2 = await guest2.newPage();
    await g2.goto(new URL(signInLink).pathname + new URL(signInLink).search);
    await g2.getByTestId("confirm-sign-in").click();
    const reg = g2.getByTestId("registration-form");
    await expect(reg).toBeVisible();
    await expect(reg.getByRole("textbox", { name: "Nimi", exact: true })).toHaveValue("Urho Urakoitsija");
    await reg.getByLabel("Puhelin").fill("+358 40 555 0101");
    await reg.getByRole("button", { name: "Tallenna ja jatka" }).click();
    await expect(reg.getByText("Pakollinen tieto").first()).toBeVisible(); // organisation and privacy acceptance
    await reg.getByLabel("Yritys, jota edustat").fill("Urakointi Testi Oy");
    await reg.getByRole("checkbox").check();
    await reg.getByRole("button", { name: "Tallenna ja jatka" }).click();
    await expect(g2).toHaveURL(/\/c\/sk-infra-demo\/portal/);
    await guest2.close();

    // The members list shows the registered external user; the CEO grants an extra permission.
    await page.goto("/c/sk-infra-demo/settings/members");
    const member = page.locator("li").filter({ hasText: email }).first();
    await expect(member.getByTestId("member-registration")).toContainText("Urakointi Testi Oy");
    await expect(member.getByText("Ulkoinen rooli")).toBeVisible();
    await member.locator("summary").first().click();
    const extra = member.getByTestId("extra-permissions");
    await extra.locator("summary").click();
    await expect(extra.getByLabel(/hinnat/i)).toHaveCount(0); // sensitive ones are not offered to external users
    await extra.getByRole("checkbox").first().check();
    await extra.getByRole("button", { name: "Tallenna lisäoikeudet" }).click();
    await expect(extra.getByText("Tallennettu")).toBeVisible();
    await page.reload();
    await expect(page.locator("li").filter({ hasText: email }).first().getByText("+1 lisäoikeus")).toBeVisible();
  });
});
