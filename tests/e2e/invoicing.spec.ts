/**
 * Order confirmations and invoices (ADR 0033), desktop and phone: the CEO
 * creates an order confirmation with the sales terms, adds a line, issues and
 * sends it (the PDF arrives in the dev mailbox as an attachment), opens the
 * stored PDF and makes an invoice from it.
 */
import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

test.describe("order confirmations and invoices", () => {
  test.use({ storageState: authFile("ceo") });

  test("create, add a line, issue and send, PDF, invoice from order", async ({ page }, testInfo) => {
    const title = unique(testInfo, "E2E-vahvistus");
    await page.goto("/c/sk-infra-demo/invoicing");
    const create = page.getByTestId("invoicing-create-form");
    await create.getByLabel("Tyyppi").selectOption({ label: "Tilausvahvistus" });
    await create.getByLabel("Ehdot").selectOption({ label: "Myynti – myyntiehdot" });
    await create.getByLabel("Asiakas rekisteristä").selectOption({ label: "Nordic Hyperscale Demo Oy (0000001-9)" });
    await create.getByLabel("Otsikko").fill(title);
    await create.getByRole("button", { name: "Luo luonnos" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tilausvahvistus (luonnos)");

    const line = page.getByTestId("invoicing-line-form");
    await line.getByLabel("Koodi").fill("KH-600");
    await line.getByLabel("Nimike").fill("Kaapelihylly 600 mm");
    await line.getByLabel("Määrä").fill("5");
    await line.getByLabel("a-hinta (alv 0 %)").fill("100");
    await line.getByRole("button", { name: "Lisää rivi" }).click();
    await expect(page.getByTestId("invoicing-lines")).toContainText("Kaapelihylly 600 mm");
    await expect(page.getByTestId("invoicing-gross")).toContainText("627,50");

    const header = page.getByTestId("invoicing-header-form");
    await expect(header.getByLabel("Ehtoteksti")).toHaveValue(/MYYNTIEHDOT|SOVELTAMINEN|Myyjä/);

    const send = page.getByTestId("invoicing-send-form");
    await expect(send.getByLabel("Vastaanottaja")).toHaveValue("hanna.hankinta@hyperscale.example.com");
    await send.getByRole("button", { name: "Vahvista ja lähetä" }).click();
    await expect(page.getByText("Lähetetty.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Tilausvahvistus \d+$/);
    const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Tilausvahvistus ", "");

    const pdf = await page.request.get(`${page.url().split("?")[0]}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["x-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    await page.getByRole("button", { name: "Tee lasku tästä" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lasku (luonnos)");
    await expect(page.getByText(`Pohjana Tilausvahvistus ${number}`)).toBeVisible();

    await page.goto("/dev/mailbox");
    const mail = page.locator('[data-testid="dev-mail"][data-to="hanna.hankinta@hyperscale.example.com"]').filter({ hasText: `Tilausvahvistus ${number}` }).first();
    await expect(mail).toContainText(`[Liite: Tilausvahvistus-${number}.pdf`);
    await expect(mail).toContainText("Reply-To:");
  });
});
