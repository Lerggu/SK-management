import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

const HSE = "/c/sk-infra-demo/hse";
const PORTAL = "/c/sk-infra-demo/portal";
// 1×1 JPEG-like bytes; the server checks the type by file name.
const photo = { name: "havainto.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) };

test.describe("HSE reporting on site", () => {
  test.use({ storageState: authFile("employee") });

  test("employee reports a safety observation with a photo in one step", async ({ page }, testInfo) => {
    await page.goto(HSE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Työturvallisuus");
    await page.getByTestId("hse-quick").getByRole("link", { name: "Turvallisuushavainto" }).click();
    const form = page.getByTestId("observation-form");
    const title = unique(testInfo, "Suojakaide puuttuu");
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(title);
    await form.getByLabel("Aihe").selectOption({ label: "Korkealla työskentely" });
    await form.getByLabel("Kuva", { exact: true }).setInputFiles(photo);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByTestId("hse-photos").getByRole("img")).toHaveCount(1);
    // The employee cannot triage.
    await expect(page.getByTestId("triage-form")).toHaveCount(0);
  });
});

test.describe("HSE management", () => {
  test.use({ storageState: authFile("hse") });

  test("HSE sees the urgent lost-time incident, key figures and injured-person data", async ({ page }) => {
    await page.goto(HSE);
    await expect(page.getByTestId("hse-urgent")).toContainText("Kaatuminen telineeltä");
    await expect(page.getByTestId("metric-mvr")).toContainText("94");
    await page.getByTestId("hse-urgent").getByRole("link", { name: /Kaatuminen telineeltä/ }).click();
    await expect(page.getByTestId("incident-severity")).toHaveText("Poissaoloon johtanut");
    await expect(page.getByTestId("incident-persons")).toContainText("Demo Henkilö");
    // Closing waits for the PM's approval of the corrective action.
    await expect(page.getByText("Sulkeminen odottaa korjaavien toimenpiteiden hyväksyntää")).toBeVisible();
  });
});

test.describe("site manager", () => {
  test.use({ storageState: authFile("siteManager") });

  test("does not see injured-person data", async ({ page }) => {
    await page.goto(HSE);
    await page.getByRole("link", { name: /Kaatuminen telineeltä/ }).first().click();
    await expect(page.getByTestId("incident-severity")).toBeVisible();
    await expect(page.getByTestId("incident-persons")).toHaveCount(0);
    await expect(page.getByText("Demo Henkilö")).toHaveCount(0);
  });
});

test.describe("subcontractor portal", () => {
  test.use({ storageState: authFile("subcontractor") });

  test("reports an incident from the portal, sees only own reports and is kept out of internal pages", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await expect(page).toHaveURL(/\/portal\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("NDC-001");
    await expect(page.getByText("Aliurakoitsijaportaali").first()).toBeVisible();
    // Shared document: approved revision only.
    await expect(page.getByRole("link", { name: /110 kV kytkinlaitoksen pääkaavio/ })).toBeVisible();
    await page.getByTestId("portal-quick").getByRole("link", { name: "Tapaturma" }).click();
    const form = page.getByTestId("incident-form");
    const title = unique(testInfo, "Peili rikki");
    await form.getByLabel("Tapahtuman tyyppi").selectOption({ label: "Omaisuusvahinko" });
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(title);
    await form.getByRole("button", { name: "Lähetä tapaturmailmoitus" }).click();
    await expect(page.getByText("Kiitos! Ilmoitus on vastaanotettu.")).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    // Other people's reports (employee's observation in the seed) are not listed.
    await expect(page.getByText("Kaapelikelojen välissä kulkuväylä tukossa")).toHaveCount(0);
    // Internal pages redirect to the portal.
    await page.goto("/c/sk-infra-demo/projects");
    await expect(page).toHaveURL(/\/portal/);
    await page.goto("/c/sk-infra-demo/lifting");
    await expect(page).toHaveURL(/\/portal/);
  });
});

test.describe("client approval in the portal", () => {
  test.use({ storageState: authFile("pm") });

  test("PM prepares, PD approves internally, the client approver approves the frozen version", async ({ page, browser }, testInfo) => {
    await page.goto("/c/sk-infra-demo/projects");
    await page.getByRole("link", { name: /NDC-001/ }).first().click();
    await page.getByRole("link", { name: "Sopimus ja ennuste" }).click();
    const title = unique(testInfo, "E2E-portaali");
    const form = page.getByTestId("variation-form");
    await form.getByLabel("Lisätyö").fill(title);
    await form.getByRole("button", { name: "Luo lisätyö" }).click();
    const d = page.getByTestId("variation-draft-form");
    await d.getByLabel("Työ (€)").fill("2000");
    await d.getByLabel("Lisä (%)").fill("10");
    await d.getByRole("button", { name: "Tallenna" }).click();
    await expect(page.getByTestId("variation-price")).toContainText("2 200,00");
    await page.getByRole("button", { name: "Lähetä sisäiseen tarkastukseen" }).click();
    // Pricing is editable only as a draft: wait until the submit has landed.
    await expect(page.getByTestId("variation-draft-form")).toHaveCount(0);
    const url = page.url();

    const pd = await browser.newContext({ storageState: authFile("pd"), ...testInfo.project.use });
    const pp = await pd.newPage();
    await pp.goto(url);
    await pp.getByTestId("variation-approve-form").getByRole("button", { name: "Hyväksy ja lähetä asiakkaalle" }).click();
    await expect(pp.getByTestId("client-approvals")).toContainText("Odottaa asiakasta");
    await pd.close();

    const client = await browser.newContext({ storageState: authFile("client"), ...testInfo.project.use });
    const cp = await client.newPage();
    await cp.goto(PORTAL);
    await expect(cp.getByRole("heading", { level: 1 })).toContainText("NDC-001");
    await expect(cp.getByTestId("portal-schedule")).toBeVisible();
    await cp.getByRole("link", { name: new RegExp(title) }).click();
    await expect(cp.getByTestId("approval-price")).toContainText("2 200,00");
    await expect(cp.getByText("Työ (€)")).toHaveCount(0);
    await expect(cp.getByTestId("approval-hash")).toContainText(/[0-9a-f]{64}/);
    await cp.getByTestId("approval-form").getByRole("button", { name: "Hyväksyn muutostyön" }).click();
    await expect(cp.getByText("Päätös tallennettu.")).toBeVisible();
    await expect(cp.getByTestId("decided-approvals")).toContainText(title);
    await client.close();

    await page.reload();
    await expect(page.getByTestId("client-approvals")).toContainText("Asiakas hyväksyi");
    await expect(page.getByRole("button", { name: "Merkitse tehdyksi" })).toBeVisible();
  });
});

test.describe("e-mail link sign-in", () => {
  test("an external user signs in with a single-use link from the mailbox", async ({ page }) => {
    await page.goto("/sign-in");
    const form = page.getByTestId("email-link-form");
    await form.getByPlaceholder("Sähköposti").fill("subcontractor@example.com");
    await form.getByRole("button", { name: "Lähetä kirjautumislinkki" }).click();
    await expect(page.getByTestId("link-sent")).toBeVisible();
    await page.goto("/dev/mailbox");
    const mail = page.locator('[data-testid="dev-mail"][data-to="subcontractor@example.com"]').first();
    const link = /https?:\/\/\S+\/sign-in\/email\?token=[A-Za-z0-9_-]+/.exec((await mail.textContent()) ?? "")![0];
    const path = new URL(link).pathname + new URL(link).search;
    await page.goto(path);
    await page.getByTestId("confirm-sign-in").click();
    await expect(page).toHaveURL(/\/portal/);
    // The link works only once.
    await page.context().clearCookies();
    await page.goto(path);
    await page.getByTestId("confirm-sign-in").click();
    await expect(page.getByText("Linkki on vanhentunut tai jo käytetty")).toBeVisible();
  });
});
